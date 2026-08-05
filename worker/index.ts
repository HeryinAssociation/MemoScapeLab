/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  CREATE_ASSETS_OWNER_INDEX,
  CREATE_ASSETS_PROJECT_INDEX,
  CREATE_ASSETS_TABLE,
  IMAGE_GEN_SCHEMA_STATEMENTS,
  SETTINGS_SCHEMA_STATEMENTS,
  CREATE_PROJECTS_OWNER_INDEX,
  CREATE_PROJECTS_TABLE,
  CREATE_PROJECTS_UPDATED_INDEX,
} from "../db/schema";
import type { ImmersiveScene, SceneMode } from "../src/core/projection-types";
import { BUNDLED_PROJECTS } from "../src/projects/bundled-projects";
import { assetToDataUrl, resolveImageGenProvider, runImageGen } from "./image-gen";
import {
  getImageGenSettingsView,
  saveImageGenSettings,
  type ImageGenSettingsInput,
} from "./image-gen/settings";
import { ImageGenError } from "./image-gen/types";
import {
  ensureAuthDatabase,
  ensureSuperadmin,
  getAuth,
  handleAuthApi,
  isLocalRequest,
  json,
  requireCsrf,
  type AuthEnv,
  type D1Database,
  type R2Bucket,
} from "./auth";
import {
  createLightCosPresignedUrl,
  inspectLightCosObject,
  lightCosBucketForKind,
  lightCosConfigFromEnv,
  missingLightCosBindings,
  validateLightCosUpload,
  type LightCosAssetKind,
  type LightCosBindings,
} from "./lightcos";
import type { ImageGenEnv } from "./image-gen";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env extends AuthEnv, LightCosBindings, ImageGenEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ProjectRow {
  id: string;
  title: string;
  capture_time: string;
  location: string;
  notes: string;
  mode: SceneMode;
  original_image_url: string;
  panorama_image_url: string;
  scene_json: string;
  workflow_step: number;
  publication_status: "draft" | "published";
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AssetRow {
  id: string;
  project_id: string | null;
  owner_user_id: string;
  kind: LightCosAssetKind;
  storage_provider: "lightcos";
  bucket: string;
  region: string;
  object_key: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  etag: string;
  visibility: "private" | "published";
  status: "pending" | "ready" | "failed";
  created_at: string;
  updated_at: string;
}

function projectFromRow(row: ProjectRow) {
  return {
    id: row.id,
    title: row.title,
    captureTime: row.capture_time,
    location: row.location,
    notes: row.notes,
    mode: row.mode,
    originalImageUrl: row.original_image_url,
    panoramaImageUrl: row.panorama_image_url,
    scene: JSON.parse(row.scene_json) as ImmersiveScene,
    workflowStep: row.workflow_step,
    publicationStatus: row.publication_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureDatabase(env: Env, url: URL) {
  const db = env.DB;
  await ensureAuthDatabase(db);
  await db.batch([
    db.prepare(CREATE_PROJECTS_TABLE),
    db.prepare(CREATE_PROJECTS_UPDATED_INDEX),
    ...IMAGE_GEN_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)),
    ...SETTINGS_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)),
    db.prepare(CREATE_ASSETS_TABLE),
    db.prepare(CREATE_ASSETS_PROJECT_INDEX),
    db.prepare(CREATE_ASSETS_OWNER_INDEX),
  ]);
  const columns = await db.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "owner_user_id")) {
    await db.prepare("ALTER TABLE projects ADD COLUMN owner_user_id TEXT REFERENCES users(id)").run();
  }
  await db.prepare(CREATE_PROJECTS_OWNER_INDEX).run();
  const superadminId = await ensureSuperadmin(env);

  const now = new Date().toISOString();

  await db.batch(
    BUNDLED_PROJECTS.map((project) =>
      db
        .prepare(`
          INSERT OR IGNORE INTO projects (
            id, title, capture_time, location, notes, mode,
            original_image_url, panorama_image_url, scene_json,
            workflow_step, publication_status, owner_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          project.id,
          project.title,
          project.captureTime,
          project.location,
          project.notes,
          project.mode,
          project.originalImageUrl,
          project.panoramaImageUrl,
          JSON.stringify(project.scene),
          3,
          "draft",
          superadminId,
          now,
          now,
        ),
    ),
  );

  if (superadminId) {
    await db.prepare("UPDATE projects SET owner_user_id = ? WHERE owner_user_id IS NULL")
      .bind(superadminId)
      .run();
  }

  // Upgrade only the two legacy placeholder rows. Once their original and
  // panorama URLs differ, later requests leave all user edits untouched.
  await db.batch(
    BUNDLED_PROJECTS.map((project) =>
      db
        .prepare(`
          UPDATE projects SET
            title = ?, capture_time = ?, location = ?, notes = ?, mode = ?,
            original_image_url = ?, panorama_image_url = ?, scene_json = ?,
            workflow_step = ?, updated_at = ?
          WHERE id = ? AND original_image_url = panorama_image_url
        `)
        .bind(
          project.title,
          project.captureTime,
          project.location,
          project.notes,
          project.mode,
          project.originalImageUrl,
          project.panoramaImageUrl,
          JSON.stringify(project.scene),
          3,
          now,
          project.id,
        ),
    ),
  );
}

function normalizedProjectInput(body: Record<string, unknown>, id?: string) {
  const scene = body.scene as ImmersiveScene | undefined;
  if (!scene || typeof scene !== "object") {
    throw new Error("缺少有效的场景参数。");
  }
  const title = String(body.title ?? scene.title ?? "未命名项目").trim();
  if (!title) throw new Error("项目标题不能为空。");
  const projectId = id ?? String(body.id ?? crypto.randomUUID());
  const mode = String(body.mode ?? scene.mode ?? "curvedPhoto") as SceneMode;
  return {
    id: projectId,
    title,
    captureTime: String(body.captureTime ?? ""),
    location: String(body.location ?? ""),
    notes: String(body.notes ?? ""),
    mode,
    originalImageUrl: String(body.originalImageUrl ?? ""),
    panoramaImageUrl: String(body.panoramaImageUrl ?? ""),
    workflowStep: Math.min(4, Math.max(1, Number(body.workflowStep ?? 1))),
    publicationStatus:
      body.publicationStatus === "published" ? "published" : "draft",
    scene: { ...scene, id: projectId, title, mode },
  };
}

function assetIdFromUrl(value: string) {
  return value.match(/^\/api\/assets\/([0-9a-f-]{36})$/i)?.[1] ?? null;
}

async function linkProjectAssets(
  db: D1Database,
  ownerUserId: string,
  projectId: string,
  urls: string[],
  publicationStatus: string,
) {
  const assetIds = urls.map(assetIdFromUrl).filter((value): value is string => Boolean(value));
  if (!assetIds.length) return;
  const now = new Date().toISOString();
  await db.batch(assetIds.map((assetId) => db.prepare(`
    UPDATE assets SET project_id = ?, visibility = ?, updated_at = ?
    WHERE id = ? AND owner_user_id = ?
  `).bind(
    projectId,
    publicationStatus === "published" ? "published" : "private",
    now,
    assetId,
    ownerUserId,
  )));
}

async function handleProjectsApi(request: Request, env: Env, url: URL) {
  const auth = await getAuth(request, env.DB);
  if (auth?.user.must_change_password) {
    return json({ error: "请先在用户设置中修改临时密码。" }, { status: 403 });
  }

  if (url.pathname === "/api/projects" && request.method === "GET") {
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    const result = await env.DB.prepare(
      "SELECT * FROM projects WHERE owner_user_id = ? ORDER BY updated_at DESC",
    ).bind(auth.user.id).all<ProjectRow>();
    return json({ projects: result.results.map(projectFromRow) });
  }

  if (url.pathname === "/api/projects" && request.method === "POST") {
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    const project = normalizedProjectInput(body);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO projects (
        id, title, capture_time, location, notes, mode,
        original_image_url, panorama_image_url, scene_json,
        workflow_step, publication_status, owner_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        project.id,
        project.title,
        project.captureTime,
        project.location,
        project.notes,
        project.mode,
        project.originalImageUrl,
        project.panoramaImageUrl,
        JSON.stringify(project.scene),
        project.workflowStep,
        project.publicationStatus,
        auth.user.id,
        now,
        now,
      )
      .run();
    await linkProjectAssets(
      env.DB,
      auth.user.id,
      project.id,
      [project.originalImageUrl, project.panoramaImageUrl],
      project.publicationStatus,
    );
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
      .bind(project.id)
      .first<ProjectRow>();
    return json({ project: projectFromRow(row!) }, { status: 201 });
  }

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (!match) return json({ error: "接口不存在。" }, { status: 404 });
  const id = decodeURIComponent(match[1]);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
      .bind(id)
      .first<ProjectRow>();
    if (!row) return json({ error: "项目不存在。" }, { status: 404 });
    if (auth && row.owner_user_id === auth.user.id && !auth.user.email_verified) {
      return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    }
    if (row.publication_status !== "published" && (!auth || row.owner_user_id !== auth.user.id)) {
      return json({ error: "项目不存在或尚未发布。" }, { status: 404 });
    }
    return json({ project: projectFromRow(row) });
  }

  if (request.method === "PUT") {
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    const project = normalizedProjectInput(body, id);
    const existing = await env.DB.prepare(
      "SELECT created_at FROM projects WHERE id = ? AND owner_user_id = ?",
    )
      .bind(id, auth.user.id)
      .first<{ created_at: string }>();
    if (!existing) return json({ error: "项目不存在。" }, { status: 404 });
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE projects SET
        title = ?, capture_time = ?, location = ?, notes = ?, mode = ?,
        original_image_url = ?, panorama_image_url = ?, scene_json = ?,
        workflow_step = ?, publication_status = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(
        project.title,
        project.captureTime,
        project.location,
        project.notes,
        project.mode,
        project.originalImageUrl,
        project.panoramaImageUrl,
        JSON.stringify(project.scene),
        project.workflowStep,
        project.publicationStatus,
        now,
        id,
      )
      .run();
    await linkProjectAssets(
      env.DB,
      auth.user.id,
      id,
      [project.originalImageUrl, project.panoramaImageUrl],
      project.publicationStatus,
    );
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
      .bind(id)
      .first<ProjectRow>();
    return json({ project: projectFromRow(row!) });
  }

  return json({ error: "不支持的请求方式。" }, { status: 405 });
}

async function handleAssetsApi(request: Request, env: Env, url: URL) {
  if (url.pathname === "/api/assets/upload-intent" && request.method === "POST") {
    const auth = await getAuth(request, env.DB);
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    if (auth.user.must_change_password) return json({ error: "请先修改临时密码。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });

    const config = lightCosConfigFromEnv(env);
    if (!config) {
      return json({
        error: `LightCOS 配置不完整，缺少：${missingLightCosBindings(env).join("、")}。`,
      }, { status: 503 });
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const kind = String(body?.kind ?? "") as LightCosAssetKind;
    if (!(["original", "panorama", "thumbnail"] as string[]).includes(kind)) {
      return json({ error: "图片用途无效。" }, { status: 400 });
    }
    const contentType = String(body?.contentType ?? "").toLowerCase();
    const byteSize = Number(body?.size ?? 0);
    let extension = "";
    try {
      extension = validateLightCosUpload(kind, contentType, byteSize).extension;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "图片参数无效。";
      return json({ error: message }, { status: message.includes("不能超过") ? 413 : 400 });
    }

    const projectId = String(body?.projectId ?? "").trim() || null;
    if (projectId) {
      const project = await env.DB.prepare(
        "SELECT id FROM projects WHERE id = ? AND owner_user_id = ?",
      ).bind(projectId, auth.user.id).first<{ id: string }>();
      if (!project) return json({ error: "项目不存在或无权上传素材。" }, { status: 404 });
    }

    const assetId = crypto.randomUUID();
    const bucket = lightCosBucketForKind(config, kind);
    const projectSegment = projectId ?? "unassigned";
    const objectKey = `users/${auth.user.id}/projects/${projectSegment}/${kind}/${assetId}${extension}`;
    const originalFilename = String(body?.filename ?? "image").trim().slice(0, 240) || `image${extension}`;
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO assets (
        id, project_id, owner_user_id, kind, storage_provider,
        bucket, region, object_key, original_filename, content_type,
        byte_size, visibility, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'lightcos', ?, ?, ?, ?, ?, ?, 'private', 'pending', ?, ?)
    `).bind(
      assetId,
      projectId,
      auth.user.id,
      kind,
      bucket,
      config.region,
      objectKey,
      originalFilename,
      contentType,
      byteSize,
      now,
      now,
    ).run();

    return json({
      assetId,
      uploadUrl: `/api/assets/${encodeURIComponent(assetId)}/content`,
      contentType,
    }, { status: 201 });
  }

  const contentMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/content$/);
  if (contentMatch && request.method === "PUT") {
    const auth = await getAuth(request, env.DB);
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    if (auth.user.must_change_password) return json({ error: "请先修改临时密码。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const assetId = decodeURIComponent(contentMatch[1]);
    const asset = await env.DB.prepare(
      "SELECT * FROM assets WHERE id = ? AND owner_user_id = ?",
    ).bind(assetId, auth.user.id).first<AssetRow>();
    if (!asset) return json({ error: "上传记录不存在。" }, { status: 404 });
    if (asset.status !== "pending") return json({ error: "该上传任务已经结束。" }, { status: 409 });

    const contentType = String(request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== asset.content_type) {
      return json({ error: "上传文件类型与登记信息不一致。" }, { status: 400 });
    }

    const config = lightCosConfigFromEnv(env);
    if (!config) {
      return json({
        error: `LightCOS 配置不完整，缺少：${missingLightCosBindings(env).join("、")}。`,
      }, { status: 503 });
    }
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength !== asset.byte_size) {
        throw new Error("接收到的文件大小与登记信息不一致。");
      }
      validateLightCosUpload(asset.kind, asset.content_type, bytes.byteLength);
      const uploadUrl = await createLightCosPresignedUrl({
        config,
        method: "PUT",
        bucket: asset.bucket,
        key: asset.object_key,
        expiresInSeconds: 5 * 60,
      });
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": asset.content_type },
        body: bytes,
      });
      if (!uploadResponse.ok) {
        throw new Error(`LightCOS 写入失败（HTTP ${uploadResponse.status}）。`);
      }

      const remote = await inspectLightCosObject(config, asset.bucket, asset.object_key);
      if (remote.size !== asset.byte_size) throw new Error("上传后的文件大小与原文件不一致。");
      if (remote.contentType && remote.contentType !== asset.content_type) {
        throw new Error("上传后的文件类型与原文件不一致。");
      }
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE assets SET etag = ?, status = 'ready', updated_at = ? WHERE id = ?",
      ).bind(remote.etag, now, assetId).run();
      return json({
        asset: {
          id: assetId,
          kind: asset.kind,
          contentType: asset.content_type,
          size: asset.byte_size,
          url: `/api/assets/${encodeURIComponent(assetId)}`,
        },
      });
    } catch (caught) {
      await env.DB.prepare("UPDATE assets SET status = 'failed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), assetId)
        .run();
      return json({ error: caught instanceof Error ? caught.message : "LightCOS 文件校验失败。" }, { status: 502 });
    }
  }

  const match = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (match && request.method === "GET") {
    const assetIdOrLegacyKey = decodeURIComponent(match[1]);
    const asset = await env.DB.prepare(`
      SELECT assets.*, projects.publication_status AS project_publication_status
      FROM assets
      LEFT JOIN projects ON projects.id = assets.project_id
      WHERE assets.id = ?
    `).bind(assetIdOrLegacyKey).first<AssetRow & { project_publication_status: string | null }>();

    if (asset) {
      const auth = await getAuth(request, env.DB);
      const canRead =
        auth?.user.id === asset.owner_user_id ||
        asset.visibility === "published" ||
        asset.project_publication_status === "published";
      if (!canRead || asset.status !== "ready") return new Response("Not found", { status: 404 });
      const config = lightCosConfigFromEnv(env);
      if (!config) return new Response("LightCOS is not configured", { status: 503 });
      const signedUrl = await createLightCosPresignedUrl({
        config,
        method: "GET",
        bucket: asset.bucket,
        key: asset.object_key,
        expiresInSeconds: 5 * 60,
      });
      const remote = await fetch(signedUrl, { method: "GET" });
      if (!remote.ok || !remote.body) {
        return new Response("LightCOS object unavailable", { status: 502 });
      }
      return new Response(remote.body, {
        status: remote.status,
        headers: {
          "content-type": remote.headers.get("content-type") ?? asset.content_type,
          "content-length": remote.headers.get("content-length") ?? String(asset.byte_size),
          etag: remote.headers.get("etag") ?? asset.etag,
          "cache-control": canRead && auth?.user.id !== asset.owner_user_id
            ? "public, max-age=3600"
            : "private, no-store",
        },
      });
    }

    const object = await env.MEDIA.get(assetIdOrLegacyKey);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        etag: object.httpEtag,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  return json({ error: "接口不存在。" }, { status: 404 });
}

