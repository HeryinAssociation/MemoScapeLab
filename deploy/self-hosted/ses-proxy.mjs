import http from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const PORT = 8788;
const MAX_BODY_BYTES = 55 * 1024 * 1024;
const ARK_MAX_BODY_BYTES = 90 * 1024 * 1024;
const SES_UPSTREAM = "https://ses.tencentcloudapi.com/";
const ARK_UPSTREAM = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_TIMEOUT_MS = 20_000;
const ARK_TIMEOUT_MS = 180_000;
const ARK_ASYNC_TIMEOUT_MS = 15 * 60_000;
const CALLBACK_TIMEOUT_MS = 120_000;
const JOB_RETENTION_MS = 24 * 60 * 60_000;
const JOB_DIR = "/proxy-data";
const IMAGEGEN_CALLBACK_URL = process.env.IMAGEGEN_CALLBACK_URL || "";
const IMAGEGEN_INTERNAL_TOKEN = process.env.IMAGEGEN_INTERNAL_TOKEN || "";
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const callbackTimers = new Map();
const COS_BUCKETS = new Set([
  process.env.TENCENT_LIGHTCOS_ARCHIVE_BUCKET,
  process.env.TENCENT_LIGHTCOS_MEDIA_BUCKET,
].filter(Boolean));
const COS_REGION = process.env.TENCENT_LIGHTCOS_REGION || "";
const ALLOWED_COS_HOSTS = new Set(
  Array.from(COS_BUCKETS, (bucket) => `${bucket}.cos.${COS_REGION}.myqcloud.com`),
);
const FORWARDED_HEADERS = [
  "authorization",
  "content-type",
  "x-tc-action",
  "x-tc-region",
  "x-tc-timestamp",
  "x-tc-version",
];
const ARK_FORWARDED_HEADERS = ["authorization", "content-type"];

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function jobPaths(jobId) {
  return {
    meta: path.join(JOB_DIR, `${jobId}.json`),
    body: path.join(JOB_DIR, `${jobId}.body`),
  };
}

async function writeAtomic(filePath, value) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function readJob(jobId) {
  const raw = await fs.readFile(jobPaths(jobId).meta, "utf8");
  return JSON.parse(raw);
}

async function writeJob(job) {
  await writeAtomic(jobPaths(job.id).meta, JSON.stringify(job));
}

async function deleteJob(jobId) {
  const timer = callbackTimers.get(jobId);
  if (timer) clearTimeout(timer);
  callbackTimers.delete(jobId);
  const files = jobPaths(jobId);
  await Promise.all([
    fs.rm(files.meta, { force: true }),
    fs.rm(files.body, { force: true }),
  ]);
}

function callbackUrl(jobId) {
  const base = IMAGEGEN_CALLBACK_URL.replace(/\/+$/, "");
  const url = new URL(`${base}/${encodeURIComponent(jobId)}`);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "memoscape" ||
    url.port !== "3000" ||
    !url.pathname.startsWith("/api/internal/imagegen/complete/")
  ) {
    throw new Error("IMAGEGEN_CALLBACK_URL must target the internal memoscape callback");
  }
  return url.toString();
}

function isInternalRequest(request) {
  const token = request.headers["x-memoscape-internal-token"];
  return Boolean(
    IMAGEGEN_INTERNAL_TOKEN &&
    typeof token === "string" &&
    token.length === IMAGEGEN_INTERNAL_TOKEN.length &&
    token === IMAGEGEN_INTERNAL_TOKEN,
  );
}

function callbackDelay(attempt) {
  return [2_000, 5_000, 15_000, 30_000, 60_000][Math.min(attempt, 4)];
}

function scheduleCallback(jobId, delayMs = 0) {
  if (callbackTimers.has(jobId)) return;
  const timer = setTimeout(() => {
    callbackTimers.delete(jobId);
    void deliverCallback(jobId);
  }, delayMs);
  timer.unref?.();
  callbackTimers.set(jobId, timer);
}

