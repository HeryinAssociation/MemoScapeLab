/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  CREATE_PROJECTS_OWNER_INDEX,
  CREATE_PROJECTS_TABLE,
  CREATE_PROJECTS_UPDATED_INDEX,
} from "../db/schema";
import type { ImmersiveScene, SceneMode } from "../src/core/projection-types";
import { BUNDLED_PROJECTS } from "../src/projects/bundled-projects";
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

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env extends AuthEnv {
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
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
      .bind(id)
      .first<ProjectRow>();
    return json({ project: projectFromRow(row!) });
  }

  return json({ error: "不支持的请求方式。" }, { status: 405 });
}

async function handleAssetsApi(request: Request, env: Env, url: URL) {
  if (url.pathname === "/api/assets" && request.method === "POST") {
    const auth = await getAuth(request, env.DB);
    if (!auth) return json({ error: "请先登录。" }, { status: 401 });
    if (!auth.user.email_verified) return json({ error: "请先验证注册邮箱。" }, { status: 403 });
    if (auth.user.must_change_password) return json({ error: "请先修改临时密码。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return json({ error: "请选择有效的图片文件。" }, { status: 400 });
    }
    if (file.size > 30 * 1024 * 1024) {
      return json({ error: "单张图片不能超过 30 MB。" }, { status: 413 });
    }
    const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
    const key = `users/${auth.user.id}/projects/${crypto.randomUUID()}${extension}`;
    await env.MEDIA.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    return json({ key, url: `/api/assets/${encodeURIComponent(key)}` }, { status: 201 });
  }

  const match = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (match && request.method === "GET") {
    const object = await env.MEDIA.get(decodeURIComponent(match[1]));
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
        ["/login", "/reg", "/verify-email", "/proj", "/work", "/usr", "/usradmin"].some(
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

      if (["/proj", "/work", "/usr", "/usradmin"].some(
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
        if (url.pathname.startsWith("/usradmin") && auth.user.role !== "superadmin") {
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
