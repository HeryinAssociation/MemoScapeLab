import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database } from "../worker/auth";
import { handlePublicApi } from "../worker/public-api";

const READ_KEY = "test-read-key";
const ALLOWED_ORIGIN = "https://display.example.com";

const PUBLISHED_PROJECT = {
  id: "p1",
  title: "外滩 1991",
  capture_time: "1991 年夏",
  location: "上海 · 外滩",
  notes: "没有智能手机的夏天。",
  mode: "curvedPhoto",
  original_image_url: "/api/assets/orig-1",
  original_thumbnail_url: "/api/assets/thumb-orig-1",
  reference_panorama_image_url: "/api/assets/present-panorama-1",
  reference_panorama_thumbnail_url: "/api/assets/thumb-present-panorama-1",
  panorama_image_url: "/api/assets/pan-1",
  panorama_thumbnail_url: "/api/assets/thumb-pan-1",
  generation_mode: "historical_with_present_panorama",
  scene_json: JSON.stringify({
    id: "p1",
    title: "外滩 1991",
    source: "/api/assets/pan-1",
    thumbnail: "",
    mode: "curvedPhoto",
    view: { yaw: 0, pitch: 0, hfov: 90, minYaw: -90, maxYaw: 90, minPitch: -45, maxPitch: 45, minHfov: 30, maxHfov: 120 },
    metadata: { sourceYear: "1991", sourceLabel: "Li Ly", aiColorized: true, aiExpanded: true },
  }),
  workflow_step: 2,
  publication_status: "published",
  owner_user_id: "u1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-02-01T00:00:00.000Z",
};

const DRAFT_PROJECT = { ...PUBLISHED_PROJECT, id: "p2", title: "草稿", publication_status: "draft" };

