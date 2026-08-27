import assert from "node:assert/strict";
import test from "node:test";
import {
  createLightCosPresignedUrl,
  lightCosBucketForKind,
  lightCosConfigFromEnv,
  lightCosRequestUrl,
  missingLightCosBindings,
  validateLightCosUpload,
} from "../worker/lightcos";

const config = {
  accountId: "100020696386",
  appId: "1306930939",
  region: "ap-shanghai",
  archiveBucket: "memoscape-archive-1306930939",
  mediaBucket: "memoscape-media-1306930939",
  secretId: "AKIDEXAMPLE",
  secretKey: "example-secret-key",
  publicDomain: "",
};

test("maps originals and derived media to separate LightCOS buckets", () => {
  assert.equal(lightCosBucketForKind(config, "original"), config.archiveBucket);
  assert.equal(lightCosBucketForKind(config, "reference_panorama"), config.mediaBucket);
  assert.equal(lightCosBucketForKind(config, "panorama"), config.mediaBucket);
  assert.equal(lightCosBucketForKind(config, "thumbnail"), config.mediaBucket);
  assert.equal(lightCosBucketForKind(config, "avatar"), config.mediaBucket);
});

test("enforces image types and per-kind upload limits", () => {
  assert.equal(validateLightCosUpload("original", "image/jpeg", 10 * 1024 * 1024).extension, ".jpg");
  assert.equal(validateLightCosUpload("reference_panorama", "image/webp", 50 * 1024 * 1024).extension, ".webp");
  assert.equal(validateLightCosUpload("panorama", "image/webp", 50 * 1024 * 1024).extension, ".webp");
  assert.equal(validateLightCosUpload("avatar", "image/png", 5 * 1024 * 1024).extension, ".png");
  assert.throws(() => validateLightCosUpload("original", "image/jpeg", 10 * 1024 * 1024 + 1), /10 MB/);
  assert.throws(() => validateLightCosUpload("avatar", "image/jpeg", 5 * 1024 * 1024 + 1), /头像不能超过 5 MB/);
  assert.throws(() => validateLightCosUpload("panorama", "image/tiff", 1024), /仅支持/);
});

test("requires complete LightCOS runtime configuration", () => {
  assert.equal(lightCosConfigFromEnv({ TENCENT_LIGHTCOS_REGION: "ap-shanghai" }), null);
  assert.equal(lightCosConfigFromEnv({
    TENCENT_LIGHTCOS_APP_ID: config.appId,
    TENCENT_LIGHTCOS_REGION: config.region,
    TENCENT_LIGHTCOS_ARCHIVE_BUCKET: config.archiveBucket,
    TENCENT_LIGHTCOS_MEDIA_BUCKET: config.mediaBucket,
    TENCENT_LIGHTCOS_SECRET_ID: config.secretId,
    TENCENT_LIGHTCOS_SECRET_KEY: config.secretKey,
  })?.mediaBucket, config.mediaBucket);
  assert.deepEqual(missingLightCosBindings({
    TENCENT_LIGHTCOS_SECRET_ID: config.secretId,
    TENCENT_LIGHTCOS_SECRET_KEY: config.secretKey,
  }), [
    "TENCENT_LIGHTCOS_APP_ID",
    "TENCENT_LIGHTCOS_REGION",
    "TENCENT_LIGHTCOS_ARCHIVE_BUCKET",
    "TENCENT_LIGHTCOS_MEDIA_BUCKET",
  ]);
});

test("creates a short-lived method-bound LightCOS upload URL", async () => {
  const signedUrl = await createLightCosPresignedUrl({
    config,
    method: "PUT",
    bucket: config.archiveBucket,
    key: "users/user-1/projects/unassigned/original/asset-1.jpg",
    expiresInSeconds: 900,
    nowSeconds: 1_800_000_000,
  });
  const url = new URL(signedUrl);
  assert.equal(url.hostname, "memoscape-archive-1306930939.cos.ap-shanghai.myqcloud.com");
  assert.equal(url.pathname, "/users/user-1/projects/unassigned/original/asset-1.jpg");
  assert.equal(url.searchParams.get("q-sign-algorithm"), "sha1");
  assert.equal(url.searchParams.get("q-sign-time"), "1800000000;1800000900");
  assert.equal(url.searchParams.get("q-header-list"), "host");
  assert.match(url.searchParams.get("q-signature") ?? "", /^[a-f0-9]{40}$/);
  assert.doesNotMatch(signedUrl, new RegExp(config.secretKey));
});

test("routes signed LightCOS requests through the optional self-hosted proxy", () => {
  const signedUrl = "https://bucket.cos.ap-shanghai.myqcloud.com/path/image.jpg?q-signature=abc";
  assert.equal(lightCosRequestUrl(config, signedUrl), signedUrl);
  const proxied = new URL(lightCosRequestUrl({ ...config, proxyEndpoint: "http://ses-proxy:8788/cos" }, signedUrl));
  assert.equal(proxied.origin + proxied.pathname, "http://ses-proxy:8788/cos");
  assert.equal(proxied.searchParams.get("url"), signedUrl);
});
