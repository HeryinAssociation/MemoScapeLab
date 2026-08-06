import { AUTH_SCHEMA_STATEMENTS } from "../db/schema";
import { sendTencentVerificationCodeWithRetry } from "./tencent-ses";
import {
  createLightCosPresignedUrl,
  inspectLightCosObject,
  lightCosBucketForKind,
  lightCosConfigFromEnv,
  missingLightCosBindings,
  validateLightCosUpload,
  type LightCosBindings,
} from "./lightcos";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<unknown>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface AuthEnv extends LightCosBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  PASSWORD_PEPPER?: string;
  SUPERADMIN_USERNAME?: string;
  SUPERADMIN_EMAIL?: string;
  SUPERADMIN_PASSWORD?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_PROVIDER?: string;
  TENCENTCLOUD_SECRET_ID?: string;
  TENCENTCLOUD_SECRET_KEY?: string;
  TENCENT_SES_REGION?: string;
  TENCENT_SES_FROM?: string;
  TENCENT_SES_TEMPLATE_ID?: string;
  /** 对外只读 API（/api/v1）的 Bearer 密钥；未配置时数据接口返回 503。 */
  READ_API_KEY?: string;
  /** 对外 API 允许的跨域来源，多个用英文逗号分隔。 */
  PUBLIC_API_ALLOWED_ORIGIN?: string;
}

export interface UserRow {
  id: string;
  username: string;
  email: string;
  email_verified: number;
  phone_e164: string | null;
  phone_verified: number;
  password_hash: string;
  avatar_key: string | null;
  role: "user" | "superadmin";
  status: "active" | "banned";
  must_change_password: number;
  created_at: string;
  updated_at: string;
  banned_at: string | null;
}

export interface AuthContext {
  user: UserRow;
  tokenHash: string;
  csrfToken: string;
}

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const EMAIL_TOKEN_MINUTES = 30;
const EMAIL_RESEND_SECONDS = 60;
const PASSWORD_ITERATIONS = 600_000;
const SUPERADMIN_ID = "00000000-0000-4000-8000-000000000001";
const encoder = new TextEncoder();

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function randomVerificationCode() {
  const maximum = 2 ** 32 - ((2 ** 32) % 1_000_000);
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= maximum);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

export async function hashText(value: string) {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
}

function passwordMaterial(password: string, pepper = "") {
  return pepper ? `${password}\u0000${pepper}` : password;
}

