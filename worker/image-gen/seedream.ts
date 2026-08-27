/** Seedream（火山方舟）适配器。文档：.temp/Seedream.txt */
import { ImageGenError, type ImageGenAdapter, type ImageGenParsed, type ImageGenRequest, type ProviderConfig } from "./types";

interface SeedreamImageItem {
  url?: string;
  b64_json?: string;
}

interface SeedreamResponse {
  data?: SeedreamImageItem[];
  error?: { message?: string; code?: string };
  usage?: unknown;
}

export const seedreamAdapter: ImageGenAdapter = {
  name: "seedream",
  buildRequest(config: ProviderConfig, request: ImageGenRequest) {
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: request.prompt,
      // 直接返回 Base64，避免自托管 Workerd 再次下载临时 HTTPS 结果时触发证书链问题。
      response_format: "b64_json",
      // 显式 png：Seedream 5.0 lite 支持且无压缩伪影，适配全景输出
      output_format: "png",
      watermark: request.watermark ?? false,
      stream: false,
    };
    if (request.referenceImages.length > 0) {
      body.image =
        request.referenceImages.length === 1
          ? request.referenceImages[0]
          : request.referenceImages;
    }
    if (request.size) body.size = request.size;
    return {
      url: `${config.baseUrl}/images/generations`,
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      contentType: "application/json",
    };
  },
  parseResponse(data: unknown): ImageGenParsed {
    const payload = data as SeedreamResponse;
    if (payload.error) {
      throw new ImageGenError(
        "upstream_error",
        `Seedream 错误：${payload.error.message ?? JSON.stringify(payload.error)}`,
      );
    }
    const images = (payload.data ?? []).map((item) => ({
      url: item.url,
      b64: item.b64_json,
      // 与请求的 output_format=png 保持一致（避免 R2 扩展名/content-type 与实际格式不符）
      format: "png" as const,
    }));
    return { images, usage: payload.usage };
  },
};
