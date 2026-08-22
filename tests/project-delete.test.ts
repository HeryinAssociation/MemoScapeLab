import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database, D1PreparedStatement, R2Bucket } from "../worker/auth";
import { deleteOwnedProject } from "../worker/project-delete";

interface MockStatement extends D1PreparedStatement {
  query: string;
  values: unknown[];
}

function createDb(options: {
  projectFound?: boolean;
  activeTask?: boolean;
  assets?: Array<{ bucket: string; object_key: string }>;
}) {
  const batches: MockStatement[][] = [];
  const db: D1Database = {
    prepare(query: string) {
      const statement: MockStatement = {
        query,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first<T>() {
          if (query.includes("FROM projects")) {
            return (options.projectFound === false ? null : { id: "project-1" }) as T | null;
          }
          if (query.includes("FROM image_gen_tasks")) {
            return (options.activeTask ? { id: "task-1" } : null) as T | null;
          }
          return null;
        },
        async all<T>() {
          return { results: (options.assets ?? []) as T[] };
        },
        async run() {},
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements as MockStatement[]);
      return [];
    },
  };
  return { db, batches };
}

function createMedia(pages: Array<{ keys: string[]; cursor?: string }>) {
  const deleted: Array<string | string[]> = [];
  let page = 0;
  const media: R2Bucket = {
    async put() {},
    async get() { return null; },
    async delete(keys) { deleted.push(keys); },
    async list() {
      const current = pages[page++] ?? { keys: [] };
      return {
        objects: current.keys.map((key) => ({ key })),
        truncated: Boolean(current.cursor),
        ...(current.cursor ? { cursor: current.cursor } : {}),
      };
    },
  };
  return { media, deleted };
}

test("project deletion reveals nothing and changes nothing for a non-owner", async () => {
  const { db, batches } = createDb({ projectFound: false });
  const { media } = createMedia([]);

  const result = await deleteOwnedProject({ DB: db, MEDIA: media }, "project-1", "other-user");

  assert.deepEqual(result, { status: "not_found" });
  assert.equal(batches.length, 0);
});

test("project deletion waits while an image generation task is active", async () => {
  const { db, batches } = createDb({ activeTask: true });
  const { media } = createMedia([]);

  const result = await deleteOwnedProject({ DB: db, MEDIA: media }, "project-1", "owner-1");

  assert.deepEqual(result, { status: "busy" });
  assert.equal(batches.length, 0);
});

test("project deletion removes database rows and every paginated R2 object", async () => {
  const { db, batches } = createDb({});
  const { media, deleted } = createMedia([
    { keys: ["users/owner-1/projects/project-1/generated/a.png"], cursor: "next" },
    { keys: ["users/owner-1/projects/project-1/generated/b.webp"] },
  ]);

  const result = await deleteOwnedProject({ DB: db, MEDIA: media }, "project-1", "owner-1");

  assert.deepEqual(result, { status: "deleted", storageCleanupPending: false });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  assert.match(batches[0][0].query, /DELETE FROM image_gen_tasks/);
  assert.match(batches[0][1].query, /DELETE FROM assets/);
  assert.match(batches[0][2].query, /DELETE FROM projects/);
  assert.deepEqual(deleted, [
    ["users/owner-1/projects/project-1/generated/a.png"],
    ["users/owner-1/projects/project-1/generated/b.webp"],
  ]);
});

test("project disappears even when LightCOS cleanup must be retried", async () => {
  const { db, batches } = createDb({
    assets: [{ bucket: "archive", object_key: "users/owner-1/projects/project-1/original/a.jpg" }],
  });
  const { media } = createMedia([]);

  const result = await deleteOwnedProject({ DB: db, MEDIA: media }, "project-1", "owner-1");

  assert.deepEqual(result, { status: "deleted", storageCleanupPending: true });
  assert.equal(batches.length, 1);
});