const ASSET_ROWS = [
  {
    id: "orig-1",
    project_id: "p1",
    parent_asset_id: null,
    owner_user_id: "u1",
    kind: "original",
    storage_provider: "lightcos",
    bucket: "archive",
    region: "ap-shanghai",
    object_key: "users/u1/projects/p1/original/orig-1.jpg",
    original_filename: "history.jpg",
    content_type: "image/jpeg",
    byte_size: 2048,
    width: 1600,
    height: 900,
    etag: "etag-orig",
    visibility: "private",
    status: "ready",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "thumb-orig-1",
    project_id: "p1",
    parent_asset_id: "orig-1",
    owner_user_id: "u1",
    kind: "thumbnail",
    storage_provider: "lightcos",
    bucket: "media",
    region: "ap-shanghai",
    object_key: "users/u1/projects/p1/thumbnail/thumb-orig-1.webp",
    original_filename: "history.thumbnail.webp",
    content_type: "image/webp",
    byte_size: 512,
    width: 0,
    height: 0,
    etag: "etag-thumb",
    visibility: "private",
    status: "ready",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

/** 按 SQL 形状匹配的内存版 D1 mock。 */
function mockDatabase() {
  const matchesCategory = (project: typeof PUBLISHED_PROJECT, query: string) => {
    if (/reference_panorama_image_url <> ''/i.test(query)) {
      return Boolean(project.reference_panorama_image_url);
    }
    if (/projects\.mode IN \('sphere360', 'partialSphere'\)/i.test(query)) {
      return !project.reference_panorama_image_url
        && ["sphere360", "partialSphere"].includes(project.mode);
    }
    if (/projects\.mode IN \('curvedPhoto', 'flatPhoto'\)/i.test(query)) {
      return !project.reference_panorama_image_url
        && ["curvedPhoto", "flatPhoto"].includes(project.mode);
    }
    return true;
  };
  const findProject = (id: string) => {
    const row = [PUBLISHED_PROJECT, DRAFT_PROJECT].find((project) => project.id === id);
    return row ? { ...row } : null;
  };
  return {
    prepare(query: string) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) { this.values = values; return this; },
        async first() {
          if (/COUNT\(\*\) AS total/i.test(query)) {
            const mode = this.values[0];
            const rows = [PUBLISHED_PROJECT]
              .filter((project) => !mode || project.mode === mode)
              .filter((project) => matchesCategory(project, query));
            return { total: rows.length };
          }
          if (/FROM projects WHERE id = \? AND publication_status = 'published'/i.test(query)) {
            const row = findProject(String(this.values[0]));
            return row?.publication_status === "published" ? row : null;
          }
          if (/SELECT id FROM projects WHERE id = \? AND publication_status = 'published'/i.test(query)) {
            const row = findProject(String(this.values[0]));
            return row?.publication_status === "published" ? { id: row.id } : null;
          }
          if (/FROM users WHERE id = \?/i.test(query)) {
            return {
              id: "u1",
              username: "记忆测绘员",
              avatar_key: "lightcos:avatar-1",
              created_at: "2025-06-01T00:00:00.000Z",
              updated_at: "2025-06-02T00:00:00.000Z",
            };
          }
          if (/FROM image_gen_tasks/i.test(query)) {
            return {
              provider: "seedream",
              model: "doubao-seedream-4-0-250828",
              generation_mode: "historical_with_present_panorama",
              status: "succeeded",
              started_at: "2026-02-01T00:00:00.000Z",
              finished_at: "2026-02-01T00:05:00.000Z",
            };
          }
          return null;
        },
        async all() {
          if (/FROM projects/i.test(query) && /LIMIT \? OFFSET \?/i.test(query)) {
            // 有 mode 过滤时 values[0] 是字符串 mode，否则 values[0] 是 limit
            const mode = typeof this.values[0] === "string" ? this.values[0] : undefined;
            const rows = [PUBLISHED_PROJECT]
              .filter((project) => project.publication_status === "published")
              .filter((project) => !mode || project.mode === mode)
              .filter((project) => matchesCategory(project, query))
              .map((project) => ({
                ...project,
                author_username: "记忆测绘员",
                author_avatar_key: "lightcos:avatar-1",
                author_created_at: "2025-06-01T00:00:00.000Z",
                author_updated_at: "2025-06-02T00:00:00.000Z",
              }));
            const limit = Number(this.values[mode ? 1 : 0]);
            const offset = Number(this.values[mode ? 2 : 1]);
            return { results: rows.slice(offset, offset + limit) };
          }
          if (/FROM assets WHERE project_id = \?/i.test(query)) {
            return { results: ASSET_ROWS.map((row) => ({ ...row })) };
          }
          return { results: [] };
        },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    DB: mockDatabase() as unknown as D1Database,
    READ_API_KEY: READ_KEY,
    PUBLIC_API_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
    ...overrides,
  };
}

async function call(
  path: string,
  options: {
    method?: string;
    key?: string | null;
    origin?: string | null;
    body?: string;
  } = {},
) {
  const request = new Request(`https://api.memoscapelab.example${path}`, {
    method: options.method ?? "GET",
    ...(options.body ? { body: options.body } : {}),
    headers: {
      ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
  });
  const url = new URL(request.url);
  return handlePublicApi(request, env(), url);
}

test("未配置 READ_API_KEY 时数据接口返回 503", async () => {
  const request = new Request("https://api.memoscapelab.example/api/v1/projects", {
    headers: { authorization: `Bearer ${READ_KEY}` },
  });
  const response = await handlePublicApi(request, env({ READ_API_KEY: "" }), new URL(request.url));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.match(payload.error, /READ_API_KEY/);
});

test("缺少或错误的 API Key 返回 401", async () => {
  const missing = await call("/api/v1/projects");
  assert.equal(missing.status, 401);
  const wrong = await call("/api/v1/projects", { key: "wrong-key" });
  assert.equal(wrong.status, 401);
});

test("OPTIONS 预检：允许的来源返回 204 与 CORS 头", async () => {
  const response = await call("/api/v1/projects", { method: "OPTIONS", origin: ALLOWED_ORIGIN });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /Authorization/);
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /GET/);
});

