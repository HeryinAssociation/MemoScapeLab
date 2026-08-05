import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "../worker/auth";
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
  hasEncryptionKey,
  maskKey,
} from "../worker/image-gen/crypto";
import { resolveImageGenProvider, normalizeBaseUrl } from "../worker/image-gen";
import {
  getImageGenSettingsView,
  saveImageGenSettings,
  type ImageGenSettingsInput,
} from "../worker/image-gen/settings";
import { ImageGenError } from "../worker/image-gen/types";

// 固定 32 字节主密钥（base64），避免依赖随机性
const TEST_KEY_BASE64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const OTHER_KEY_BASE64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const USER_A = "user-a";
const USER_B = "user-b";

function env(overrides: Record<string, string> = {}) {
  return { SETTINGS_ENCRYPTION_KEY: TEST_KEY_BASE64, ...overrides };
}

/** 内存版 settings mock：SELECT 返回 store 内容，INSERT OR REPLACE 写回。 */
function settingsDb(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial).map(([key, value]) => [`${USER_A}\u0000${key}`, value]));
  const makeStatement = (query: string): D1PreparedStatement => {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) {
        values = args;
        return statement;
      },
      async first() {
        return null;
      },
      async all() {
        if (/SELECT key, value FROM user_imagegen_settings/i.test(query)) {
          const prefix = `${String(values[0])}\u0000`;
          return {
            results: [...store.entries()]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => ({ key: key.slice(prefix.length), value })),
          };
        }
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO user_imagegen_settings/i.test(query)) {
          store.set(`${String(values[0])}\u0000${String(values[1])}`, String(values[2]));
        }
        return {};
      },
    } as unknown as D1PreparedStatement;
    return statement;
  };
  const db = {
    prepare: makeStatement,
    async batch(statements: D1PreparedStatement[]) {
      await Promise.all(statements.map((statement) => statement.run()));
      return [];
    },
    store(userId = USER_A) {
      const prefix = `${userId}\u0000`;
      return Object.fromEntries(
        [...store.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
    },
  };
  return db as D1Database & { store(): Record<string, string> };
}

// ---------- crypto ----------

test("crypto：未配置主密钥时 getEncryptionKey 返回 null", async () => {
  assert.equal(hasEncryptionKey({}), false);
  assert.equal(await getEncryptionKey({}), null);
});

test("crypto：非法主密钥抛 ImageGenError(unconfigured)", async () => {
  await assert.rejects(
    () => getEncryptionKey({ SETTINGS_ENCRYPTION_KEY: "!!!not-base64!!!" }),
    (error: unknown) => error instanceof ImageGenError && error.code === "unconfigured",
  );
});

test("crypto：加密解密往返一致，密文不包含明文", async () => {
  const key = await getEncryptionKey(env());
  assert.ok(key);
  const cipher = await encryptSecret(key!, "sk-secret-abc123");
  assert.notEqual(cipher, "sk-secret-abc123");
  assert.equal(await decryptSecret(key!, cipher), "sk-secret-abc123");
});

test("crypto：主密钥不匹配时解密抛 ImageGenError(auth)", async () => {
  const key = (await getEncryptionKey(env()))!;
  const other = (await getEncryptionKey({ SETTINGS_ENCRYPTION_KEY: OTHER_KEY_BASE64 }))!;
  const cipher = await encryptSecret(key, "secret");
  await assert.rejects(
    () => decryptSecret(other, cipher),
    (error: unknown) => error instanceof ImageGenError && error.code === "auth",
  );
});

test("crypto：掩码格式与短值全打码", () => {
  assert.equal(maskKey("sk-abcdef123456"), "sk-****3456");
  assert.equal(maskKey("short"), "****");
});

// ---------- settings 存取 ----------

test("settings：保存后密钥为密文且可解密、明文字段原样入库", async () => {
  const db = settingsDb();
  await saveImageGenSettings(
    db,
    USER_A,
    {
      provider: "seedream",
      providers: { seedream: { model: "doubao-seedream-4-0", baseUrl: "", apiKey: "ark-secret-1" } },
    } as ImageGenSettingsInput,
    env(),
  );
  const stored = db.store();
  assert.equal(stored["imagegen.IMAGE_PROVIDER"], "seedream");
  assert.equal(stored["imagegen.SEEDREAM_MODEL"], "doubao-seedream-4-0");
  const cipher = stored["imagegen.ARK_API_KEY"];
  assert.notEqual(cipher, "ark-secret-1");
  const key = (await getEncryptionKey(env()))!;
  assert.equal(await decryptSecret(key, cipher), "ark-secret-1");
});

test("settings：未配置主密钥时保存密钥抛 unconfigured", async () => {
  const db = settingsDb();
  await assert.rejects(
    () =>
      saveImageGenSettings(
        db,
        USER_A,
        { provider: "seedream", providers: { seedream: { apiKey: "ark-secret-1" } } } as ImageGenSettingsInput,
        {},
      ),
    (error: unknown) => error instanceof ImageGenError && error.code === "unconfigured",
  );
});

test("settings：未知厂商抛 invalid_input", async () => {
  const db = settingsDb();
  await assert.rejects(
    () => saveImageGenSettings(db, USER_A, { provider: "stability" } as unknown as ImageGenSettingsInput, env()),
    (error: unknown) => error instanceof ImageGenError && error.code === "invalid_input",
  );
});

test("settings：DB 密钥返回掩码、不回传明文", async () => {
  const key = (await getEncryptionKey(env()))!;
  const cipher = await encryptSecret(key, "ark-secret-1");
  const db = settingsDb({
    "imagegen.IMAGE_PROVIDER": "seedream",
    "imagegen.SEEDREAM_MODEL": "doubao-seedream-4-0",
    "imagegen.ARK_API_KEY": cipher,
  });
  const view = await getImageGenSettingsView(db, env(), USER_A);
  assert.equal(view.provider, "seedream");
  assert.equal(view.providers.seedream.keySource, "user");
  assert.equal(view.providers.seedream.apiKeyConfigured, true);
  assert.equal(view.providers.seedream.keyLocked, false);
  assert.match(view.providers.seedream.apiKeyMasked, /^ark\*{4}/);
  assert.equal(view.providers.seedream.apiKeyMasked.includes("ark-secret-1"), false);
});

test("settings：主密钥缺失时 DB 密钥标记 keyLocked", async () => {
  const key = (await getEncryptionKey(env()))!;
  const cipher = await encryptSecret(key, "ark-secret-1");
  const db = settingsDb({ "imagegen.ARK_API_KEY": cipher });
  const view = await getImageGenSettingsView(db, {}, USER_A);
  assert.equal(view.providers.seedream.keySource, "user");
  assert.equal(view.providers.seedream.keyLocked, true);
  assert.equal(view.providers.seedream.apiKeyMasked, "");
});

test("settings：平台环境变量不会作为用户图片生成配置", async () => {
  const db = settingsDb();
  const view = await getImageGenSettingsView(db, {
    OPENAI_API_KEY: "sk-openai-1",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  } as unknown as ReturnType<typeof env>, USER_A);
  assert.equal(view.providers.openai.keySource, "none");
  assert.equal(view.providers.openai.apiKeyConfigured, false);
  assert.equal(view.providers.openai.model, "");
});

test("settings：不同用户的生成配置彼此隔离", async () => {
  const db = settingsDb();
  await saveImageGenSettings(db, USER_A, {
    provider: "openai",
    providers: { openai: { apiKey: "sk-user-a" } },
  } as ImageGenSettingsInput, env());
  const own = await getImageGenSettingsView(db, env(), USER_A);
  const other = await getImageGenSettingsView(db, env(), USER_B);
  assert.equal(own.providers.openai.apiKeyConfigured, true);
  assert.equal(other.providers.openai.apiKeyConfigured, false);
  assert.equal(other.provider, "");
});

// ---------- resolveImageGenProvider ----------

test("resolveImageGenProvider：DB 配置优先（含密钥解密）", async () => {
  const key = (await getEncryptionKey(env()))!;
  const cipher = await encryptSecret(key, "ark-secret-1");
  const db = settingsDb({
    "imagegen.IMAGE_PROVIDER": "seedream",
    "imagegen.SEEDREAM_MODEL": "doubao-seedream-4-0",
    "imagegen.SEEDREAM_BASE_URL": "https://ark.example.com/api/v3",
    "imagegen.ARK_API_KEY": cipher,
  });
  const { adapter, config } = await resolveImageGenProvider({ DB: db, ...env() }, USER_A);
  assert.equal(adapter.name, "seedream");
  assert.equal(config.apiKey, "ark-secret-1");
  assert.equal(config.model, "doubao-seedream-4-0");
  assert.equal(config.baseUrl, "https://ark.example.com/api/v3");
});

test("resolveImageGenProvider：无个人配置时不回退平台环境变量", async () => {
  const db = settingsDb();
  await assert.rejects(
    () => resolveImageGenProvider({ DB: db, ...env() }, USER_A),
    (error: unknown) => error instanceof ImageGenError && error.code === "unconfigured",
  );
});

test("resolveImageGenProvider：未配置厂商抛 unconfigured", async () => {
  const db = settingsDb();
  await assert.rejects(
    () => resolveImageGenProvider({ DB: db, ...env() }, USER_A),
    (error: unknown) => error instanceof ImageGenError && error.code === "unconfigured",
  );
});

test("resolveImageGenProvider：DB 密钥缺少主密钥时抛 unconfigured", async () => {
  const key = (await getEncryptionKey(env()))!;
  const cipher = await encryptSecret(key, "ark-secret-1");
  const db = settingsDb({
    "imagegen.IMAGE_PROVIDER": "seedream",
    "imagegen.SEEDREAM_MODEL": "model-x",
    "imagegen.ARK_API_KEY": cipher,
  });
  await assert.rejects(
    () => resolveImageGenProvider({ DB: db }, USER_A),
    (error: unknown) =>
      error instanceof ImageGenError &&
      error.code === "unconfigured" &&
      /SETTINGS_ENCRYPTION_KEY/.test(error.message),
  );
});

// ---------- normalizeBaseUrl ----------

test("normalizeBaseUrl：Seedream 完整接口地址去重归一化", () => {
  assert.equal(
    normalizeBaseUrl("https://ark.cn-beijing.volces.com/api/v3/images/generations", "seedream"),
    "https://ark.cn-beijing.volces.com/api/v3",
  );
});

test("normalizeBaseUrl：OpenAI 完整接口地址去重归一化", () => {
  assert.equal(
    normalizeBaseUrl("https://api.openai.com/v1/images/edits", "openai"),
    "https://api.openai.com/v1",
  );
});

test("normalizeBaseUrl：Qwen 完整接口地址去重归一化", () => {
  assert.equal(
    normalizeBaseUrl(
      "https://ws-123.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      "qwen",
    ),
    "https://ws-123.cn-beijing.maas.aliyuncs.com",
  );
});

test("normalizeBaseUrl：正确前缀保持不变、容忍尾斜杠", () => {
  assert.equal(
    normalizeBaseUrl("https://ark.cn-beijing.volces.com/api/v3", "seedream"),
    "https://ark.cn-beijing.volces.com/api/v3",
  );
  assert.equal(
    normalizeBaseUrl("https://api.openai.com/v1/", "openai"),
    "https://api.openai.com/v1",
  );
});

test("normalizeBaseUrl：resolveImageGenProvider 返回归一化后的 baseUrl", async () => {
  const key = (await getEncryptionKey(env()))!;
  const cipher = await encryptSecret(key, "ark-secret-2");
  const db = settingsDb({
    "imagegen.IMAGE_PROVIDER": "seedream",
    "imagegen.SEEDREAM_MODEL": "model-x",
    "imagegen.SEEDREAM_BASE_URL": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    "imagegen.ARK_API_KEY": cipher,
  });
  const { config } = await resolveImageGenProvider({ DB: db, ...env() }, USER_A);
  assert.equal(config.baseUrl, "https://ark.cn-beijing.volces.com/api/v3");
});
