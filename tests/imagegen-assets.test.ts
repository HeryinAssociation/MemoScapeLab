import assert from "node:assert/strict";
import test from "node:test";
import type { R2Bucket, R2ObjectBody } from "../worker/auth";
import { assetToDataUrl, storeParsedImages } from "../worker/image-gen/pipeline";
import { ImageGenError } from "../worker/image-gen/types";

function streamOf(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** 内存版 R2 mock：get 返回指定内容，未命中返回 null。 */
function mockR2(entries: Record<string, { bytes: Uint8Array; contentType: string }>): R2Bucket {
  const get = async (key: string): Promise<R2ObjectBody | null> => {
    const entry = entries[key];
    if (!entry) return null;
    return {
      body: streamOf(entry.bytes),
      httpEtag: `"etag-${key}"`,
      httpMetadata: { contentType: entry.contentType },
    };
  };
  return {
    get,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ objects: [], truncated: false }),
  } as unknown as R2Bucket;
}

const PNG_BYTES = new TextEncoder().encode("fake-png-bytes");

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  assert.ok(match, `不是合法的 data URL：${dataUrl.slice(0, 40)}`);
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

test("assetToDataUrl：/api/assets 路径解码 key 并返回 data URL（MIME 小写）", async () => {
  const r2 = mockR2({
    "users/u1/projects/p1.png": { bytes: PNG_BYTES, contentType: "image/png" },
  });
  const dataUrl = await assetToDataUrl(r2, "/api/assets/users%2Fu1%2Fprojects%2Fp1.png");
  const { mime, bytes } = decodeDataUrl(dataUrl);
  assert.equal(mime, "image/png");
  assert.deepEqual([...bytes], [...PNG_BYTES]);
});

test("assetToDataUrl：MIME 大写也会被转成小写", async () => {
  const r2 = mockR2({
    "a/b.jpg": { bytes: PNG_BYTES, contentType: "image/JPEG" },
  });
  const dataUrl = await assetToDataUrl(r2, "a/b.jpg");
  const { mime } = decodeDataUrl(dataUrl);
  assert.equal(mime, "image/jpeg");
});

test("assetToDataUrl：直接传 key 时原样使用（不回退 /api/assets 前缀）", async () => {
  const r2 = mockR2({
    "users/u1/projects/p2.png": { bytes: PNG_BYTES, contentType: "image/png" },
  });
  const dataUrl = await assetToDataUrl(r2, "users/u1/projects/p2.png");
  assert.equal(dataUrl.startsWith("data:image/png;base64,"), true);
});

test("assetToDataUrl：对象不存在抛 ImageGenError", async () => {
  const r2 = mockR2({});
  await assert.rejects(
    () => assetToDataUrl(r2, "/api/assets/users%2Fu1%2Fmissing.png"),
    (error: unknown) => error instanceof ImageGenError && /参考图不存在/.test(error.message),
  );
});

test("assetToDataUrl：缺少 httpMetadata 时默认 image/png", async () => {
  const r2 = {
    get: async () => ({
      body: streamOf(PNG_BYTES),
      httpEtag: "etag",
    }),
  } as unknown as R2Bucket;
  const dataUrl = await assetToDataUrl(r2, "k.png");
  const { mime } = decodeDataUrl(dataUrl);
  assert.equal(mime, "image/png");
});

test("storeParsedImages：异步回调使用确定性 key，重试不会产生新对象", async () => {
  const writes: Array<{ key: string; bytes: Uint8Array; contentType?: string }> = [];
  const r2 = {
    put: async (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      writes.push({
        key,
        bytes: new Uint8Array(value),
        contentType: options?.httpMetadata?.contentType,
      });
    },
  } as unknown as R2Bucket;
  const parsed = { images: [{ b64: "aGVsbG8=", format: "png" }] };
  const options = {
    parsed,
    r2,
    r2KeyPrefix: "users/u/projects/p/generated",
    keyForIndex: (index: number, extension: string) => `users/u/projects/p/generated/task-${index}.${extension}`,
  };
  const first = await storeParsedImages(options);
  const second = await storeParsedImages(options);
  assert.equal(first[0].key, "users/u/projects/p/generated/task-0.png");
  assert.equal(second[0].key, first[0].key);
  assert.deepEqual(writes.map((write) => write.key), [first[0].key, first[0].key]);
  assert.equal(writes[0].contentType, "image/png");
  assert.equal(new TextDecoder().decode(writes[0].bytes), "hello");
});
