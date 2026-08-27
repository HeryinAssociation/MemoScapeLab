import assert from "node:assert/strict";
import test from "node:test";
import { ImageGenError } from "../worker/image-gen/types";
import { seedreamAdapter } from "../worker/image-gen/seedream";
import { openaiAdapter } from "../worker/image-gen/openai";
import { qwenAdapter } from "../worker/image-gen/qwen";
import {
  defaultPromptForMode,
  normalizeImageGenerationMode,
  referencePathsForMode,
} from "../worker/image-gen/modes";
import {
  hasSeedreamAsyncProxy,
  submitSeedreamProxyJob,
} from "../worker/image-gen/seedream-proxy";

const config = {
  apiKey: "test-key",
  baseUrl: "https://provider.example.com",
  model: "test-model",
};

test("seedream buildRequest：构造统一请求（Bearer + Base64 返回 + 单张参考图）", () => {
  const { url, headers, body } = seedreamAdapter.buildRequest(config, {
    prompt: "扩成全景",
    referenceImages: ["/api/assets/a.png"],
    size: "1024x1024",
  });
  assert.equal(url, "https://provider.example.com/images/generations");
  assert.deepEqual(headers, { authorization: "Bearer test-key" });
  const parsed = JSON.parse(String(body));
  assert.equal(parsed.model, "test-model");
  assert.equal(parsed.prompt, "扩成全景");
  assert.equal(parsed.image, "/api/assets/a.png");
  assert.equal(parsed.response_format, "b64_json");
  assert.equal(parsed.output_format, "png");
  assert.equal(parsed.watermark, false);
  assert.equal(parsed.size, "1024x1024");
});

test("seedream buildRequest：多张参考图转数组、默认关水印", () => {
  const { body } = seedreamAdapter.buildRequest(config, {
    prompt: "p",
    referenceImages: ["/a.png", "/b.png"],
  });
  const parsed = JSON.parse(String(body));
  assert.deepEqual(parsed.image, ["/a.png", "/b.png"]);
  assert.equal(parsed.watermark, false);
});

test("seedream parseResponse：url 形态归一化", () => {
  const parsed = seedreamAdapter.parseResponse({
    data: [{ url: "https://img.example.com/out.png" }],
  });
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0].url, "https://img.example.com/out.png");
  assert.equal(parsed.images[0].format, "png");
});

test("seedream parseResponse：厂商错误抛 ImageGenError", () => {
  assert.throws(
    () => seedreamAdapter.parseResponse({ error: { message: "配额不足" } }),
    (error: unknown) => error instanceof ImageGenError && error.code === "upstream_error",
  );
});

test("openai buildRequest：两张参考图按顺序转 multipart image[]", () => {
  const { url, headers, body } = openaiAdapter.buildRequest(config, {
    prompt: "水彩效果",
    referenceImages: [
      "data:image/jpeg;base64,aGVsbG8=",
      "data:image/png;base64,d29ybGQ=",
    ],
    size: "2048x1024",
    quality: "high",
  });
  assert.equal(url, "https://provider.example.com/images/edits");
  assert.deepEqual(headers, { authorization: "Bearer test-key" });
  assert.ok(body instanceof FormData);
  assert.equal(body.get("model"), "test-model");
  assert.equal(body.get("prompt"), "水彩效果");
  assert.equal(body.get("quality"), "high");
  assert.equal(body.get("size"), "2048x1024");
  assert.equal(body.get("output_format"), "png");
  const images = body.getAll("image[]");
  assert.equal(images.length, 2);
  assert.equal((images[0] as File).type, "image/jpeg");
  assert.equal((images[1] as File).type, "image/png");
});

test("seedream async proxy：必须同时配置私网地址和内部令牌", () => {
  assert.equal(hasSeedreamAsyncProxy({}), false);
  assert.equal(hasSeedreamAsyncProxy({ SEEDREAM_ASYNC_PROXY_URL: "http://proxy/jobs" }), false);
  assert.equal(hasSeedreamAsyncProxy({
    SEEDREAM_ASYNC_PROXY_URL: "http://proxy/jobs",
    IMAGEGEN_INTERNAL_TOKEN: "internal-token",
  }), true);
});

test("seedream async proxy：只等待代理接单并校验同一任务号", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  await submitSeedreamProxyJob({
    env: {
      SEEDREAM_ASYNC_PROXY_URL: "http://ses-proxy:8788/ark/jobs/",
      IMAGEGEN_INTERNAL_TOKEN: "internal-token",
    },
    taskId: "123e4567-e89b-42d3-a456-426614174000",
    adapter: seedreamAdapter,
    config,
    request: { prompt: "历史全景", referenceImages: ["data:image/png;base64,aA=="] },
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        jobId: "123e4567-e89b-42d3-a456-426614174000",
        status: "running",
      }), { status: 202 });
    },
  });
  assert.equal(capturedUrl, "http://ses-proxy:8788/ark/jobs/123e4567-e89b-42d3-a456-426614174000");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>)["x-memoscape-internal-token"], "internal-token");
  assert.equal((capturedInit?.headers as Record<string, string>).authorization, "Bearer test-key");
  assert.match(String(capturedInit?.body), /"response_format":"b64_json"/);
});

