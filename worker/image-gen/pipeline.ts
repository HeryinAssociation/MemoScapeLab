/** 共享生成管道：鉴权请求 → 带超时/重试调用 → 解析 → 立即下载/解码 → 落 R2 → 归一化结果。 */
import type { R2Bucket } from "../auth";
import {
  ImageGenError,
  type GeneratedImage,
  type ImageGenAdapter,
  type ImageGenParsed,
  type ImageGenRequest,
  type ImageGenResult,
  type ProviderConfig,
} from "./types";

const DEFAULT_TIMEOUT_MS = 120_000; // 图片生成是慢任务
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [500, 1500];

export interface RunImageGenOptions {
  adapter: ImageGenAdapter;
  config: ProviderConfig;
  request: ImageGenRequest;
  r2: R2Bucket;
  /** R2 落图前缀，如 users/{uid}/projects/{pid}/generated（key 由管道生成）。 */
  r2KeyPrefix: string;
}

export interface StoreParsedImagesOptions {
  parsed: ImageGenParsed;
  r2: R2Bucket;
  r2KeyPrefix: string;
  timeoutMs?: number;
  /** 异步回调重试时使用确定性文件名，避免产生重复孤儿对象。 */
  keyForIndex?: (index: number, extension: string) => string;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ImageGenError("timeout", "请求超时。", true);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  // 兼容 data:image/png;base64,xxxx 前缀
  const clean = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function contentTypeFor(format: string): string {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

/** 把 HTTP 状态码翻译成统一错误码。 */
function errorFromHttpStatus(status: number, body: string): ImageGenError {
  if (status === 401 || status === 403) {
    return new ImageGenError("auth", `鉴权失败（${status}）：${body.slice(0, 200)}`);
  }
  if (status === 429) {
    return new ImageGenError("rate_limit", `触发限流（429）：${body.slice(0, 200)}`, true);
  }
  if (status >= 500) {
    return new ImageGenError("upstream_error", `上游错误（${status}）：${body.slice(0, 200)}`, true);
  }
  return new ImageGenError("invalid_input", `请求被拒绝（${status}）：${body.slice(0, 200)}`);
}

async function fetchImageBytes(
  url: string,
  timeoutMs: number,
): Promise<ArrayBuffer> {
  const response = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
  if (!response.ok) {
    throw new ImageGenError(
      "upstream_error",
      `下载生成图失败（${response.status}）：${url.slice(0, 160)}`,
      true,
    );
  }
  return response.arrayBuffer();
}

/** 把厂商已解析的图片持久化到 R2；同步调用和异步代理回调共用。 */
export async function storeParsedImages(
  options: StoreParsedImagesOptions,
): Promise<GeneratedImage[]> {
  const {
    parsed,
    r2,
    r2KeyPrefix,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    keyForIndex,
  } = options;
  const images: GeneratedImage[] = [];
  for (let i = 0; i < parsed.images.length; i++) {
    const item = parsed.images[i];
    const format = (item.format ?? "png").toLowerCase().replace("jpg", "jpeg");
    const extension = format === "jpeg" ? "jpg" : format;
    const key = keyForIndex
      ? keyForIndex(i, extension)
      : `${r2KeyPrefix}/${crypto.randomUUID()}.${extension}`;
    let bytes: ArrayBuffer;
    if (item.b64) {
      bytes = base64ToArrayBuffer(item.b64);
    } else if (item.url) {
      bytes = await fetchImageBytes(item.url, timeoutMs);
    } else {
      throw new ImageGenError("upstream_error", "厂商未返回图片数据。", false);
    }
    await r2.put(key, bytes, { httpMetadata: { contentType: contentTypeFor(format) } });
    images.push({
      key,
      width: item.width ?? 0,
      height: item.height ?? 0,
      format,
    });
  }
  if (images.length === 0) {
    throw new ImageGenError("upstream_error", "生成结果为空。", false);
  }
  return images;
}

/**
 * 从 R2 读取资产并转成 data URL（MIME 小写），供厂商直接取图。
 * 注意：本地开发时 /api/assets 是 localhost 地址，厂商服务器无法访问，
 * 必须用 Base64 data URL 传参考图（文档要求格式小写，如 data:image/png;base64,…）。
 */
export async function assetToDataUrl(r2: R2Bucket, pathOrKey: string): Promise<string> {
  const key = pathOrKey.startsWith("/api/assets/")
    ? decodeURIComponent(pathOrKey.slice("/api/assets/".length))
    : pathOrKey;
  const object = await r2.get(key);
  if (!object) {
    throw new ImageGenError("upstream_error", `参考图不存在：${pathOrKey.slice(0, 120)}`, false);
  }
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  const mime = (object.httpMetadata?.contentType ?? "image/png").toLowerCase();
  return `data:${mime};base64,${btoa(chunks.join(""))}`;
}

export async function runImageGen(options: RunImageGenOptions): Promise<ImageGenResult> {
  const { adapter, config, request, r2, r2KeyPrefix } = options;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const built = adapter.buildRequest(config, request);
      const response = await fetchWithTimeout(
        built.url,
        {
          method: "POST",
          headers: {
            ...(built.contentType ? { "content-type": built.contentType } : {}),
            ...built.headers,
          },
          body: built.body,
        },
        timeoutMs,
      );
      const text = await response.text();
      if (!response.ok) throw errorFromHttpStatus(response.status, text);

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      const parsed: ImageGenParsed = adapter.parseResponse(data);
      const images = await storeParsedImages({ parsed, r2, r2KeyPrefix, timeoutMs });
      return { images, provider: adapter.name, model: config.model, usage: parsed.usage };
    } catch (error) {
      lastError = error;
      const genError =
        error instanceof ImageGenError
          ? error
          : new ImageGenError("upstream_error", error instanceof Error ? error.message : String(error));
      if (!genError.retryable || attempt >= maxRetries) throw genError;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt] ?? 1500));
    }
  }
  throw lastError;
}