/** 图片生成设置：GET 返回掩码视图，PUT 保存（superadmin + CSRF）。 */
async function handleImageGenSettingsApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (url.pathname !== "/api/settings/imagegen") {
    return json({ error: "接口不存在。" }, { status: 404 });
  }
  const auth = await getAuth(request, env.DB);
  if (!auth) return json({ error: "请先登录。" }, { status: 401 });
  if (auth.user.must_change_password) {
    return json({ error: "请先在用户设置中修改临时密码。" }, { status: 403 });
  }
  if (auth.user.role !== "superadmin") {
    return json({ error: "没有管理员权限。" }, { status: 403 });
  }

  if (request.method === "GET") {
    const view = await getImageGenSettingsView(env.DB, env);
    return json(view);
  }

  if (request.method === "PUT") {
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const body = (await request.json().catch(() => null)) as ImageGenSettingsInput | null;
    if (!body || typeof body !== "object") {
      return json({ error: "请求内容无效。" }, { status: 400 });
    }
    try {
      await saveImageGenSettings(env.DB, auth.user.id, body, env);
    } catch (error) {
      if (error instanceof ImageGenError) {
        return json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    return json({ saved: true });
  }

  return json({ error: "接口不存在。" }, { status: 404 });
}

interface ImageGenTaskRow {
  id: string;
  project_id: string;
  owner_user_id: string | null;
  provider: string;
  model: string;
  prompt: string;
  reference_image_keys: string;
  status: "pending" | "running" | "succeeded" | "failed";
  result_keys: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const DEFAULT_GEN_PROMPT =
  "把这张历史照片自然地扩展为可 360 度沉浸浏览的全景图，保持原有建筑、人物与光线风格一致，向四周平滑补全环境细节。";

// 僵尸任务回收阈值：超过该时长仍未结束的 running/pending 任务视为中断
const STALE_TASK_MS = 10 * 60 * 1000;

async function handleGenerateApi(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  // 提交生成任务：登录 + CSRF + 项目所有权，后台 waitUntil 执行
  if (url.pathname === "/api/generate" && request.method === "POST") {
    const auth = await getAuth(request, env.DB);
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    if (auth.user.must_change_password) return json({ error: "请先修改临时密码。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });

    const body = (await request.json().catch(() => null)) as {
      projectId?: unknown;
      prompt?: unknown;
      size?: unknown;
      quality?: unknown;
      provider?: unknown;
    } | null;
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    if (!projectId) return json({ error: "缺少项目 ID。" }, { status: 400 });

    const project = await env.DB
      .prepare("SELECT * FROM projects WHERE id = ?")
      .bind(projectId)
      .first<ProjectRow>();
    if (!project) return json({ error: "项目不存在。" }, { status: 404 });
    if (project.owner_user_id !== auth.user.id && auth.user.role !== "superadmin") {
      return json({ error: "无权操作该项目。" }, { status: 403 });
    }
    if (!project.original_image_url) {
      return json({ error: "请先上传原图。" }, { status: 400 });
    }

    const prompt =
      typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : DEFAULT_GEN_PROMPT;
    const size = typeof body?.size === "string" && body.size ? body.size : undefined;
    const quality =
      body?.quality === "low" || body?.quality === "medium" || body?.quality === "high"
        ? body.quality
        : undefined;

    // 提前解析厂商，未配置时立即报错而不是后台失败
    const provider = await resolveImageGenProvider(env, body?.provider as string | undefined);
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO image_gen_tasks (
          id, project_id, owner_user_id, provider, model, prompt,
          reference_image_keys, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(
        taskId,
        projectId,
        auth.user.id,
        provider.adapter.name,
        provider.config.model,
        prompt,
        JSON.stringify([project.original_image_url]),
        now,
      )
      .run();

    ctx.waitUntil(runImageGenTask(env, taskId));
    return json({ taskId, status: "pending" }, { status: 202 });
  }

  // 查询任务状态（轮询）：登录 + 任务所有权
  const match = url.pathname.match(/^\/api\/generate\/([^/]+)$/);
  if (match && request.method === "GET") {
    const auth = await getAuth(request, env.DB);
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    const task = await env.DB
      .prepare("SELECT * FROM image_gen_tasks WHERE id = ?")
      .bind(match[1])
      .first<ImageGenTaskRow>();
    if (!task) return json({ error: "任务不存在。" }, { status: 404 });
    if (task.owner_user_id !== auth.user.id && auth.user.role !== "superadmin") {
      return json({ error: "无权查看该任务。" }, { status: 403 });
    }
    // 僵尸任务回收：后台执行中断（如 dev server 重启）会导致任务永远卡在 running/pending
    if (task.status === "running" || task.status === "pending") {
      const anchor = task.status === "running" ? task.started_at : task.created_at;
      if (anchor && Date.now() - new Date(anchor).getTime() > STALE_TASK_MS) {
        const staleError = "生成超时，任务已中断。";
        await env.DB
          .prepare(
            "UPDATE image_gen_tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
          )
          .bind(staleError, new Date().toISOString(), task.id)
          .run();
        task.status = "failed";
        task.error = staleError;
      }
    }
    const resultKeys = JSON.parse(task.result_keys) as string[];
    return json({
      taskId: task.id,
      status: task.status,
      error: task.error,
      provider: task.provider,
      model: task.model,
      images: resultKeys.map((key) => ({ key, url: `/api/assets/${encodeURIComponent(key)}` })),
    });
  }

  return json({ error: "接口不存在。" }, { status: 404 });
}

/** 后台执行生成：调用厂商 → 落 R2 → 更新任务状态与项目的全景图。 */
async function runImageGenTask(env: Env, taskId: string) {
  const now = () => new Date().toISOString();
  try {
    const task = await env.DB
      .prepare("SELECT * FROM image_gen_tasks WHERE id = ?")
      .bind(taskId)
      .first<ImageGenTaskRow>();
    if (!task) return;
    await env.DB
      .prepare("UPDATE image_gen_tasks SET status = 'running', started_at = ? WHERE id = ?")
      .bind(now(), taskId)
      .run();

    const provider = await resolveImageGenProvider(env);
    // 参考图 = R2 资产转 Base64 data URL（厂商无法访问本地 localhost /api/assets 地址）
    const referenceImages: string[] = [];
    for (const path of JSON.parse(task.reference_image_keys) as string[]) {
      referenceImages.push(await assetToDataUrl(env.MEDIA, path));
    }
    const result = await runImageGen({
      adapter: provider.adapter,
      config: provider.config,
      request: {
        prompt: task.prompt,
        referenceImages,
        watermark: false,
      },
      r2: env.MEDIA,
      r2KeyPrefix: `users/${task.owner_user_id ?? "unknown"}/projects/${task.project_id}/generated`,
    });
    const resultKeys = result.images.map((image) => image.key);
    await env.DB.batch([
      env.DB
        .prepare(
          "UPDATE image_gen_tasks SET status = 'succeeded', result_keys = ?, finished_at = ? WHERE id = ?",
        )
        .bind(JSON.stringify(resultKeys), now(), taskId),
      env.DB
        .prepare("UPDATE projects SET panorama_image_url = ?, updated_at = ? WHERE id = ?")
        .bind(`/api/assets/${encodeURIComponent(resultKeys[0])}`, now(), task.project_id),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB
      .prepare("UPDATE image_gen_tasks SET status = 'failed', error = ?, finished_at = ? WHERE id = ?")
      .bind(message, now(), taskId);
  }
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      const needsDatabase =
        url.pathname.startsWith("/api/") ||
        url.pathname === "/" ||
["/login", "/reg", "/verify-email", "/proj", "/work", "/about", "/usr", "/usradmin", "/imagegen"].some(
          (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
        );
      if (needsDatabase) await ensureDatabase(env, url);

      if (url.pathname === "/") {
        const auth = await getAuth(request, env.DB);
        const destination = !auth
          ? "/login"
          : auth.user.must_change_password
            ? "/usr?password=required"
            : auth.user.email_verified
              ? "/proj"
              : "/verify-email?pending=1";
        return Response.redirect(new URL(destination, request.url), 302);
      }

      if (url.pathname === "/login" || url.pathname === "/reg") {
        const auth = await getAuth(request, env.DB);
        if (auth) {
          const destination = auth.user.must_change_password
            ? "/usr?password=required"
            : auth.user.email_verified
              ? "/proj"
              : "/verify-email?pending=1";
          return Response.redirect(new URL(destination, request.url), 302);
        }
      }

if (["/proj", "/work", "/about", "/usr", "/usradmin", "/imagegen"].some(
        (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
      )) {
        const auth = await getAuth(request, env.DB);
        if (!auth) return Response.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, request.url), 302);
        const isUserSettings = url.pathname === "/usr" || url.pathname.startsWith("/usr/");
        if (auth.user.must_change_password && !isUserSettings) {
          return Response.redirect(new URL("/usr?password=required", request.url), 302);
        }
        if (!auth.user.email_verified && !isUserSettings) {
          return Response.redirect(new URL("/verify-email?pending=1", request.url), 302);
        }
        if (
          (url.pathname.startsWith("/usradmin") || url.pathname.startsWith("/imagegen")) &&
          auth.user.role !== "superadmin"
        ) {
          return Response.redirect(new URL("/proj", request.url), 302);
        }
      }

      if (
        url.pathname.startsWith("/api/auth/") ||
        url.pathname.startsWith("/api/users/") ||
        url.pathname.startsWith("/api/admin/")
      ) {
        return await handleAuthApi(request, env, url);
      }
      if (url.pathname === "/api/projects" || url.pathname.startsWith("/api/projects/")) {
        return await handleProjectsApi(request, env, url);
      }
      if (url.pathname === "/api/assets" || url.pathname.startsWith("/api/assets/")) {
        return await handleAssetsApi(request, env, url);
      }
      if (url.pathname === "/api/generate" || url.pathname.startsWith("/api/generate/")) {
        return await handleGenerateApi(request, env, url, ctx);
      }
      if (url.pathname === "/api/settings/imagegen") {
        return await handleImageGenSettingsApi(request, env, url);
      }
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "服务器处理失败。" },
        { status: 500 },
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