async function deliverCallback(jobId) {
  try {
    const job = await readJob(jobId);
    if (job.status !== "callback_pending") return;
    if (Date.now() - new Date(job.createdAt).getTime() > JOB_RETENTION_MS) {
      console.error(`Ark job ${jobId} expired before callback succeeded`);
      await deleteJob(jobId);
      return;
    }
    const body = await fs.readFile(jobPaths(jobId).body);
    const callback = await fetch(callbackUrl(jobId), {
      method: "POST",
      headers: {
        "content-type": job.contentType || "application/json",
        "x-memoscape-internal-token": IMAGEGEN_INTERNAL_TOKEN,
        "x-memoscape-upstream-status": String(job.upstreamStatus || 502),
      },
      body,
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    });
    if (callback.ok) {
      console.log(`Ark job ${jobId} callback accepted after ${job.callbackAttempts || 0} retries`);
      await deleteJob(jobId);
      return;
    }
    const detail = (await callback.text()).slice(0, 300);
    throw new Error(`callback returned ${callback.status}: ${detail}`);
  } catch (error) {
    try {
      const job = await readJob(jobId);
      job.callbackAttempts = (job.callbackAttempts || 0) + 1;
      job.lastCallbackError = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
      console.error(`Ark job ${jobId} callback failed`, job.lastCallbackError);
      scheduleCallback(jobId, callbackDelay(job.callbackAttempts - 1));
    } catch (readError) {
      if (readError?.code !== "ENOENT") {
        console.error(`Ark job ${jobId} callback state failed`, readError instanceof Error ? readError.message : String(readError));
      }
    }
  }
}

async function completeArkJob(jobId, upstreamStatus, contentType, body, error = "") {
  const now = new Date().toISOString();
  await writeAtomic(jobPaths(jobId).body, body);
  const current = await readJob(jobId);
  await writeJob({
    ...current,
    status: "callback_pending",
    upstreamStatus,
    contentType,
    error,
    updatedAt: now,
  });
  scheduleCallback(jobId);
}

