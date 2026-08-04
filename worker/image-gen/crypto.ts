/** AES-GCM 密钥加解密：主密钥 SETTINGS_ENCRYPTION_KEY（base64 32 字节）来自环境，密文可安全入库。 */
import { ImageGenError } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IV_LENGTH = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 环境变量是否配置了加密主密钥。 */
export function hasEncryptionKey(env: { SETTINGS_ENCRYPTION_KEY?: string }): boolean {
  return Boolean(env.SETTINGS_ENCRYPTION_KEY?.trim());
}

/** 从 SETTINGS_ENCRYPTION_KEY（base64 32 字节）导入 AES-GCM 密钥；未配置时返回 null。 */
export async function getEncryptionKey(
  env: { SETTINGS_ENCRYPTION_KEY?: string },
): Promise<CryptoKey | null> {
  const raw = env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try {
    return await crypto.subtle.importKey(
      "raw",
      base64ToBytes(raw),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } catch (error) {
    throw new ImageGenError(
      "unconfigured",
      `SETTINGS_ENCRYPTION_KEY 无效：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 加密明文，返回 base64(iv + 密文)，可用于入库。 */
export async function encryptSecret(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain));
  const combined = new Uint8Array(IV_LENGTH + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), IV_LENGTH);
  return bytesToBase64(combined);
}

/** 解密 base64(iv + 密文)；主密钥不匹配或数据损坏时抛出 ImageGenError。 */
export async function decryptSecret(key: CryptoKey, stored: string): Promise<string> {
  try {
    const combined = base64ToBytes(stored);
    if (combined.length <= IV_LENGTH) throw new Error("密文长度无效");
    const iv = combined.slice(0, IV_LENGTH);
    const cipher = combined.slice(IV_LENGTH);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return decoder.decode(plain);
  } catch (error) {
    throw new ImageGenError(
      "auth",
      `密钥解密失败：${error instanceof Error ? error.message : String(error)}（主密钥可能已更换）`,
    );
  }
}

/** 掩码展示用，如 sk-****abcd；长度不足时全部打码。 */
export function maskKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "****";
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}
