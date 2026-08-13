const encoder = new TextEncoder();

export type LightCosAssetKind = "original" | "panorama" | "thumbnail" | "avatar";

export interface LightCosBindings {
  TENCENT_LIGHTCOS_ACCOUNT_ID?: string;
  TENCENT_LIGHTCOS_APP_ID?: string;
  TENCENT_LIGHTCOS_REGION?: string;
  TENCENT_LIGHTCOS_ARCHIVE_BUCKET?: string;
  TENCENT_LIGHTCOS_MEDIA_BUCKET?: string;
  TENCENT_LIGHTCOS_SECRET_ID?: string;
  TENCENT_LIGHTCOS_SECRET_KEY?: string;
  TENCENT_LIGHTCOS_PUBLIC_DOMAIN?: string;
  TENCENT_LIGHTCOS_PROXY_ENDPOINT?: string;
}

export interface LightCosConfig {
  accountId: string;
  appId: string;
  region: string;
  archiveBucket: string;
  mediaBucket: string;
  secretId: string;
  secretKey: string;
  publicDomain: string;
  proxyEndpoint?: string;
}

const REQUIRED_LIGHTCOS_BINDINGS = [
  "TENCENT_LIGHTCOS_APP_ID",
  "TENCENT_LIGHTCOS_REGION",
  "TENCENT_LIGHTCOS_ARCHIVE_BUCKET",
  "TENCENT_LIGHTCOS_MEDIA_BUCKET",
  "TENCENT_LIGHTCOS_SECRET_ID",
  "TENCENT_LIGHTCOS_SECRET_KEY",
] as const;

export const LIGHTCOS_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const LIGHTCOS_SIZE_LIMITS: Record<LightCosAssetKind, number> = {
  original: 10 * 1024 * 1024,
  panorama: 50 * 1024 * 1024,
  thumbnail: 5 * 1024 * 1024,
  avatar: 5 * 1024 * 1024,
};

const EXTENSION_BY_TYPE: Record<(typeof LIGHTCOS_ALLOWED_TYPES)[number], string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalObjectPath(key: string) {
  return `/${key.split("/").map(rfc3986).join("/")}`;
}

function bytesToHex(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha1Hex(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-1", encoder.encode(value)));
}

async function hmacSha1Hex(key: string, value: string) {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", imported, encoder.encode(value)));
}

export function lightCosConfigFromEnv(env: LightCosBindings): LightCosConfig | null {
  const config = {
    accountId: String(env.TENCENT_LIGHTCOS_ACCOUNT_ID ?? "").trim(),
    appId: String(env.TENCENT_LIGHTCOS_APP_ID ?? "").trim(),
    region: String(env.TENCENT_LIGHTCOS_REGION ?? "").trim(),
    archiveBucket: String(env.TENCENT_LIGHTCOS_ARCHIVE_BUCKET ?? "").trim(),
    mediaBucket: String(env.TENCENT_LIGHTCOS_MEDIA_BUCKET ?? "").trim(),
    secretId: String(env.TENCENT_LIGHTCOS_SECRET_ID ?? "").trim(),
    secretKey: String(env.TENCENT_LIGHTCOS_SECRET_KEY ?? "").trim(),
    publicDomain: String(env.TENCENT_LIGHTCOS_PUBLIC_DOMAIN ?? "").trim(),
    proxyEndpoint: String(env.TENCENT_LIGHTCOS_PROXY_ENDPOINT ?? "").trim(),
  };
  if (
    !config.appId ||
    !config.region ||
    !config.archiveBucket ||
    !config.mediaBucket ||
    !config.secretId ||
    !config.secretKey
  ) {
    return null;
  }
  return config;
}

export function missingLightCosBindings(env: LightCosBindings) {
  return REQUIRED_LIGHTCOS_BINDINGS.filter((name) => !String(env[name] ?? "").trim());
}

export function validateLightCosUpload(kind: LightCosAssetKind, contentType: string, size: number) {
  if (!LIGHTCOS_ALLOWED_TYPES.includes(contentType as (typeof LIGHTCOS_ALLOWED_TYPES)[number])) {
    throw new Error("仅支持 JPG/JPEG、PNG 和 WebP 图片。");
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("图片大小无效。");
  }
  const limit = LIGHTCOS_SIZE_LIMITS[kind];
  if (size > limit) {
    const label = kind === "original"
      ? "历史原图"
      : kind === "panorama"
        ? "全景图"
        : kind === "thumbnail"
          ? "缩略图"
          : "头像";
    throw new Error(`${label}不能超过 ${Math.round(limit / 1024 / 1024)} MB。`);
  }
  return {
    extension: EXTENSION_BY_TYPE[contentType as (typeof LIGHTCOS_ALLOWED_TYPES)[number]],
    limit,
  };
}

export function lightCosBucketForKind(config: LightCosConfig, kind: LightCosAssetKind) {
  return kind === "original" ? config.archiveBucket : config.mediaBucket;
}

export function lightCosObjectHost(bucket: string, region: string) {
  return `${bucket}.cos.${region}.myqcloud.com`;
}

export function lightCosRequestUrl(config: LightCosConfig, signedUrl: string) {
  if (!config.proxyEndpoint) return signedUrl;
  const endpoint = new URL(config.proxyEndpoint);
  endpoint.searchParams.set("url", signedUrl);
  return endpoint.toString();
}

export async function createLightCosPresignedUrl({
  config,
  method,
  bucket,
  key,
  expiresInSeconds = 15 * 60,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  config: LightCosConfig;
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  bucket: string;
  key: string;
  expiresInSeconds?: number;
  nowSeconds?: number;
}) {
  const host = lightCosObjectHost(bucket, config.region);
  const path = canonicalObjectPath(key);
  const keyTime = `${nowSeconds};${nowSeconds + expiresInSeconds}`;
  const headerList = "host";
  const canonicalHeaders = `host=${rfc3986(host)}`;
  const httpString = `${method.toLowerCase()}\n${path}\n\n${canonicalHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(httpString)}\n`;
  const signKey = await hmacSha1Hex(config.secretKey, keyTime);
  const signature = await hmacSha1Hex(signKey, stringToSign);
  const query = new URLSearchParams({
    "q-sign-algorithm": "sha1",
    "q-ak": config.secretId,
    "q-sign-time": keyTime,
    "q-key-time": keyTime,
    "q-header-list": headerList,
    "q-url-param-list": "",
    "q-signature": signature,
  });
  return `https://${host}${path}?${query.toString()}`;
}

export async function inspectLightCosObject(
  config: LightCosConfig,
  bucket: string,
  key: string,
) {
  const url = await createLightCosPresignedUrl({
    config,
    method: "HEAD",
    bucket,
    key,
    expiresInSeconds: 5 * 60,
  });
  const response = await fetch(lightCosRequestUrl(config, url), { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`LightCOS 对象校验失败（HTTP ${response.status}）。`);
  }
  return {
    size: Number(response.headers.get("content-length") ?? 0),
    contentType: String(response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
    etag: String(response.headers.get("etag") ?? "").replace(/^"|"$/g, ""),
  };
}