export async function hashPassword(password: string, pepper = "") {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passwordMaterial(password, pepper)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string, pepper = "") {
  const [algorithm, iterationsValue, saltValue, expectedValue] = stored.split("$");
  const iterations = Number(iterationsValue);
  if (
    algorithm !== "pbkdf2_sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltValue ||
    !expectedValue
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passwordMaterial(password, pepper)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64UrlToBytes(saltValue),
        iterations,
      },
      key,
      256,
    ),
  );
  const expected = base64UrlToBytes(expectedValue);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export async function ensureAuthDatabase(db: D1Database) {
  await db.batch(AUTH_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
}

export function isLocalRequest(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export async function ensureSuperadmin(env: AuthEnv) {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1")
    .first<{ id: string }>();
  if (existing) return existing.id;

  const password = env.SUPERADMIN_PASSWORD || "";
  if (!password) return null;
  const username = normalizeUsername(env.SUPERADMIN_USERNAME || "superadmin");
  const email = normalizeEmail(env.SUPERADMIN_EMAIL || "admin@memoscapelab.local");
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password, env.PASSWORD_PEPPER);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO users (
      id, username, email, email_verified, phone_e164, phone_verified,
      password_hash, role, status, must_change_password, created_at, updated_at
    ) VALUES (?, ?, ?, 1, NULL, 0, ?, 'superadmin', 'active', 1, ?, ?)
  `)
    .bind(SUPERADMIN_ID, username, email, passwordHash, now, now)
    .run();
  return SUPERADMIN_ID;
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUsername(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  const raw = String(value ?? "").replace(/[\s()-]/g, "");
  if (!raw) return null;
  if (/^1[3-9]\d{9}$/.test(raw)) return `+86${raw}`;
  if (/^\+861[3-9]\d{9}$/.test(raw)) return raw;
  return "";
}

function validateRegistration(username: string, email: string, password: string, phone: string | null) {
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) {
    return "用户名应为 2–32 个汉字、字母、数字、下划线或短横线。";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return "请输入有效的注册邮箱。";
  }
  if (password.length < 8 || password.length > 128) {
    return "密码长度应为 8–128 个字符。";
  }
  if (phone === "") return "手机号仅支持中国大陆 +86 手机号码。";
  return "";
}

function parseCookies(request: Request) {
  const result = new Map<string, string>();
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    result.set(item.slice(0, index).trim(), item.slice(index + 1).trim());
  }
  return result;
}

function cookieName(request: Request) {
  return new URL(request.url).protocol === "https:" ? "__Host-ap_session" : "ap_session";
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request)}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

async function createSession(request: Request, db: D1Database, userId: string) {
  const token = randomToken();
  const tokenHash = await hashText(token);
  const csrfToken = randomToken(24);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await db.prepare(`
    INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(tokenHash, userId, csrfToken, expires.toISOString(), now.toISOString(), now.toISOString())
    .run();
  return { token, csrfToken };
}

export async function getAuth(request: Request, db: D1Database): Promise<AuthContext | null> {
  const cookies = parseCookies(request);
  const token = cookies.get("__Host-ap_session") || cookies.get("ap_session");
  if (!token || token.length > 256) return null;
  const tokenHash = await hashText(token);
  const row = await db.prepare(`
    SELECT u.*, s.csrf_token, s.expires_at
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `)
    .bind(tokenHash)
    .first<UserRow & { csrf_token: string; expires_at: string }>();
  if (!row) return null;
  if (row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return { user: row, tokenHash, csrfToken: row.csrf_token };
}

export function publicUser(user: UserRow, projectCount?: number) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    phone: user.phone_e164,
    phoneVerified: Boolean(user.phone_verified),
    role: user.role,
    status: user.status,
    mustChangePassword: Boolean(user.must_change_password),
    avatarUrl: user.avatar_key ? `/api/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.updated_at)}` : "",
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    ...(projectCount === undefined ? {} : { projectCount }),
  };
}

export function requireCsrf(request: Request, auth: AuthContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("x-csrf-token") === auth.csrfToken;
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function createEmailVerification(env: AuthEnv, request: Request, user: UserRow) {
  const previous = await env.DB.prepare(`
    SELECT created_at FROM email_verification_tokens
    WHERE user_id = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `)
    .bind(user.id)
    .first<{ created_at: string }>();
  if (
    previous &&
    Date.now() - new Date(previous.created_at).getTime() < EMAIL_RESEND_SECONDS * 1000
  ) {
    return { delivery: "rate_limited" as const, retryAfter: EMAIL_RESEND_SECONDS };
  }

  const provider = String(env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const useTencent = provider === "tencent-ses" || (
    !provider && Boolean(env.TENCENTCLOUD_SECRET_ID || env.TENCENTCLOUD_SECRET_KEY)
  );
  const useResend = provider === "resend" || (!provider && Boolean(env.RESEND_API_KEY));
  const credential = useResend ? randomToken() : randomVerificationCode();
  const tokenHash = await hashText(credential);
  const now = new Date();
  const expires = new Date(now.getTime() + EMAIL_TOKEN_MINUTES * 60 * 1000);
  await env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ? AND consumed_at IS NULL")
    .bind(user.id)
    .run();
  await env.DB.prepare(`
    INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `)
    .bind(tokenHash, user.id, expires.toISOString(), now.toISOString())
    .run();

  const discardUndeliveredCredential = () => env.DB.prepare(`
    DELETE FROM email_verification_tokens
    WHERE user_id = ? AND token_hash = ? AND consumed_at IS NULL
  `)
    .bind(user.id, tokenHash)
    .run();

  if (useTencent) {
    const templateId = Number(env.TENCENT_SES_TEMPLATE_ID);
    if (
      !env.TENCENTCLOUD_SECRET_ID ||
      !env.TENCENTCLOUD_SECRET_KEY ||
      !env.TENCENT_SES_FROM ||
      !Number.isSafeInteger(templateId) ||
      templateId <= 0
    ) {
      await discardUndeliveredCredential();
      return { delivery: "not_configured" as const };
    }
    const result = await sendTencentVerificationCodeWithRetry(
      {
        secretId: env.TENCENTCLOUD_SECRET_ID,
        secretKey: env.TENCENTCLOUD_SECRET_KEY,
        region: env.TENCENT_SES_REGION || "ap-guangzhou",
        from: env.TENCENT_SES_FROM,
        templateId,
      },
      user.email,
      credential,
    );
    if (!result.ok) {
      await discardUndeliveredCredential();
      return { delivery: "failed" as const, providerErrorCode: result.errorCode };
    }
    return { delivery: "sent" as const };
  }

  if (!useResend) {
    if (isLocalRequest(new URL(request.url))) {
      return { delivery: "development" as const, devVerificationCode: credential };
    }
    await discardUndeliveredCredential();
    return { delivery: "not_configured" as const };
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    await discardUndeliveredCredential();
    return { delivery: "not_configured" as const };
  }

  const url = new URL("/verify-email", request.url);
  url.searchParams.set("token", credential);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [user.email],
      subject: "验证您的 MemoscapeLab 注册邮箱",
      html: `<div style="font-family:Arial,sans-serif;color:#07100c"><h2>验证注册邮箱</h2><p>${escapeHtml(user.username)}，您好。请在 30 分钟内完成邮箱验证。</p><p><a href="${escapeHtml(url.toString())}" style="display:inline-block;padding:12px 18px;background:#173c2e;color:#f4f1e8;text-decoration:none">验证邮箱</a></p><p>如果不是您本人操作，请忽略此邮件。</p></div>`,
    }),
  });
  if (!response.ok) {
    await discardUndeliveredCredential();
    return { delivery: "failed" as const };
  }
  return { delivery: "sent" as const };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

