import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database, D1PreparedStatement, UserRow } from "../worker/auth";

interface MockStatement extends D1PreparedStatement {
  query: string;
  values: unknown[];
}

function user(role: "user" | "superadmin"): UserRow & { csrf_token: string; expires_at: string } {
  return {
    id: role === "superadmin" ? "admin-1" : "owner-1",
    username: role,
    email: `${role}@example.test`,
    email_verified: 1,
    phone_e164: null,
    phone_verified: 0,
    password_hash: "unused",
    avatar_key: null,
    role,
    status: "active",
    must_change_password: 0,
    onboarding_completed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    banned_at: null,
    csrf_token: "csrf-test",
    expires_at: "2099-01-01T00:00:00.000Z",
  };
}

function projectRow() {
  return {
    id: "project-1",
    title: "其他用户项目",
    capture_time: "1948",
    location: "上海",
    notes: "测试项目",
    mode: "curvedPhoto",
    original_image_url: "",
    original_thumbnail_url: "",
    panorama_image_url: "",
    panorama_thumbnail_url: "",
    scene_json: JSON.stringify({ id: "project-1", title: "其他用户项目", mode: "curvedPhoto" }),
    workflow_step: 3,
    publication_status: "draft",
    moderation_status: "clear",
    moderation_reason: "",
    moderated_at: null,
    moderated_by_user_id: null,
    owner_user_id: "owner-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function createDb(role: "user" | "superadmin", moderationStatus: "clear" | "taken_down" = "taken_down") {
  const statements: MockStatement[] = [];
  const batches: MockStatement[][] = [];
  const db: D1Database = {
    prepare(query) {
      const statement: MockStatement = {
        query,
        values: [],
        bind(...values) { statement.values = values; return statement; },
        async first<T>() {
          if (/SELECT id FROM users WHERE role = 'superadmin'/i.test(query)) return { id: "admin-existing" } as T;
          if (/FROM sessions s/i.test(query)) return user(role) as T;
          if (/SELECT created_at, moderation_status, owner_user_id FROM projects/i.test(query)) {
            return {
              created_at: "2026-01-01T00:00:00.000Z",
              moderation_status: moderationStatus,
              owner_user_id: "owner-1",
            } as T;
          }
          if (/SELECT id, owner_user_id FROM projects WHERE id = \?/i.test(query)) {
            return { id: "project-1", owner_user_id: "owner-1" } as T;
          }
          if (/SELECT \* FROM projects WHERE id = \?/i.test(query)) return projectRow() as T;
          if (/SELECT assets\.\*, projects\.publication_status/i.test(query)) return {
            id: "asset-1", project_id: "project-1", parent_asset_id: null,
            owner_user_id: "owner-1", kind: "original", storage_provider: "lightcos",
            bucket: "archive", region: "ap-shanghai", object_key: "users/owner-1/a.jpg",
            original_filename: "a.jpg", content_type: "image/jpeg", byte_size: 10,
            width: 1, height: 1, etag: "etag", visibility: "private", status: "ready",
            created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
            project_publication_status: "draft",
          } as T;
          return null;
        },
        async all<T>() { return { results: [] as T[] }; },
        async run() { statements.push(statement); },
      };
      return statement;
    },
    async batch(items) { batches.push(items as MockStatement[]); return []; },
  };
  return { db, statements, batches };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      cookie: "ap_session=test-session",
      "x-csrf-token": "csrf-test",
      ...(init.headers ?? {}),
    },
  });
}

async function fetchWorker(req: Request, db: D1Database, extraEnv: Record<string, unknown> = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  const { default: worker } = await import(workerUrl.href) as {
    default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
  };
  return worker.fetch(req, {
    DB: db,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ...extraEnv,
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("regular users cannot call the project moderation endpoint", async () => {
  const { db } = createDb("user");
  const req = request("/api/projects/project-1/moderation", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "take_down", reason: "违规内容" }),
  });
  const response = await fetchWorker(req, db);
  assert.equal(response.status, 403);
  assert.match((await response.json() as { error: string }).error, /超级管理员/);
});

test("taken-down projects cannot be republished by their owner", async () => {
  const { db, statements } = createDb("user");
  const req = request("/api/projects/project-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "已下架项目",
      publicationStatus: "published",
      scene: { id: "project-1", title: "已下架项目", mode: "curvedPhoto" },
    }),
  });
  const response = await fetchWorker(req, db);
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /不能再次发布/);
  assert.equal(statements.filter((statement) => /UPDATE projects SET\s+title = \?/i.test(statement.query)).length, 0);
});

test("superadmin project listing uses platform scope instead of owner scope", async () => {
  const { db } = createDb("superadmin");
  const req = request("/api/projects");
  const response = await fetchWorker(req, db);
  assert.equal(response.status, 200);
  const payload = await response.json() as { scope: string; projects: unknown[] };
  assert.equal(payload.scope, "platform");
  assert.deepEqual(payload.projects, []);
});

test("superadmin can read and edit another user's private project", async () => {
  const { db, statements } = createDb("superadmin", "clear");
  const readRequest = request("/api/projects/project-1");
  const readResponse = await fetchWorker(readRequest, db);
  assert.equal(readResponse.status, 200);
  const readPayload = await readResponse.json() as { project: { canEdit: boolean } };
  assert.equal(readPayload.project.canEdit, true);

  const editRequest = request("/api/projects/project-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "管理员修订标题",
      publicationStatus: "draft",
      scene: { id: "project-1", title: "管理员修订标题", mode: "curvedPhoto" },
    }),
  });
  const editResponse = await fetchWorker(editRequest, db);
  assert.equal(editResponse.status, 200);
  const ownershipQuery = statements.find((statement) => /UPDATE projects SET\s+title = \?/i.test(statement.query));
  assert.ok(ownershipQuery, "project update should run for a superadmin");
});

test("superadmin passes private asset authorization for another user's project", async () => {
  const { db } = createDb("superadmin");
  const response = await fetchWorker(request("/api/assets/asset-1"), db);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "LightCOS is not configured");
});

test("assets uploaded by superadmin remain owned by the project's user", async () => {
  const { db, statements } = createDb("superadmin");
  const response = await fetchWorker(request("/api/assets/upload-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: "project-1",
      kind: "original",
      contentType: "image/jpeg",
      size: 10,
      width: 1,
      height: 1,
      filename: "review.jpg",
    }),
  }), db, {
    TENCENT_LIGHTCOS_APP_ID: "1300000000",
    TENCENT_LIGHTCOS_REGION: "ap-shanghai",
    TENCENT_LIGHTCOS_ARCHIVE_BUCKET: "archive-1300000000",
    TENCENT_LIGHTCOS_MEDIA_BUCKET: "media-1300000000",
    TENCENT_LIGHTCOS_SECRET_ID: "secret-id",
    TENCENT_LIGHTCOS_SECRET_KEY: "secret-key",
  });
  assert.equal(response.status, 201);
  const insert = statements.find((statement) => /INSERT INTO assets/i.test(statement.query));
  assert.ok(insert);
  assert.equal(insert.values[3], "owner-1");
  assert.match(String(insert.values[7]), /^users\/owner-1\/projects\/project-1\/original\//);
});
