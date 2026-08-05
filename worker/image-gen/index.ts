/** 图片生成注册表：只读取当前用户保存的厂商与 API 配置。 */
import type { D1Database } from "../auth";
import { ImageGenError, type ImageGenAdapter, type ImageGenProviderName, type ProviderConfig } from "./types";
import { openaiAdapter } from "./openai";
import { qwenAdapter } from "./qwen";
import { seedreamAdapter } from "./seedream";
import { KEY_PREFIX, loadSettingsMap, resolveSecretKey } from "./settings";

export { runImageGen, assetToDataUrl } from "./pipeline";

export const ADAPTERS: Record<ImageGenProviderName, ImageGenAdapter> = {
  seedream: seedreamAdapter,
  openai: openaiAdapter,
  qwen: qwenAdapter,
};

/** 平台只提供用户 API Key 的数据库加密主密钥，不提供图片生成 API。 */
export interface ImageGenEnv {
  SETTINGS_ENCRYPTION_KEY?: string;
}

const ENDPOINT_SUFFIXES: Record<ImageGenProviderName, string[]> = {
  seedream: ["/images/generations"],
  openai: ["/images/edits"],
  qwen: ["/api/v1/services/aigc/multimodal-generation/generation"],
};

/** 归一化配置的 Base URL：去掉误填的接口路径段，只保留域名前缀（如误填完整接口地址时避免重复拼接）。 */
export function normalizeBaseUrl(baseUrl: string, provider: ImageGenProviderName): string {
  let url = baseUrl.trim().replace(/\/+$/, "");
  for (const suffix of ENDPOINT_SUFFIXES[provider]) {
    if (url.toLowerCase().endsWith(suffix.toLowerCase())) {
      url = url.slice(0, url.length - suffix.length).replace(/\/+$/, "");
      break;
    }
  }
  return url;
}

export async function resolveImageGenProvider(
  env: ImageGenEnv & { DB: D1Database },
  userId: string,
  providerName?: string,
): Promise<{ adapter: ImageGenAdapter; config: ProviderConfig }> {
  const map = await loadSettingsMap(env.DB, userId);
  const get = (name: string): string => {
    const dbValue = map[`${KEY_PREFIX}${name}`];
    return dbValue !== undefined ? dbValue.trim() : "";
  };

  const provider = (providerName || get("IMAGE_PROVIDER")).toLowerCase() as ImageGenProviderName;
  switch (provider) {
    case "seedream": {
      const apiKey = await resolveSecretKey(env, map, "ARK_API_KEY");
      const model = get("SEEDREAM_MODEL");
      if (!apiKey) throw new ImageGenError("unconfigured", "未配置 ARK_API_KEY。");
      if (!model) {
        throw new ImageGenError(
          "unconfigured",
          "未配置 SEEDREAM_MODEL（模型 ID 带版本号，请到火山方舟控制台获取，如 doubao-seedream-4-0-250828）。",
        );
      }
      return {
        adapter: seedreamAdapter,
        config: {
          apiKey,
          baseUrl: normalizeBaseUrl(
            get("SEEDREAM_BASE_URL") || "https://ark.cn-beijing.volces.com/api/v3",
            "seedream",
          ),
          model,
        },
      };
    }
    case "openai": {
      const apiKey = await resolveSecretKey(env, map, "OPENAI_API_KEY");
      if (!apiKey) throw new ImageGenError("unconfigured", "未配置 OPENAI_API_KEY。");
      return {
        adapter: openaiAdapter,
        config: {
          apiKey,
          baseUrl: normalizeBaseUrl(
            get("OPENAI_BASE_URL") || "https://api.openai.com/v1",
            "openai",
          ),
          model: get("OPENAI_IMAGE_MODEL") || "gpt-image-1",
        },
      };
    }
    case "qwen": {
      const apiKey = await resolveSecretKey(env, map, "DASHSCOPE_API_KEY");
      const baseUrl = normalizeBaseUrl(get("QWEN_IMAGE_BASE_URL"), "qwen");
      if (!apiKey) throw new ImageGenError("unconfigured", "未配置 DASHSCOPE_API_KEY。");
      if (!baseUrl) {
        throw new ImageGenError(
          "unconfigured",
          "未配置 QWEN_IMAGE_BASE_URL（阿里云百炼业务空间专属域名，如 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com）。",
        );
      }
      return {
        adapter: qwenAdapter,
        config: {
          apiKey,
          baseUrl,
          model: get("QWEN_IMAGE_MODEL") || "qwen-image-3.0-pro",
          extra: { promptExtend: true },
        },
      };
    }
    default:
      throw new ImageGenError(
        "unconfigured",
        `未配置或未知 IMAGE_PROVIDER：${provider || "(空)"}。可选值：seedream / openai / qwen。`,
      );
  }
}
