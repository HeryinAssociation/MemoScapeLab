/** OpenAI 适配器（/v1/images/edits，多图 multipart 请求）。 */
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

function referenceBlob(value: string, index: number) {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new ImageGenError(
      "invalid_input",
      `OpenAI 参考图 ${index + 1} 不是有效的 Base64 data URL。`,
    );
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let cursor = 0; cursor < binary.length; cursor += 1) {
    bytes[cursor] = binary.charCodeAt(cursor);
  }
  return { blob: new Blob([bytes], { type: match[1].toLowerCase() }), mime: match[1] };
}

function extensionForMime(mime: string) {
  if (mime.toLowerCase() === "image/jpeg") return "jpg";
  if (mime.toLowerCase() === "image/webp") return "webp";
  return "png";
}

export const openaiAdapter: ImageGenAdapter = {
  name: "openai",
  buildRequest(config: ProviderConfig, request: ImageGenRequest) {
    const body = new FormData();
    body.append("model", config.model);
    body.append("prompt", request.prompt);
    body.append("quality", request.quality ?? "medium");
    body.append("size", request.size ?? "1024x1024");
    body.append("output_format", "png");
    request.referenceImages.forEach((image, index) => {
      const { blob, mime } = referenceBlob(image, index);
      body.append("image[]", blob, `reference-${index + 1}.${extensionForMime(mime)}`);
    });
    return {
      url: `${config.baseUrl}/images/edits`,
      headers: { authorization: `Bearer ${config.apiKey}` },
      body,
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
