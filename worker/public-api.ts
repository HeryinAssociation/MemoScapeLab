/** 对外只读 API（/api/v1）：供展示项目获取已发布项目的完整数据（图片、元数据、历史信息、作者、时间戳）。 */
import { json, type D1Database } from "./auth";
import type { ImmersiveScene, SceneMode } from "../src/core/projection-types";
import openapiDocument from "../docs/public-api-openapi.json";

export interface PublicApiEnv {
  DB: D1Database;
  /** 已发布项目列表的 Bearer API Key；单项目公开详情不使用该密钥。 */
  READ_API_KEY?: string;
  /** 允许的跨域来源，多个用英文逗号分隔；未配置时浏览器跨域不可用（服务端调用不受影响）。 */
  PUBLIC_API_ALLOWED_ORIGIN?: string;
}

interface ProjectRow {
  id: string;
  title: string;
  capture_time: string;
  location: string;
  notes: string;
  mode: SceneMode;
  original_image_url: string;
  original_thumbnail_url: string;
  panorama_image_url: string;
  panorama_thumbnail_url: string;
  scene_json: string;
  workflow_step: number;
  publication_status: "draft" | "published";
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectSummaryRow extends ProjectRow {
  author_username: string | null;
  author_avatar_key: string | null;
  author_created_at: string | null;
  author_updated_at: string | null;
}

interface AssetRow {
  id: string;
  project_id: string | null;
  parent_asset_id: string | null;
  owner_user_id: string;
  kind: string;
  storage_provider: string;
  bucket: string;
  region: string;
  object_key: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  width: number;
  height: number;
  etag: string;
  visibility: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const SCENE_MODES: SceneMode[] = ["sphere360", "partialSphere", "curvedPhoto", "flatPhoto"];
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

/** 常数时间比较，避免 API Key 被时序侧信道探测。 */
function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearerKey(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** 仅对已登记的来源返回 CORS 头；其余场景返回 null（不跨域或服务端调用）。 */
function corsHeaders(request: Request, env: PublicApiEnv): HeadersInit | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = (env.PUBLIC_API_ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function withCors(response: Response, cors: HeadersInit | null): Response {
  if (cors) {
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
  }
  return response;
}

/** 库中存储的是相对路径（/api/assets/...），对外统一转成绝对 URL。 */
function absoluteUrl(origin: string, path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return `${origin}${path}`;
  return path;
}

/** 场景内的图片引用一并绝对化，保证展示项目可直接使用。 */
function sceneToAbsolute(scene: ImmersiveScene, origin: string): ImmersiveScene {
  return {
    ...scene,
    source: absoluteUrl(origin, scene.source),
    thumbnail: scene.thumbnail ? absoluteUrl(origin, scene.thumbnail) : undefined,
    metadata: scene.metadata
      ? {
          ...scene.metadata,
          originalImageUrl: scene.metadata.originalImageUrl
            ? absoluteUrl(origin, scene.metadata.originalImageUrl)
            : undefined,
        }
      : undefined,
  };
}

/** 列表卡片所需的最小字段。 */
function projectSummary(row: ProjectSummaryRow, origin: string) {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    captureTime: row.capture_time,
    location: row.location,
    publicationStatus: row.publication_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    coverUrl: absoluteUrl(
      origin,
      row.panorama_thumbnail_url ||
        row.original_thumbnail_url ||
        row.panorama_image_url ||
        row.original_image_url,
    ),
    originalImageUrl: absoluteUrl(origin, row.original_image_url),
    panoramaImageUrl: absoluteUrl(origin, row.panorama_image_url),
    author: row.author_username
      ? {
          username: row.author_username,
          avatar: row.author_avatar_key && row.owner_user_id
            ? `${origin}/api/users/${encodeURIComponent(row.owner_user_id)}/avatar?v=${encodeURIComponent(row.author_updated_at ?? "")}`
            : "",
          createdAt: row.author_created_at ?? "",
        }
      : null,
  };
}

/** 单个已发布项目属于公开资源，允许任意站点读取其 JSON。 */
function publishedProjectCorsHeaders(request: Request): HeadersInit | null {
  if (!request.headers.get("origin")) return null;
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
  };
}

function assetItem(asset: AssetRow, origin: string) {
  return {
    id: asset.id,
    kind: asset.kind,
    parentAssetId: asset.parent_asset_id,
    url: `${origin}/api/assets/${encodeURIComponent(asset.id)}`,
    contentType: asset.content_type,
    byteSize: asset.byte_size,
    width: asset.width > 0 ? asset.width : null,
    height: asset.height > 0 ? asset.height : null,
    etag: asset.etag,
    createdAt: asset.created_at,
  };
}

async function listProjects(env: PublicApiEnv, url: URL, origin: string) {
  const rawPage = Number(url.searchParams.get("page") ?? 1);
  const rawLimit = Number(url.searchParams.get("limit") ?? LIST_DEFAULT_LIMIT);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(LIST_MAX_LIMIT, Math.floor(rawLimit))
    : LIST_DEFAULT_LIMIT;
  const mode = url.searchParams.get("mode") ?? "";
  const where: string[] = ["projects.publication_status = 'published'"];
  const params: unknown[] = [];
  if (mode) {
    if (!SCENE_MODES.includes(mode as SceneMode)) {
      return json({ error: "mode 参数无效。" }, { status: 400 });
    }
    where.push("projects.mode = ?");
    params.push(mode);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM projects ${clause}`)
    .bind(...params)
    .first<{ total: number }>();
  const total = Number(count?.total ?? 0);
  const rows = await env.DB.prepare(
    `SELECT projects.*,
       users.username AS author_username,
       users.avatar_key AS author_avatar_key,
       users.created_at AS author_created_at,
       users.updated_at AS author_updated_at
     FROM projects
     LEFT JOIN users ON users.id = projects.owner_user_id
     ${clause}
     ORDER BY projects.updated_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, (page - 1) * limit)
    .all<ProjectSummaryRow>();
  return json({
    projects: rows.results.map((row) => projectSummary(row, origin)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

async function projectDetail(env: PublicApiEnv, id: string, origin: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM projects WHERE id = ? AND publication_status = 'published'",
  )
    .bind(id)
    .first<ProjectRow>();
  if (!row) return json({ error: "项目不存在或未发布。" }, { status: 404 });

  const scene = JSON.parse(row.scene_json) as ImmersiveScene;
  const author = row.owner_user_id
    ? await env.DB.prepare(
        "SELECT id, username, avatar_key, created_at, updated_at FROM users WHERE id = ?",
      )
        .bind(row.owner_user_id)
        .first<{
          id: string;
          username: string;
          avatar_key: string | null;
          created_at: string;
          updated_at: string;
        }>()
    : null;
  const provenance = await env.DB.prepare(
    `SELECT provider, model, status, started_at, finished_at
     FROM image_gen_tasks
     WHERE project_id = ? AND status = 'succeeded'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(id)
    .first<{
      provider: string;
      model: string;
      status: string;
      started_at: string | null;
      finished_at: string | null;
    }>();
  const assets = await env.DB.prepare(
    "SELECT * FROM assets WHERE project_id = ? AND status = 'ready' ORDER BY kind, created_at",
  )
    .bind(id)
    .all<AssetRow>();

  return json({
    project: {
      id: row.id,
      title: row.title,
      mode: row.mode,
      workflowStep: row.workflow_step,
      publicationStatus: row.publication_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      history: {
        captureTime: row.capture_time,
        location: row.location,
        notes: row.notes,
        subtitle: scene.subtitle ?? "",
        metadata: scene.metadata ?? null,
      },
      images: {
        originalImageUrl: absoluteUrl(origin, row.original_image_url),
        originalThumbnailUrl: absoluteUrl(origin, row.original_thumbnail_url),
        panoramaImageUrl: absoluteUrl(origin, row.panorama_image_url),
        panoramaThumbnailUrl: absoluteUrl(origin, row.panorama_thumbnail_url),
      },
      render: {
        projection: scene.projection ?? null,
        view: scene.view,
        hotspots: scene.hotspots ?? [],
      },
      assets: assets.results.map((asset) => assetItem(asset, origin)),
      author: author
        ? {
            username: author.username,
            avatar: author.avatar_key
              ? `${origin}/api/users/${encodeURIComponent(author.id)}/avatar?v=${encodeURIComponent(author.updated_at)}`
              : "",
            createdAt: author.created_at,
          }
        : null,
      aiProvenance: provenance
        ? {
            provider: provenance.provider,
            model: provenance.model,
            status: provenance.status,
            startedAt: provenance.started_at,
            finishedAt: provenance.finished_at,
          }
        : null,
      scene: sceneToAbsolute(scene, origin),
    },
  });
}

async function listProjectAssets(env: PublicApiEnv, projectId: string, origin: string) {
  const project = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND publication_status = 'published'",
  )
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) return json({ error: "项目不存在或未发布。" }, { status: 404 });
  const assets = await env.DB.prepare(
    "SELECT * FROM assets WHERE project_id = ? AND status = 'ready' ORDER BY kind, created_at",
  )
    .bind(projectId)
    .all<AssetRow>();
  return json({ assets: assets.results.map((asset) => assetItem(asset, origin)) });
}

const SWAGGER_UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MemoScapeLab 对外 API 文档</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: "/api/v1/openapi.json", dom_id: "#swagger-ui" });
  </script>
</body>
</html>`;

/**
 * /api/v1 入口：文档、已发布项目详情与资产清单免 Key；
 * 聚合列表仍要求 Authorization: Bearer <READ_API_KEY>。
 */
export async function handlePublicApi(request: Request, env: PublicApiEnv, url: URL): Promise<Response> {
  const configuredKey = (env.READ_API_KEY ?? "").trim();
  const origin = new URL(request.url).origin;
  const assetsMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/assets$/);
  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
  const isPublishedProjectEndpoint = Boolean(assetsMatch || projectMatch);
  const cors = isPublishedProjectEndpoint
    ? publishedProjectCorsHeaders(request)
    : corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors ?? { "access-control-max-age": "0" },
    });
  }

  if (url.pathname === "/api/v1/openapi.json") {
    return withCors(new Response(JSON.stringify(openapiDocument), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    }), cors);
  }
  if (url.pathname === "/api/v1/docs") {
    return withCors(new Response(SWAGGER_UI_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    }), cors);
  }

