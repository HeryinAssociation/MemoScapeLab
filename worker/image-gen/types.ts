/** 统一图片生成契约：Seedream / OpenAI / Qwen 三家厂商都适配到这套类型。 */

export type ImageGenProviderName = "seedream" | "openai" | "qwen";

/** 统一请求：图生图（I2I）场景，referenceImages 为本项目已上传原图的公开 URL。 */
export interface ImageGenRequest {
  prompt: string;
  /** 参考图 URL（如 /api/assets/...），适配器各自转成厂商接受的形式。 */
  referenceImages: string[];
  /** 统一尺寸写法 "1024x1024"；适配器负责转厂商格式（qwen 用 * 分隔）。 */
  size?: string;
  quality?: "low" | "medium" | "high";
  /** 反向提示词（qwen 支持，其余厂商忽略）。 */
  negativePrompt?: string;
  seed?: number;
  /** 统一水印开关，默认关。 */
  watermark?: boolean;
}

/** 厂商原始返回解析后的中间形态（尚未落 R2）。 */
export interface ImageGenImagePayload {
  /** 厂商返回的图 URL（可能有时效，管道会立即下载落 R2）。 */
  url?: string;
  /** 厂商返回的 base64（可能带 data:...;base64, 前缀）。 */
  b64?: string;
  width?: number;
  height?: number;
  format?: string; // png / jpeg / webp
}

export interface ImageGenParsed {
  images: ImageGenImagePayload[];
  usage?: unknown;
}

export type ImageGenErrorCode =
  | "unconfigured" // 未配置该厂商密钥/模型
  | "auth" // 鉴权失败
  | "rate_limit" // 限流，可重试
  | "timeout" // 超时，可重试
  | "invalid_input" // 参数错误
  | "upstream_error"; // 上游错误，可重试

export class ImageGenError extends Error {
  readonly code: ImageGenErrorCode;
  readonly retryable: boolean;

  constructor(code: ImageGenErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ImageGenError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** 厂商配置（来自 .dev.vars / Cloudflare Secret，禁止入库）。 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** 厂商特有配置，如 qwen 的 prompt_extend。 */
  extra?: Record<string, unknown>;
}

/**
 * 适配器契约：每个厂商只需实现两个纯函数。
 * - buildRequest：把统一请求转成该厂商的 HTTP 请求
 * - parseResponse：把厂商响应解析成统一中间形态（可在内部抛 ImageGenError 表达厂商错误码）
 */
export interface ImageGenAdapter {
  name: ImageGenProviderName;
  buildRequest(config: ProviderConfig, request: ImageGenRequest): {
    url: string;
    headers: Record<string, string>;
    body: string; // JSON 序列化后的请求体
  };
  parseResponse(data: unknown): ImageGenParsed;
}

/** 已落 R2 的生成结果。 */
export interface GeneratedImage {
  key: string; // R2 对象 key
  width: number;
  height: number;
  format: string; // png / jpeg / webp
}

export interface ImageGenResult {
  images: GeneratedImage[];
  provider: ImageGenProviderName;
  model: string;
  usage?: unknown;
}
