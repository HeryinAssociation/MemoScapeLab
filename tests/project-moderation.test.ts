import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "../worker/auth";
import {
  moderateProject,
  normalizeModerationReason,
  ProjectModerationInputError,
} from "../worker/project-moderation";

interface MockStatement extends D1PreparedStatement {
  query: string;
  values: unknown[];
}

function createDb(projectFound = true) {
  const batches: MockStatement[][] = [];
  const db: D1Database = {
    prepare(query) {
      const statement: MockStatement = {
        query,
        values: [],
        bind(...values) { statement.values = values; return statement; },
        async first<T>() {
          if (!projectFound) return null;
          return {
            id: "project-1",
            title: "待审核项目",
            owner_user_id: "owner-1",
            moderation_status: "clear",
            moderation_reason: "",
          } as T;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() {},
      };
      return statement;
    },
    async batch(statements) { batches.push(statements as MockStatement[]); return []; },
  };
  return { db, batches };
}

test("take-down requires a concise, recorded reason", () => {
  assert.throws(() => normalizeModerationReason("take_down", "  "), ProjectModerationInputError);
  assert.equal(normalizeModerationReason("take_down", "  涉嫌侵权  "), "涉嫌侵权");
  assert.throws(() => normalizeModerationReason("take_down", "x".repeat(501)), ProjectModerationInputError);
});

test("superadmin take-down makes project and assets private and writes an audit log", async () => {
  const { db, batches } = createDb();
  const result = await moderateProject(db, {
    projectId: "project-1",
    adminUserId: "admin-1",
    action: "take_down",
    reason: "内容版权信息不完整",
    now: "2026-08-17T10:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "updated",
    moderationStatus: "taken_down",
    moderationReason: "内容版权信息不完整",
    moderatedAt: "2026-08-17T10:00:00.000Z",
  });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  assert.match(batches[0][0].query, /publication_status = 'draft'/);
  assert.match(batches[0][0].query, /moderation_status = \?/);
  assert.equal(batches[0][0].values[0], "taken_down");
  assert.match(batches[0][1].query, /visibility = 'private'/);
  assert.match(batches[0][2].query, /INSERT INTO admin_audit_logs/);
  assert.equal(batches[0][2].values[3], "project.take_down");
  assert.match(String(batches[0][2].values[4]), /内容版权信息不完整/);
});

test("restore clears the moderation lock but keeps the project as a private draft", async () => {
  const { db, batches } = createDb();
  const result = await moderateProject(db, {
    projectId: "project-1",
    adminUserId: "admin-1",
    action: "restore",
    now: "2026-08-17T11:00:00.000Z",
  });

  assert.equal(result.status, "updated");
  assert.equal(result.status === "updated" && result.moderationStatus, "clear");
  assert.equal(batches[0][0].values[0], "clear");
  assert.equal(batches[0][0].values[1], "");
  assert.match(batches[0][1].query, /visibility = 'private'/);
  assert.equal(batches[0][2].values[3], "project.restore");
});

test("moderation does not reveal or mutate a missing project", async () => {
  const { db, batches } = createDb(false);
  assert.deepEqual(await moderateProject(db, {
    projectId: "missing",
    adminUserId: "admin-1",
    action: "take_down",
    reason: "违规内容",
  }), { status: "not_found" });
  assert.equal(batches.length, 0);
});
