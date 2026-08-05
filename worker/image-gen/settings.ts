/** 用户图片生成设置：按 user_id 隔离，API Key 经 AES-GCM 加密后入库。 */
import type { D1Database, D1PreparedStatement } from "../auth";
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
  hasEncryptionKey,
  maskKey,
} from "./crypto";
import { ImageGenError, type ImageGenProviderName } from "./types";
import type { ImageGenEnv } from "./index";

export const KEY_PREFIX = "imagegen.";

/** 每个厂商在用户设置表中的字段名。 */
export const PROVIDER_SETTING_FIELDS: Record<
  ImageGenProviderName,
  { model: string; baseUrl: string; apiKey: string }
> = {
  seedream: { model: "SEEDREAM_MODEL", baseUrl: "SEEDREAM_BASE_URL", apiKey: "ARK_API_KEY" },
  openai: { model: "OPENAI_IMAGE_MODEL", baseUrl: "OPENAI_BASE_URL", apiKey: "OPENAI_API_KEY" },
  qwen: { model: "QWEN_IMAGE_MODEL", baseUrl: "QWEN_IMAGE_BASE_URL", apiKey: "DASHSCOPE_API_KEY" },
};

export const PROVIDER_NAMES: ImageGenProviderName[] = ["seedream", "openai", "qwen"];

export async function loadSettingsMap(
  db: D1Database,
  userId: string,
): Promise<Record<string, string>> {
  const result = await db
    .prepare("SELECT key, value FROM user_imagegen_settings WHERE user_id = ?")
    .bind(userId)
    .all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const row of result.results) map[row.key] = row.value;
  return map;
}

/**
 * 解密当前用户保存的厂商密钥。平台环境变量不提供任何图片生成 API Key。
 */
export async function resolveSecretKey(
  env: ImageGenEnv & { DB: D1Database },
  map: Record<string, string>,
  name: string,
): Promise<string> {
  const dbValue = map[`${KEY_PREFIX}${name}`];
  if (dbValue !== undefined && dbValue !== "") {
    const key = await getEncryptionKey(env);
    if (!key) {
      throw new ImageGenError(
        "unconfigured",
        `${name} 已存入数据库，但未配置 SETTINGS_ENCRYPTION_KEY，无法解密。`,
      );
    }
    return decryptSecret(key, dbValue);
  }
  return "";
}

/** GET 视图：每个厂商的模型/地址/掩码密钥与配置来源（不回传明文密钥）。 */
export interface ProviderSettingsView {
  provider: ImageGenProviderName;
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  keySource: "user" | "none";
  /** 密钥存于 DB 但主密钥缺失/不匹配，无法解密读取。 */
  keyLocked: boolean;
}

export interface ImageGenSettingsView {
  provider: ImageGenProviderName | "";
  providers: Record<ImageGenProviderName, ProviderSettingsView>;
  encryptionConfigured: boolean;
}

export async function getImageGenSettingsView(
  db: D1Database,
  env: ImageGenEnv,
  userId: string,
): Promise<ImageGenSettingsView> {
  const map = await loadSettingsMap(db, userId);
  const encryptionKey = await getEncryptionKey(env).catch(() => null);

  const providers = {} as Record<ImageGenProviderName, ProviderSettingsView>;
  for (const name of PROVIDER_NAMES) {
    const fields = PROVIDER_SETTING_FIELDS[name];
    const model = map[`${KEY_PREFIX}${fields.model}`] ?? "";
    const baseUrl = map[`${KEY_PREFIX}${fields.baseUrl}`] ?? "";
    const dbSecret = map[`${KEY_PREFIX}${fields.apiKey}`];

    let apiKeyMasked = "";
    let keySource: ProviderSettingsView["keySource"] = "none";
    let keyLocked = false;
    if (dbSecret !== undefined && dbSecret !== "") {
      keySource = "user";
      if (encryptionKey) {
        try {
          apiKeyMasked = maskKey(await decryptSecret(encryptionKey, dbSecret));
        } catch {
          keyLocked = true;
        }
      } else {
        keyLocked = true;
      }
    }

    providers[name] = {
      provider: name,
      model,
      baseUrl,
      apiKeyMasked,
      apiKeyConfigured: keySource !== "none",
      keySource,
      keyLocked,
    };
  }

  const provider = (map[`${KEY_PREFIX}IMAGE_PROVIDER`] ?? "").trim();
  return {
    provider: (["seedream", "openai", "qwen"].includes(provider) ? provider : "") as ImageGenProviderName | "",
    providers,
    encryptionConfigured: hasEncryptionKey(env),
  };
}

/** PUT 入参：apiKey 不传=保持不变；传空字符串=清除；传非空=加密后入库。 */
export interface ImageGenSettingsInput {
  provider: ImageGenProviderName | "";
  providers: Record<
    ImageGenProviderName,
    { model?: string; baseUrl?: string; apiKey?: string }
  >;
}

export async function saveImageGenSettings(
  db: D1Database,
  userId: string,
  body: ImageGenSettingsInput,
  env: ImageGenEnv,
): Promise<void> {
  const providerName = String(body?.provider ?? "").trim().toLowerCase() as ImageGenProviderName | "";
  if (providerName !== "" && !PROVIDER_NAMES.includes(providerName)) {
    throw new ImageGenError("invalid_input", `未知厂商：${providerName}。`);
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const put = (key: string, value: string) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO user_imagegen_settings (user_id, key, value, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, key, value, now),
    );
  };

  put(`${KEY_PREFIX}IMAGE_PROVIDER`, providerName);

  const encryptionKey = await getEncryptionKey(env);
  for (const name of PROVIDER_NAMES) {
    const section = body?.providers?.[name];
    if (!section) continue;
    const fields = PROVIDER_SETTING_FIELDS[name];
    if (section.model !== undefined) {
      put(`${KEY_PREFIX}${fields.model}`, String(section.model ?? "").trim());
    }
    if (section.baseUrl !== undefined) {
      put(`${KEY_PREFIX}${fields.baseUrl}`, String(section.baseUrl ?? "").trim());
    }
    if (section.apiKey !== undefined) {
      const secret = String(section.apiKey).trim();
      if (secret === "") {
        put(`${KEY_PREFIX}${fields.apiKey}`, "");
      } else {
        if (!encryptionKey) {
          throw new ImageGenError(
            "unconfigured",
            `平台未配置 SETTINGS_ENCRYPTION_KEY，无法安全保存 ${fields.apiKey}。`,
          );
        }
        put(`${KEY_PREFIX}${fields.apiKey}`, await encryptSecret(encryptionKey, secret));
      }
    }
  }

  if (statements.length > 0) await db.batch(statements);
}
