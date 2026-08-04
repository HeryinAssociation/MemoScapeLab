/** OpenAI 适配器（/v1/images/edits）。文档：.temp/image2.txt */
import { ImageGenError, type ImageGenAdapter, type ImageGenParsed, type ImageGenRequest, type ProviderConfig } from "./types";

interface OpenAIImageItem {
  b64_json?: string;
  url?: string;
}

interface OpenAIResponse {
  error?: { message?: string };
  data?: OpenAIImageItem[];
  usage?: unknown;
}

export const openaiAdapter: ImageGenAdapter = {
  name: "openai",
  buildRequest(config: ProviderConfig, request: ImageGenRequest) {
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: request.prompt,
      // 参考图传公开 URL（文档 Body 参数支持 images: [{ image_url }] 的 JSON 形式）
      images: request.referenceImages.map((image_url) => ({ image_url })),
      quality: request.quality ?? "medium",
      size: request.size ?? "1024x1024",
    };
    return {
      url: `${config.baseUrl}/images/edits`,
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
    };
  },
  parseResponse(data: unknown): ImageGenParsed {
    const payload = data as OpenAIResponse;
    if (payload.error) {
      throw new ImageGenError(
        "upstream_error",
        `OpenAI 错误：${payload.error.message ?? JSON.stringify(payload.error)}`,
      );
    }
    const images = (payload.data ?? []).map((item) => ({
      b64: item.b64_json,
      url: item.url,
      // GPT 图片模型默认返回 b64_json（PNG）
      format: item.b64_json ? "png" : "jpeg",
    }));
    return { images, usage: payload.usage };
  },
};
