/** Qwen（阿里云百炼 qwen-image-3.0-pro）适配器。文档：.temp/qwen.txt */
import { ImageGenError, type ImageGenAdapter, type ImageGenParsed, type ImageGenRequest, type ProviderConfig } from "./types";

interface QwenImageContent {
  image?: string;
}

interface QwenResponse {
  code?: string;
  message?: string;
  output?: {
    choices?: Array<{
      message?: { content?: QwenImageContent[] };
    }>;
  };
  usage?: { width?: number; height?: number };
}

export const qwenAdapter: ImageGenAdapter = {
  name: "qwen",
  buildRequest(config: ProviderConfig, request: ImageGenRequest) {
    // Chat 风格：content 数组 = 参考图（URL/base64 data URL）+ 一条 text
    const content: Array<Record<string, string>> = [];
    for (const image of request.referenceImages) content.push({ image });
    content.push({ text: request.prompt });

    const parameters: Record<string, unknown> = {
      prompt_extend: config.extra?.promptExtend ?? true,
      watermark: request.watermark ?? false,
    };
    if (request.size) parameters.size = request.size.replace("x", "*");
    if (request.negativePrompt) parameters.negative_prompt = request.negativePrompt;
    if (request.seed !== undefined) parameters.seed = request.seed;

    const body = {
      model: config.model,
      input: { messages: [{ role: "user", content }] },
      parameters,
    };
    return {
      // config.baseUrl 为业务空间专属域名，如 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com
      url: `${config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      contentType: "application/json",
    };
  },
  parseResponse(data: unknown): ImageGenParsed {
    const payload = data as QwenResponse;
    if (payload.code) {
      throw new ImageGenError(
        "upstream_error",
        `Qwen 错误（${payload.code}）：${payload.message ?? ""}`,
      );
    }
    const content = payload.output?.choices?.[0]?.message?.content ?? [];
    const width = payload.usage?.width;
    const height = payload.usage?.height;
    const images = content
      .filter((item): item is { image: string } => Boolean(item.image))
      .map((item) => ({
        url: item.image, // 24h 有效，管道会立即下载落 R2
        format: "png" as const,
        width,
        height,
      }));
    return { images, usage: payload.usage };
  },
};