  // 发布即开放：单个已发布项目及其资产清单无需全局 READ_API_KEY。
  // 查询函数自身只接受 publication_status='published'，草稿仍统一返回 404。
  if (isPublishedProjectEndpoint) {
    if (request.method !== "GET") {
      return withCors(json({ error: "仅支持 GET 请求。" }, { status: 405 }), cors);
    }
    if (assetsMatch) {
      return withCors(await listProjectAssets(env, decodeURIComponent(assetsMatch[1]), origin), cors);
    }
    return withCors(await projectDetail(env, decodeURIComponent(projectMatch![1]), origin), cors);
  }

  if (!configuredKey) {
    return withCors(json({ error: "对外 API 未启用（缺少 READ_API_KEY）。" }, { status: 503 }), cors);
  }
  const supplied = bearerKey(request);
  if (!supplied || !timingSafeEqual(supplied, configuredKey)) {
    return withCors(json({ error: "API Key 缺失或无效。" }, { status: 401 }), cors);
  }
  if (request.method !== "GET") {
    return withCors(json({ error: "仅支持 GET 请求。" }, { status: 405 }), cors);
  }

  if (url.pathname === "/api/v1/projects" && request.method === "GET") {
    return withCors(await listProjects(env, url, origin), cors);
  }
  return withCors(json({ error: "接口不存在。" }, { status: 404 }), cors);
}