async function executeArkJob(jobId, headers, body) {
  const started = Date.now();
  console.log(`Ark job ${jobId} started (${body.length} request bytes)`);
  try {
    const upstream = await fetch(ARK_UPSTREAM, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(ARK_ASYNC_TIMEOUT_MS),
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    if (responseBody.length > ARK_MAX_BODY_BYTES) {
      throw new Error(`Ark response exceeded ${ARK_MAX_BODY_BYTES} bytes`);
    }
    console.log(`Ark job ${jobId} finished status=${upstream.status} durationMs=${Date.now() - started} responseBytes=${responseBody.length}`);
    await completeArkJob(
      jobId,
      upstream.status,
      upstream.headers.get("content-type") || "application/json",
      responseBody,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Ark job ${jobId} failed durationMs=${Date.now() - started}`, message);
    await completeArkJob(
      jobId,
      502,
      "application/json; charset=utf-8",
      Buffer.from(JSON.stringify({ error: { message: `Ark proxy error: ${message}` } })),
      message,
    );
  }
}

async function resumeJobs() {
  await fs.mkdir(JOB_DIR, { recursive: true, mode: 0o700 });
  for (const filename of await fs.readdir(JOB_DIR)) {
    if (!filename.endsWith(".json")) continue;
    const jobId = filename.slice(0, -5);
    if (!JOB_ID_PATTERN.test(jobId)) continue;
    try {
      const job = await readJob(jobId);
      if (job.status === "running") {
        await completeArkJob(
          jobId,
          502,
          "application/json; charset=utf-8",
          Buffer.from(JSON.stringify({ error: { message: "Ark proxy restarted while the job was running." } })),
          "proxy restarted",
        );
      } else if (job.status === "callback_pending") {
        scheduleCallback(jobId);
      }
    } catch (error) {
      console.error(`Failed to resume Ark job ${jobId}`, error instanceof Error ? error.message : String(error));
    }
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { ok: true });
  }
  const incomingUrl = new URL(request.url || "/", "http://proxy.internal");
  const isSes = request.method === "POST" && incomingUrl.pathname === "/";
  const isCos = ["GET", "HEAD", "PUT", "DELETE"].includes(request.method || "") &&
    incomingUrl.pathname === "/cos";
  const isArk = request.method === "POST" &&
    incomingUrl.pathname === "/ark/api/v3/images/generations";
  const arkJobMatch = incomingUrl.pathname.match(/^\/ark\/jobs\/([^/]+)$/);
  const arkJobId = arkJobMatch?.[1] || "";
  const isArkJob = Boolean(arkJobMatch && JOB_ID_PATTERN.test(arkJobId));
  if (isArkJob) {
    if (!isInternalRequest(request)) return json(response, 403, { error: "Forbidden" });
    if (request.method === "GET") {
      try {
        const job = await readJob(arkJobId);
        return json(response, 200, {
          jobId: job.id,
          status: job.status,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          upstreamStatus: job.upstreamStatus || null,
          callbackAttempts: job.callbackAttempts || 0,
        });
      } catch (error) {
        return json(response, error?.code === "ENOENT" ? 404 : 500, { error: "Job state unavailable" });
      }
    }
    if (request.method === "DELETE") {
      await deleteJob(arkJobId);
      return json(response, 200, { deleted: true });
    }
  }
  const isArkJobStart = isArkJob && request.method === "POST";
  if (!isSes && !isCos && !isArk && !isArkJobStart) {
    return json(response, 404, { error: "Not found" });
  }

  let size = 0;
  const chunks = [];
  const maxBodyBytes = isArk || isArkJobStart ? ARK_MAX_BODY_BYTES : MAX_BODY_BYTES;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        return json(response, 413, { error: "Request too large" });
      }
      chunks.push(chunk);
    }

    if (isArkJobStart) {
      if (!IMAGEGEN_CALLBACK_URL || !IMAGEGEN_INTERNAL_TOKEN) {
        return json(response, 503, { error: "Async image generation proxy is not configured" });
      }
      try {
        const existing = await readJob(arkJobId);
        return json(response, 202, { jobId: existing.id, status: existing.status });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const headers = {};
      for (const name of ARK_FORWARDED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      if (!headers.authorization) return json(response, 400, { error: "Missing Ark authorization" });
      const now = new Date().toISOString();
      await writeJob({
        id: arkJobId,
        status: "running",
        createdAt: now,
        updatedAt: now,
        callbackAttempts: 0,
      });
      const body = Buffer.concat(chunks);
      void executeArkJob(arkJobId, headers, body).catch((error) => {
        console.error(`Ark job ${arkJobId} state persistence failed`, error instanceof Error ? error.message : String(error));
      });
      return json(response, 202, { jobId: arkJobId, status: "running" });
    }

    let upstreamUrl = SES_UPSTREAM;
    const headers = {};
    if (isSes) {
      for (const name of FORWARDED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
    } else if (isArk) {
      upstreamUrl = ARK_UPSTREAM;
      for (const name of ARK_FORWARDED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
    } else {
      const rawTarget = incomingUrl.searchParams.get("url");
      if (!rawTarget) return json(response, 400, { error: "Missing COS target" });
      const target = new URL(rawTarget);
      if (target.protocol !== "https:" || !ALLOWED_COS_HOSTS.has(target.hostname) || target.port) {
        return json(response, 403, { error: "COS target is not allowed" });
      }
      upstreamUrl = target.toString();
      for (const name of ["content-type", "content-length", "range", "if-none-match", "if-match"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
    }
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks),
      signal: AbortSignal.timeout(isArk ? ARK_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    });
    const responseHeaders = {};
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) responseHeaders["content-length"] = contentLength;
    for (const name of ["content-type", "etag", "last-modified", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    if (request.method === "HEAD" || !upstream.body) {
      response.end();
      return;
    }

    // Stream COS downloads instead of buffering every image in memory. /proj
    // can request many covers, so buffering delayed headers and amplified load.
    const bodyStream = Readable.fromWeb(upstream.body);
    bodyStream.on("error", (error) => {
      console.error("Proxy response stream failed", error instanceof Error ? error.message : "unknown error");
      response.destroy();
    });
    request.on("aborted", () => bodyStream.destroy());
    bodyStream.pipe(response);
  } catch (error) {
    console.error("Upstream proxy request failed", error instanceof Error ? error.message : "unknown error");
    json(response, 502, { error: "Upstream request failed" });
  }
});

await resumeJobs();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Fixed-upstream proxy listening on ${PORT}`);
});