async function authAttemptKey(request: Request, identifier: string) {
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  return hashText(`${identifier.toLowerCase()}\u0000${address}`);
}

async function isLoginLocked(db: D1Database, key: string) {
  const row = await db.prepare("SELECT locked_until FROM auth_attempts WHERE key_hash = ?")
    .bind(key)
    .first<{ locked_until: string | null }>();
  return Boolean(row?.locked_until && new Date(row.locked_until).getTime() > Date.now());
}

async function recordLoginFailure(db: D1Database, key: string) {
  const row = await db.prepare("SELECT attempts, window_started_at FROM auth_attempts WHERE key_hash = ?")
    .bind(key)
    .first<{ attempts: number; window_started_at: string }>();
  const now = new Date();
  const expiredWindow = !row || now.getTime() - new Date(row.window_started_at).getTime() > 15 * 60 * 1000;
  const attempts = expiredWindow ? 1 : row.attempts + 1;
  const windowStarted = expiredWindow ? now.toISOString() : row.window_started_at;
  const lockedUntil = attempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null;
  await db.prepare(`
    INSERT INTO auth_attempts (key_hash, attempts, window_started_at, locked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      locked_until = excluded.locked_until
  `)
    .bind(key, attempts, windowStarted, lockedUntil)
    .run();
}

