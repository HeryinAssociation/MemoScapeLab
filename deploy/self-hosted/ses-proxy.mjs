import http from "node:http";
import { Readable } from "node:stream";

const PORT = 8788;
const MAX_BODY_BYTES = 55 * 1024 * 1024;
const UPSTREAM = "https://ses.tencentcloudapi.com/";
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

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { ok: true });
  }
  const incomingUrl = new URL(request.url || "/", "http://proxy.internal");
  const isSes = request.method === "POST" && incomingUrl.pathname === "/";
  const isCos = ["GET", "HEAD", "PUT", "DELETE"].includes(request.method || "") &&
    incomingUrl.pathname === "/cos";
  if (!isSes && !isCos) {
    return json(response, 404, { error: "Not found" });
  }

  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        return json(response, 413, { error: "Request too large" });
      }
      chunks.push(chunk);
    }

    let upstreamUrl = UPSTREAM;
    const headers = {};
    if (isSes) {
      for (const name of FORWARDED_HEADERS) {
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
      signal: AbortSignal.timeout(20_000),
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
    console.error("SES proxy request failed", error instanceof Error ? error.message : "unknown error");
    json(response, 502, { error: "Upstream request failed" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SES proxy listening on ${PORT}`);
});