test("OPTIONS 预检：未登记的来源不带 CORS 头", async () => {
  const response = await call("/api/v1/projects", { method: "OPTIONS", origin: "https://evil.example.com" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("项目列表：只返回已发布项目并按 updatedAt 倒序分页", async () => {
  const response = await call("/api/v1/projects?page=1&limit=10", { key: READ_KEY });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projects.length, 1);
  assert.equal(payload.projects[0].id, "p1");
  assert.equal(payload.projects[0].title, "外滩 1991");
  assert.equal(payload.projects[0].category, "presentPanorama");
  assert.equal(payload.projects[0].coverUrl, "https://api.memoscapelab.example/api/assets/thumb-pan-1");
  assert.equal(payload.projects[0].author.username, "记忆测绘员");
  assert.equal(payload.projects[0].author.avatar.includes("/api/users/u1/avatar"), true);
  assert.deepEqual(payload.pagination, { page: 1, limit: 10, total: 1, totalPages: 1 });
  // 列表项不暴露 email/phone 等隐私字段
  assert.equal("email" in payload.projects[0], false);
  assert.equal("ownerUserId" in payload.projects[0], false);
});

test("项目列表：非法 mode 参数返回 400", async () => {
  const response = await call("/api/v1/projects?mode=no-such-mode", { key: READ_KEY });
  assert.equal(response.status, 400);
});

test("项目列表：现实参考全景分类优先于场景渲染模式", async () => {
  const constrained = await call("/api/v1/projects?category=presentPanorama", { key: READ_KEY });
  const constrainedPayload = await constrained.json();
  assert.equal(constrained.status, 200);
  assert.equal(constrainedPayload.projects.length, 1);
  assert.equal(constrainedPayload.projects[0].category, "presentPanorama");

  const curved = await call("/api/v1/projects?category=curvedSphere", { key: READ_KEY });
  const curvedPayload = await curved.json();
  assert.equal(curved.status, 200);
  assert.equal(curvedPayload.projects.length, 0);
});

test("项目列表：非法 category 参数返回 400", async () => {
  const response = await call("/api/v1/projects?category=no-such-category", { key: READ_KEY });
  assert.equal(response.status, 400);
});

test("项目详情：返回完整聚合数据并绝对化 URL", async () => {
  const response = await call("/api/v1/projects/p1");
  assert.equal(response.status, 200);
  const payload = await response.json();
  const project = payload.project;
  assert.equal(project.id, "p1");
  assert.equal(project.category, "presentPanorama");
  assert.equal(project.publicationStatus, "published");
  assert.equal(project.history.captureTime, "1991 年夏");
  assert.equal(project.history.metadata.aiColorized, true);
  assert.equal(
    project.images.originalImageUrl,
    "https://api.memoscapelab.example/api/assets/orig-1",
  );
  assert.equal(
    project.images.panoramaThumbnailUrl,
    "https://api.memoscapelab.example/api/assets/thumb-pan-1",
  );
  assert.equal(
    project.images.referencePanoramaImageUrl,
    "https://api.memoscapelab.example/api/assets/present-panorama-1",
  );
  assert.equal(
    project.images.referencePanoramaThumbnailUrl,
    "https://api.memoscapelab.example/api/assets/thumb-present-panorama-1",
  );
  assert.equal(project.render.view.hfov, 90);
  assert.equal(project.author.username, "记忆测绘员");
  assert.equal(project.author.avatar.includes("/api/users/u1/avatar"), true);
  assert.equal("email" in project.author, false);
  assert.equal(project.aiProvenance.provider, "seedream");
  assert.equal(project.aiProvenance.generationMode, "historical_with_present_panorama");
  assert.equal(project.scene.source, "https://api.memoscapelab.example/api/assets/pan-1");
});

test("项目详情：assets 元数据包含 kind/宽高，0 尺寸转 null", async () => {
  const response = await call("/api/v1/projects/p1");
  const payload = await response.json();
  const original = payload.project.assets.find((asset: { kind: string }) => asset.kind === "original");
  const thumbnail = payload.project.assets.find((asset: { kind: string }) => asset.kind === "thumbnail");
  assert.equal(original.width, 1600);
  assert.equal(original.height, 900);
  assert.equal(thumbnail.width, null);
  assert.equal(thumbnail.parentAssetId, "orig-1");
});

test("项目详情：草稿项目返回 404", async () => {
  const response = await call("/api/v1/projects/p2");
  assert.equal(response.status, 404);
});

test("资产列表：只返回已发布项目的 ready 资产", async () => {
  const response = await call("/api/v1/projects/p1/assets");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.assets.length, 2);
  assert.equal(payload.assets[0].contentType, "image/jpeg");
});

test("资产列表：草稿项目返回 404", async () => {
  const response = await call("/api/v1/projects/p2/assets");
  assert.equal(response.status, 404);
});

test("单个已发布项目 API 未配置 READ_API_KEY 仍可免密访问", async () => {
  const request = new Request("https://api.memoscapelab.example/api/v1/projects/p1");
  const response = await handlePublicApi(request, env({ READ_API_KEY: "" }), new URL(request.url));
  assert.equal(response.status, 200);
});

test("单个已发布项目 API 对任意浏览器来源开放 CORS", async () => {
  const response = await call("/api/v1/projects/p1", { origin: "https://viewer.example.com" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("OpenAPI 文档与 Swagger UI 免密钥可访问", async () => {
  const spec = await call("/api/v1/openapi.json");
  assert.equal(spec.status, 200);
  const payload = await spec.json();
  assert.equal(payload.openapi, "3.0.3");
  assert.ok(payload.paths["/api/v1/projects"]);
  assert.deepEqual(payload.paths["/api/v1/projects/{id}"].get.security, []);
  const docs = await call("/api/v1/docs");
  assert.equal(docs.status, 200);
  assert.match(docs.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await docs.text(), /swagger-ui/);
});

test("未知路径与非法方法返回 404/405", async () => {
  const missing = await call("/api/v1/nope", { key: READ_KEY });
  assert.equal(missing.status, 404);
  const post = await call("/api/v1/projects", { method: "POST", key: READ_KEY });
  assert.equal(post.status, 405);
});
