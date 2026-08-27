import { ImageGenError, type ImageGenAdapter, type ImageGenRequest, type ProviderConfig } from "./types";

export interface SeedreamAsyncProxyEnv {
  SEEDREAM_ASYNC_PROXY_URL?: string;
  IMAGEGEN_INTERNAL_TOKEN?: string;
}

interface SubmitSeedreamProxyJobOptions {
  env: SeedreamAsyncProxyEnv;
  taskId: string;
  adapter: ImageGenAdapter;
  config: ProviderConfig;
  request: ImageGenRequest;
  fetchImpl?: typeof fetch;
}

export function hasSeedreamAsyncProxy(env: SeedreamAsyncProxyEnv): boolean {
  return Boolean(
    String(env.SEEDREAM_ASYNC_PROXY_URL ?? "").trim() &&
    String(env.IMAGEGEN_INTERNAL_TOKEN ?? "").trim(),
  );
}

function proxyJobUrl(env: SeedreamAsyncProxyEnv, taskId: string): string {
  const base = String(env.SEEDREAM_ASYNC_PROXY_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) throw new ImageGenError("unconfigured", "Seedream 异步代理地址未配置。");
  return `${base}/${encodeURIComponent(taskId)}`;
}

/**
 * 把已经规范化的 Seedream 请求交给自托管固定目标代理。
 * 这里只等待参考图上传完成和代理确认接单，不等待 Ark 生成完成。
 */
export async function submitSeedreamProxyJob(
  options: SubmitSeedreamProxyJobOptions,
): Promise<void> {
  const { env, taskId, adapter, config, request, fetchImpl = fetch } = options;
  const token = String(env.IMAGEGEN_INTERNAL_TOKEN ?? "").trim();
  if (!token) throw new ImageGenError("unconfigured", "图片生成内部回调令牌未配置。");
  const built = adapter.buildRequest(config, request);
  const response = await fetchImpl(proxyJobUrl(env, taskId), {
    method: "POST",
    headers: {
      ...(built.contentType ? { "content-type": built.contentType } : {}),
      ...built.headers,
      "x-memoscape-internal-token": token,
    },
    body: built.body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ImageGenError(
      response.status === 401 || response.status === 403 ? "auth" : "upstream_error",
      `Seedream 代理未接单（${response.status}）：${text.slice(0, 300)}`,
      response.status >= 500,
    );
  }
  let payload: { jobId?: unknown } | null = null;
  try {
    payload = JSON.parse(text) as { jobId?: unknown };
  } catch {
    // 下面统一返回清晰错误。
  }
  if (payload?.jobId !== taskId) {
    throw new ImageGenError("upstream_error", "Seedream 代理返回了无效任务号。", true);
  }
}