test("seedream async proxy：代理返回不同任务号时拒绝接单", async () => {
  await assert.rejects(
    () => submitSeedreamProxyJob({
      env: {
        SEEDREAM_ASYNC_PROXY_URL: "http://ses-proxy:8788/ark/jobs",
        IMAGEGEN_INTERNAL_TOKEN: "internal-token",
      },
      taskId: "123e4567-e89b-42d3-a456-426614174000",
      adapter: seedreamAdapter,
      config,
      request: { prompt: "p", referenceImages: [] },
      fetchImpl: async () => new Response(JSON.stringify({ jobId: "wrong" }), { status: 202 }),
    }),
    (error: unknown) => error instanceof ImageGenError && /无效任务号/.test(error.message),
  );
});

test("generation mode：推荐模式按现实全景、历史照片顺序组装参考图", () => {
  const mode = normalizeImageGenerationMode(undefined);
  assert.equal(mode, "historical_with_present_panorama");
  assert.deepEqual(
    referencePathsForMode(
      { originalImageUrl: "/history.jpg", referencePanoramaImageUrl: "/present.jpg" },
      mode,
    ),
    ["/present.jpg", "/history.jpg"],
  );
  assert.match(defaultPromptForMode(mode), /电线杆/);
  assert.match(defaultPromptForMode(mode), /马路牙子/);
  assert.match(defaultPromptForMode(mode), /首尾无缝/);
  assert.match(defaultPromptForMode(mode, "1943 年"), /^目标历史时期：1943 年。/);
});

test("generation mode：仅历史照片模式只引用历史图", () => {
  assert.deepEqual(
    referencePathsForMode(
      { originalImageUrl: "/history.jpg", referencePanoramaImageUrl: "/present.jpg" },
      "historical_only",
    ),
    ["/history.jpg"],
  );
});

test("openai parseResponse：b64_json 形态归一化为 png", () => {
  const parsed = openaiAdapter.parseResponse({
    data: [{ b64_json: "aGVsbG8=" }],
  });
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0].b64, "aGVsbG8=");
  assert.equal(parsed.images[0].format, "png");
});

test("openai parseResponse：错误体抛 ImageGenError", () => {
  assert.throws(
    () => openaiAdapter.parseResponse({ error: { message: "invalid api key" } }),
    (error: unknown) => error instanceof ImageGenError,
  );
});

test("qwen buildRequest：Chat 风格（图在前文在后）+ 参数映射", () => {
  const { url, headers, body } = qwenAdapter.buildRequest(config, {
    prompt: "换装",
    referenceImages: ["/api/assets/p.png"],
    size: "1024x1024",
    negativePrompt: "模糊",
    seed: 42,
  });
  assert.equal(
    url,
    "https://provider.example.com/api/v1/services/aigc/multimodal-generation/generation",
  );
  assert.deepEqual(headers, { authorization: "Bearer test-key" });
  const parsed = JSON.parse(String(body));
  assert.equal(parsed.model, "test-model");
  const content = parsed.input.messages[0].content;
  assert.deepEqual(content[0], { image: "/api/assets/p.png" });
  assert.deepEqual(content[1], { text: "换装" });
  assert.equal(parsed.parameters.prompt_extend, true);
  assert.equal(parsed.parameters.watermark, false);
  assert.equal(parsed.parameters.size, "1024*1024"); // x → * 转换
  assert.equal(parsed.parameters.negative_prompt, "模糊");
  assert.equal(parsed.parameters.seed, 42);
});

test("qwen parseResponse：output.choices 内 image URL + usage 尺寸", () => {
  const parsed = qwenAdapter.parseResponse({
    output: {
      choices: [
        {
          message: { content: [{ image: "https://dashscope-result.oss-cn-shenzhen.aliyuncs.com/x.png" }] },
        },
      ],
    },
    usage: { width: 1024, height: 1024 },
  });
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0].url, "https://dashscope-result.oss-cn-shenzhen.aliyuncs.com/x.png");
  assert.equal(parsed.images[0].format, "png");
  assert.equal(parsed.images[0].width, 1024);
  assert.equal(parsed.images[0].height, 1024);
});

test("qwen parseResponse：厂商错误码抛 ImageGenError", () => {
  assert.throws(
    () => qwenAdapter.parseResponse({ code: "InvalidApiKey", message: "Invalid API-key provided." }),
    (error: unknown) => error instanceof ImageGenError && /InvalidApiKey/.test(error.message),
  );
});
