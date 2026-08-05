import assert from "node:assert/strict";
import test from "node:test";
import { ImageGenError } from "../worker/image-gen/types";
import { seedreamAdapter } from "../worker/image-gen/seedream";
import { openaiAdapter } from "../worker/image-gen/openai";
import { qwenAdapter } from "../worker/image-gen/qwen";

const config = {
  apiKey: "test-key",
  baseUrl: "https://provider.example.com",
  model: "test-model",
};

test("seedream buildRequest：构造统一请求（Bearer + url 返回 + 单张参考图）", () => {
  const { url, headers, body } = seedreamAdapter.buildRequest(config, {
    prompt: "扩成全景",
    referenceImages: ["/api/assets/a.png"],
    size: "1024x1024",
  });
  assert.equal(url, "https://provider.example.com/images/generations");
  assert.deepEqual(headers, { authorization: "Bearer test-key" });
  const parsed = JSON.parse(body);
  assert.equal(parsed.model, "test-model");
  assert.equal(parsed.prompt, "扩成全景");
  assert.equal(parsed.image, "/api/assets/a.png");
  assert.equal(parsed.response_format, "url");
  assert.equal(parsed.output_format, "png");
  assert.equal(parsed.watermark, false);
  assert.equal(parsed.size, "1024x1024");
});

test("seedream buildRequest：多张参考图转数组、默认关水印", () => {
  const { body } = seedreamAdapter.buildRequest(config, {
    prompt: "p",
    referenceImages: ["/a.png", "/b.png"],
  });
  const parsed = JSON.parse(body);
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

test("openai buildRequest：参考图转 image_url 数组 + 默认质量/尺寸", () => {
  const { url, headers, body } = openaiAdapter.buildRequest(config, {
    prompt: "水彩效果",
    referenceImages: ["/api/assets/original.png"],
  });
  assert.equal(url, "https://provider.example.com/images/edits");
  assert.deepEqual(headers, { authorization: "Bearer test-key" });
  const parsed = JSON.parse(body);
  assert.equal(parsed.model, "test-model");
  assert.equal(parsed.prompt, "水彩效果");
  assert.deepEqual(parsed.images, [{ image_url: "/api/assets/original.png" }]);
  assert.equal(parsed.quality, "medium");
  assert.equal(parsed.size, "1024x1024");
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
  const parsed = JSON.parse(body);
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