async function audit(db: D1Database, adminId: string, targetId: string | null, action: string, details: unknown = {}) {
  await db.prepare(`
    INSERT INTO admin_audit_logs (id, admin_user_id, target_user_id, action, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(crypto.randomUUID(), adminId, targetId, action, JSON.stringify(details), new Date().toISOString())
    .run();
}

async function deleteUserMedia(env: AuthEnv, userId: string) {
  const lightCosAssets = await env.DB.prepare(`
    SELECT id, bucket, object_key FROM assets
    WHERE owner_user_id = ? AND storage_provider = 'lightcos'
  `).bind(userId).all<{ id: string; bucket: string; object_key: string }>();
  const lightCosConfig = lightCosConfigFromEnv(env);
  if (lightCosConfig) {
    for (const asset of lightCosAssets.results) {
      const deleteUrl = await createLightCosPresignedUrl({
        config: lightCosConfig,
        method: "DELETE",
        bucket: asset.bucket,
        key: asset.object_key,
        expiresInSeconds: 5 * 60,
      });
      await fetch(deleteUrl, { method: "DELETE" });
    }
  }

  let cursor: string | undefined;
  do {
    const result = await env.MEDIA.list({ prefix: `users/${userId}/`, ...(cursor ? { cursor } : {}) });
    const keys = result.objects.map((item) => item.key);
    if (keys.length) await env.MEDIA.delete(keys);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}

export async function handleAuthApi(request: Request, env: AuthEnv, url: URL): Promise<Response> {
  const bodyPath = url.pathname;

  if (bodyPath === "/api/auth/register" && request.method === "POST") {
    const body = await readBody(request);
    if (!body) return json({ error: "请求内容无效。" }, { status: 400 });
    const username = normalizeUsername(body.username);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const phone = normalizePhone(body.phone);
    const validationError = validateRegistration(username, email, password, phone);
    if (validationError) return json({ error: validationError }, { status: 400 });

    const duplicate = await env.DB.prepare("SELECT id FROM users WHERE username = ? OR email = ? OR (? IS NOT NULL AND phone_e164 = ?) LIMIT 1")
      .bind(username, email, phone, phone)
      .first<{ id: string }>();
    if (duplicate) return json({ error: "无法使用这些信息完成注册，请检查后重试。" }, { status: 409 });

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password, env.PASSWORD_PEPPER);
    await env.DB.prepare(`
      INSERT INTO users (
        id, username, email, email_verified, phone_e164, phone_verified,
        password_hash, role, status, must_change_password, created_at, updated_at
      ) VALUES (?, ?, ?, 0, ?, 0, ?, 'user', 'active', 0, ?, ?)
    `)
      .bind(userId, username, email, phone, passwordHash, now, now)
      .run();
    const user = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>())!;
    const delivery = await createEmailVerification(env, request, user);
    const session = await createSession(request, env.DB, userId);
    return json(
      { user: publicUser(user, 0), csrfToken: session.csrfToken, ...delivery },
      { status: 201, headers: { "set-cookie": sessionCookie(request, session.token) } },
    );
  }

  if (bodyPath === "/api/auth/login" && request.method === "POST") {
    const body = await readBody(request);
    const identifier = String(body?.identifier ?? "").trim();
    const password = String(body?.password ?? "");
    if (!identifier || !password) return json({ error: "请输入账号和密码。" }, { status: 400 });
    const attemptKey = await authAttemptKey(request, identifier);
    if (await isLoginLocked(env.DB, attemptKey)) {
      return json({ error: "登录尝试过多，请 15 分钟后再试。" }, { status: 429 });
    }
    const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1")
      .bind(identifier, identifier.toLowerCase())
      .first<UserRow>();
    const valid = user
      ? await verifyPassword(password, user.password_hash, env.PASSWORD_PEPPER)
      : (await hashPassword(password), false);
    if (!user || !valid || user.status !== "active") {
      await recordLoginFailure(env.DB, attemptKey);
      return json({ error: "账号或密码不正确，或账号当前不可用。" }, { status: 401 });
    }
    await env.DB.prepare("DELETE FROM auth_attempts WHERE key_hash = ?").bind(attemptKey).run();
    const session = await createSession(request, env.DB, user.id);
    return json(
      { user: publicUser(user), csrfToken: session.csrfToken },
      { headers: { "set-cookie": sessionCookie(request, session.token) } },
    );
  }

  if (bodyPath === "/api/auth/verify-email" && request.method === "POST") {
    const body = await readBody(request);
    const token = String(body?.token ?? "");
    const code = String(body?.code ?? "").trim();
    if (!token && !code) return json({ error: "请输入邮箱验证码。" }, { status: 400 });
    let verificationUserId: string | undefined;
    let attemptKey: string | undefined;
    if (code) {
      const verificationAuth = await getAuth(request, env.DB);
      if (!verificationAuth) return json({ error: "请先登录后再验证邮箱。" }, { status: 401 });
      if (!requireCsrf(request, verificationAuth)) return json({ error: "安全校验失败。" }, { status: 403 });
      if (!/^\d{6}$/.test(code)) return json({ error: "请输入 6 位数字验证码。" }, { status: 400 });
      verificationUserId = verificationAuth.user.id;
      attemptKey = await hashText(`email-verification\u0000${verificationUserId}`);
      if (await isLoginLocked(env.DB, attemptKey)) {
        return json({ error: "验证码尝试次数过多，请 15 分钟后再试。" }, { status: 429 });
      }
    }
    const tokenHash = await hashText(code || token);
    const record = await env.DB.prepare(`
      SELECT user_id, expires_at FROM email_verification_tokens
      WHERE token_hash = ? AND consumed_at IS NULL
        AND (? IS NULL OR user_id = ?)
    `)
      .bind(tokenHash, verificationUserId ?? null, verificationUserId ?? null)
      .first<{ user_id: string; expires_at: string }>();
    if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
      if (attemptKey) await recordLoginFailure(env.DB, attemptKey);
      return json({ error: code ? "验证码不正确或已经过期。" : "验证链接无效或已经过期。" }, { status: 400 });
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE email_verification_tokens SET consumed_at = ? WHERE token_hash = ?").bind(now, tokenHash),
      env.DB.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").bind(now, record.user_id),
    ]);
    if (attemptKey) await env.DB.prepare("DELETE FROM auth_attempts WHERE key_hash = ?").bind(attemptKey).run();
    return json({ verified: true });
  }

  const auth = await getAuth(request, env.DB);

  if (auth?.user.must_change_password && bodyPath.startsWith("/api/admin/")) {
    return json({ error: "请先修改临时密码。" }, { status: 403 });
  }

  if (bodyPath === "/api/auth/me" && request.method === "GET") {
    if (!auth) return json({ error: "尚未登录。" }, { status: 401 });
    const stats = await env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE owner_user_id = ?")
      .bind(auth.user.id)
      .first<{ count: number }>();
    return json({ user: publicUser(auth.user, Number(stats?.count ?? 0)), csrfToken: auth.csrfToken });
  }

  if (bodyPath === "/api/auth/logout" && request.method === "POST") {
    if (auth) {
      if (!requireCsrf(request, auth)) return json({ error: "安全校验失败，请刷新页面后重试。" }, { status: 403 });
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(auth.tokenHash).run();
    }
    return json({ loggedOut: true }, { headers: { "set-cookie": sessionCookie(request, "", 0) } });
  }

  if (bodyPath === "/api/auth/resend-verification" && request.method === "POST") {
    if (!auth) return json({ error: "尚未登录。" }, { status: 401 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    if (auth.user.email_verified) return json({ verified: true });
    const delivery = await createEmailVerification(env, request, auth.user);
    return json(delivery, delivery.delivery === "rate_limited" ? { status: 429 } : {});
  }

  if (bodyPath === "/api/users/me" && request.method === "PATCH") {
    if (!auth) return json({ error: "尚未登录。" }, { status: 401 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const body = await readBody(request);
    const username = normalizeUsername(body?.username);
    const validationError = validateRegistration(username, auth.user.email, "12345678", auth.user.phone_e164);
    if (validationError) return json({ error: validationError }, { status: 400 });
    const duplicate = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id <> ?")
      .bind(username, auth.user.id)
      .first<{ id: string }>();
    if (duplicate) return json({ error: "该用户名已被使用。" }, { status: 409 });
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = ?")
      .bind(username, now, auth.user.id)
      .run();
    const user = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(auth.user.id).first<UserRow>())!;
    return json({ user: publicUser(user) });
  }

  if (bodyPath === "/api/users/me/password" && request.method === "POST") {
    if (!auth) return json({ error: "尚未登录。" }, { status: 401 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const body = await readBody(request);
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    if (!(await verifyPassword(currentPassword, auth.user.password_hash, env.PASSWORD_PEPPER))) {
      return json({ error: "当前密码不正确。" }, { status: 400 });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return json({ error: "新密码长度应为 8–128 个字符。" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(newPassword, env.PASSWORD_PEPPER);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?").bind(passwordHash, now, auth.user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(auth.user.id),
    ]);
    const session = await createSession(request, env.DB, auth.user.id);
    return json(
      { changed: true, csrfToken: session.csrfToken },
      { headers: { "set-cookie": sessionCookie(request, session.token) } },
    );
  }

  if (bodyPath === "/api/users/me/avatar" && request.method === "POST") {
    if (!auth) return json({ error: "尚未登录。" }, { status: 401 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    const thumbnail = form.get("thumbnail");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return json({ error: "头像仅支持 JPG、PNG 或 WebP 图片。" }, { status: 400 });
    }
    if (!(thumbnail instanceof File) || thumbnail.type !== "image/webp") {
      return json({ error: "头像缺少浏览器生成的 WebP 缩略图。" }, { status: 400 });
    }
    let extension = "";
    try {
      extension = validateLightCosUpload("avatar", file.type, file.size).extension;
      validateLightCosUpload("thumbnail", thumbnail.type, thumbnail.size);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "头像参数无效。";
      return json({ error: message }, { status: message.includes("不能超过") ? 413 : 400 });
    }

    const config = lightCosConfigFromEnv(env);
    if (!config) {
      return json({
        error: `LighthouseCOS 配置不完整，缺少：${missingLightCosBindings(env).join("、")}。`,
      }, { status: 503 });
    }

    const assetId = crypto.randomUUID();
    const thumbnailAssetId = crypto.randomUUID();
    const bucket = lightCosBucketForKind(config, "avatar");
    const objectKey = `users/${auth.user.id}/avatars/${assetId}${extension}`;
    const thumbnailObjectKey = `users/${auth.user.id}/avatars/thumbnail/${thumbnailAssetId}.webp`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO assets (
          id, project_id, parent_asset_id, owner_user_id, kind, storage_provider,
          bucket, region, object_key, original_filename, content_type,
          byte_size, visibility, status, created_at, updated_at
        ) VALUES (?, NULL, NULL, ?, 'avatar', 'lightcos', ?, ?, ?, ?, ?, ?, 'published', 'pending', ?, ?)
      `).bind(
        assetId, auth.user.id, bucket, config.region, objectKey,
        file.name.trim().slice(0, 240) || `avatar${extension}`,
        file.type, file.size, now, now,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, project_id, parent_asset_id, owner_user_id, kind, storage_provider,
          bucket, region, object_key, original_filename, content_type,
          byte_size, visibility, status, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, 'thumbnail', 'lightcos', ?, ?, ?, ?, 'image/webp', ?, 'published', 'pending', ?, ?)
      `).bind(
        thumbnailAssetId, assetId, auth.user.id, bucket, config.region, thumbnailObjectKey,
        thumbnail.name.trim().slice(0, 240) || "avatar.thumbnail.webp",
        thumbnail.size, now, now,
      ),
    ]);

    try {
      const uploadObject = async (input: File, key: string) => {
        const uploadUrl = await createLightCosPresignedUrl({
          config, method: "PUT", bucket, key, expiresInSeconds: 5 * 60,
        });
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": input.type },
          body: await input.arrayBuffer(),
        });
        if (!uploadResponse.ok) {
          throw new Error(`LighthouseCOS 写入失败（HTTP ${uploadResponse.status}）。`);
        }
        return inspectLightCosObject(config, bucket, key);
      };
      const remote = await uploadObject(file, objectKey);
      const thumbnailRemote = await uploadObject(thumbnail, thumbnailObjectKey);
      if (remote.size !== file.size) throw new Error("上传后的头像大小与原文件不一致。");
      if (remote.contentType && remote.contentType !== file.type) {
        throw new Error("上传后的头像类型与原文件不一致。");
      }
      if (thumbnailRemote.size !== thumbnail.size || (thumbnailRemote.contentType && thumbnailRemote.contentType !== "image/webp")) {
        throw new Error("上传后的头像缩略图校验失败。");
      }

      const previousAvatar = auth.user.avatar_key;
      const avatarReference = `lightcos:${assetId}`;
      await env.DB.batch([
        env.DB.prepare("UPDATE assets SET etag = ?, status = 'ready', updated_at = ? WHERE id = ?")
          .bind(remote.etag, now, assetId),
        env.DB.prepare("UPDATE assets SET etag = ?, status = 'ready', updated_at = ? WHERE id = ?")
          .bind(thumbnailRemote.etag, now, thumbnailAssetId),
        env.DB.prepare("UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?")
          .bind(avatarReference, now, auth.user.id),
      ]);

      try {
        if (previousAvatar?.startsWith("lightcos:")) {
          const previousId = previousAvatar.slice("lightcos:".length);
          const previous = await env.DB.prepare(`
            SELECT id, bucket, object_key FROM assets
            WHERE owner_user_id = ? AND (id = ? OR parent_asset_id = ?)
          `).bind(auth.user.id, previousId, previousId).all<{ id: string; bucket: string; object_key: string }>();
          for (const previousAsset of previous.results) {
            const deleteUrl = await createLightCosPresignedUrl({
              config,
              method: "DELETE",
              bucket: previousAsset.bucket,
              key: previousAsset.object_key,
              expiresInSeconds: 5 * 60,
            });
            await fetch(deleteUrl, { method: "DELETE" });
          }
          await env.DB.prepare("DELETE FROM assets WHERE id = ? AND owner_user_id = ?")
            .bind(previousId, auth.user.id)
            .run();
        } else if (previousAvatar) {
          await env.MEDIA.delete(previousAvatar);
        }
      } catch {
        // The new avatar is already active; stale-object cleanup is non-blocking.
      }

      return json({
        avatarUrl: `/api/users/${encodeURIComponent(auth.user.id)}/avatar?v=${encodeURIComponent(now)}`,
      });
    } catch (caught) {
      await env.DB.batch([
        env.DB.prepare("UPDATE assets SET status = 'failed', updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), assetId),
        env.DB.prepare("UPDATE assets SET status = 'failed', updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), thumbnailAssetId),
      ]);
      return json({
        error: caught instanceof Error ? caught.message : "LighthouseCOS 头像上传失败。",
      }, { status: 502 });
    }
  }

  const avatarMatch = bodyPath.match(/^\/api\/users\/([^/]+)\/avatar$/);
  if (avatarMatch && request.method === "GET") {
    const userId = decodeURIComponent(avatarMatch[1]);
    const row = await env.DB.prepare("SELECT avatar_key FROM users WHERE id = ?")
      .bind(userId)
      .first<{ avatar_key: string | null }>();
    if (!row?.avatar_key) return new Response("Not found", { status: 404 });
    if (row.avatar_key.startsWith("lightcos:")) {
      const assetId = row.avatar_key.slice("lightcos:".length);
      const asset = await env.DB.prepare(`
        SELECT bucket, object_key, content_type, byte_size, etag, status
        FROM assets
        WHERE owner_user_id = ? AND status = 'ready'
          AND (id = ? OR (parent_asset_id = ? AND kind = 'thumbnail'))
        ORDER BY CASE WHEN kind = 'thumbnail' THEN 0 ELSE 1 END
        LIMIT 1
      `).bind(userId, assetId, assetId).first<{
        bucket: string;
        object_key: string;
        content_type: string;
        byte_size: number;
        etag: string;
        status: string;
      }>();
      if (!asset || asset.status !== "ready") return new Response("Not found", { status: 404 });
      const config = lightCosConfigFromEnv(env);
      if (!config) return new Response("LighthouseCOS is not configured", { status: 503 });
      const readUrl = await createLightCosPresignedUrl({
        config,
        method: "GET",
        bucket: asset.bucket,
        key: asset.object_key,
        expiresInSeconds: 5 * 60,
      });
      const remote = await fetch(readUrl, { method: "GET" });
      if (!remote.ok || !remote.body) return new Response("Not found", { status: 404 });
      return new Response(remote.body, {
        headers: {
          "content-type": remote.headers.get("content-type") ?? asset.content_type,
          "content-length": remote.headers.get("content-length") ?? String(asset.byte_size),
          etag: remote.headers.get("etag") ?? asset.etag,
          "cache-control": "public, max-age=3600",
        },
      });
    }

    const object = await env.MEDIA.get(row.avatar_key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        etag: object.httpEtag,
        "cache-control": "private, max-age=3600",
      },
    });
  }

  if (bodyPath === "/api/admin/users" && request.method === "GET") {
    if (!auth || auth.user.role !== "superadmin") return json({ error: "没有管理员权限。" }, { status: 403 });
    const filters: string[] = [];
    const values: unknown[] = [];
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query) {
      filters.push("(u.username LIKE ? OR u.email LIKE ? OR COALESCE(u.phone_e164, '') LIKE ?)");
      const term = `%${query}%`;
      values.push(term, term, term);
    }
    for (const [parameter, column] of [["role", "u.role"], ["status", "u.status"]] as const) {
      const value = url.searchParams.get(parameter);
      if (value) { filters.push(`${column} = ?`); values.push(value); }
    }
    for (const [parameter, column] of [["emailVerified", "u.email_verified"], ["phoneVerified", "u.phone_verified"]] as const) {
      const value = url.searchParams.get(parameter);
      if (value === "true" || value === "false") { filters.push(`${column} = ?`); values.push(value === "true" ? 1 : 0); }
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await env.DB.prepare(`
      SELECT u.*, COUNT(p.id) AS project_count
      FROM users u LEFT JOIN projects p ON p.owner_user_id = u.id
      ${where}
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500
    `)
      .bind(...values)
      .all<UserRow & { project_count: number }>();
    return json({ users: result.results.map((user) => publicUser(user, Number(user.project_count))) });
  }

  const adminUserMatch = bodyPath.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && (request.method === "PATCH" || request.method === "DELETE")) {
    if (!auth || auth.user.role !== "superadmin") return json({ error: "没有管理员权限。" }, { status: 403 });
    if (!requireCsrf(request, auth)) return json({ error: "安全校验失败。" }, { status: 403 });
    const targetId = decodeURIComponent(adminUserMatch[1]);
    const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<UserRow>();
    if (!target) return json({ error: "用户不存在。" }, { status: 404 });

    if (request.method === "DELETE") {
      if (targetId === auth.user.id) return json({ error: "不能删除当前登录的超级管理员。" }, { status: 400 });
      if (target.role === "superadmin") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin'").first<{ count: number }>();
        if (Number(count?.count ?? 0) <= 1) return json({ error: "不能删除最后一个超级管理员。" }, { status: 400 });
      }
      await deleteUserMedia(env, targetId);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
        env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(targetId),
        env.DB.prepare("DELETE FROM projects WHERE owner_user_id = ?").bind(targetId),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId),
      ]);
      await audit(env.DB, auth.user.id, targetId, "user.deleted", { hardDelete: true });
      return json({ deleted: true });
    }

    const body = await readBody(request);
    if (!body) return json({ error: "请求内容无效。" }, { status: 400 });
    const updates: string[] = [];
    const values: unknown[] = [];
    const details: Record<string, unknown> = {};
    if (typeof body.emailVerified === "boolean") {
      updates.push("email_verified = ?"); values.push(body.emailVerified ? 1 : 0); details.emailVerified = body.emailVerified;
    }
    if (typeof body.phoneVerified === "boolean") {
      if (body.phoneVerified && !target.phone_e164) return json({ error: "未绑定手机号，不能设为已验证。" }, { status: 400 });
      updates.push("phone_verified = ?"); values.push(body.phoneVerified ? 1 : 0); details.phoneVerified = body.phoneVerified;
    }
    if (body.status === "active" || body.status === "banned") {
      if (targetId === auth.user.id && body.status === "banned") return json({ error: "不能封禁当前账号。" }, { status: 400 });
      updates.push("status = ?", "banned_at = ?");
      values.push(body.status, body.status === "banned" ? new Date().toISOString() : null);
      details.status = body.status;
    }
    if (typeof body.newPassword === "string" && body.newPassword) {
      if (body.newPassword.length < 8 || body.newPassword.length > 128) return json({ error: "新密码长度应为 8–128 个字符。" }, { status: 400 });
      updates.push("password_hash = ?", "must_change_password = 1");
      values.push(await hashPassword(body.newPassword, env.PASSWORD_PEPPER));
      details.passwordReset = true;
    }
    if (!updates.length) return json({ error: "没有需要修改的内容。" }, { status: 400 });
    updates.push("updated_at = ?"); values.push(new Date().toISOString(), targetId);
    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    if (body.status === "banned" || details.passwordReset) {
      await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run();
    }
    await audit(env.DB, auth.user.id, targetId, "user.updated", details);
    const user = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<UserRow>())!;
    return json({ user: publicUser(user) });
  }

  return json({ error: "接口不存在。" }, { status: 404 });
}
