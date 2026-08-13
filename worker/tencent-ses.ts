const encoder = new TextEncoder();
const SES_ENDPOINT = "https://ses.tencentcloudapi.com";
const SES_HOST = "ses.tencentcloudapi.com";
const SES_SERVICE = "ses";
const SES_VERSION = "2020-10-02";

export interface TencentSesConfig {
  secretId: string;
  secretKey: string;
  region: string;
  from: string;
  templateId: number;
  endpoint?: string;
}

export interface TencentSesResult {
  ok: boolean;
  messageId?: string;
  requestId?: string;
  errorCode?: string;
}

function bytesToHex(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacSha256(key: ArrayBuffer, value: string) {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}

async function createAuthorization(
  config: TencentSesConfig,
  timestamp: number,
  body: string,
) {
  const contentType = "application/json; charset=utf-8";
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${contentType}\nhost:${SES_HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(body),
  ].join("\n");
  const credentialScope = `${date}/${SES_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = await hmacSha256(
    encoder.encode(`TC3${config.secretKey}`).buffer,
    date,
  );
  const secretService = await hmacSha256(secretDate, SES_SERVICE);
  const secretSigning = await hmacSha256(secretService, "tc3_request");
  const signature = bytesToHex(await hmacSha256(secretSigning, stringToSign));
  return `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export async function sendTencentVerificationCode(
  config: TencentSesConfig,
  destination: string,
  code: string,
): Promise<TencentSesResult> {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    FromEmailAddress: config.from,
    Destination: [destination],
    Subject: "验证您的 MemoscapeLab 注册邮箱",
    Template: {
      TemplateID: config.templateId,
      TemplateData: JSON.stringify({ code }),
    },
    TriggerType: 1,
  });
  const authorization = await createAuthorization(config, timestamp, body);
  const response = await fetch(config.endpoint || SES_ENDPOINT, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json; charset=utf-8",
      "x-tc-action": "SendEmail",
      "x-tc-region": config.region,
      "x-tc-timestamp": String(timestamp),
      "x-tc-version": SES_VERSION,
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    Response?: {
      Error?: { Code?: string };
      MessageId?: string;
      RequestId?: string;
    };
  } | null;
  const serviceResponse = payload?.Response;
  const errorCode = serviceResponse?.Error?.Code;
  if (!response.ok || errorCode) {
    return {
      ok: false,
      requestId: serviceResponse?.RequestId,
      errorCode: errorCode ?? `HTTP_${response.status}`,
    };
  }
  return {
    ok: true,
    messageId: serviceResponse?.MessageId,
    requestId: serviceResponse?.RequestId,
  };
}

type TencentSesSender = (
  config: TencentSesConfig,
  destination: string,
  code: string,
) => Promise<TencentSesResult>;

/** Retry one failed request without rotating the verification code. */
export async function sendTencentVerificationCodeWithRetry(
  config: TencentSesConfig,
  destination: string,
  code: string,
  sender: TencentSesSender = sendTencentVerificationCode,
  maxAttempts = 2,
): Promise<TencentSesResult> {
  let lastResult: TencentSesResult = { ok: false, errorCode: "NETWORK_ERROR" };
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastResult = await sender(config, destination, code);
      if (lastResult.ok) return lastResult;
    } catch {
      lastResult = { ok: false, errorCode: "NETWORK_ERROR" };
    }
  }

  return lastResult;
}
