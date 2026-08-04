import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../worker/auth";
import { sendTencentVerificationCodeWithRetry } from "../worker/tencent-ses";

test("stores a salted one-way password hash", async () => {
  const password = "Correct-Horse-2026";
  const first = await hashPassword(password, "test-pepper");
  const second = await hashPassword(password, "test-pepper");

  assert.notEqual(first, second);
  assert.doesNotMatch(first, new RegExp(password));
  assert.match(first, /^pbkdf2_sha256\$600000\$/);
  assert.equal(await verifyPassword(password, first, "test-pepper"), true);
  assert.equal(await verifyPassword("wrong-password", first, "test-pepper"), false);
  assert.equal(await verifyPassword(password, first, "wrong-pepper"), false);
});

const tencentConfig = {
  secretId: "test-id",
  secretKey: "test-key",
  region: "ap-guangzhou",
  from: "sender@example.com",
  templateId: 123,
};

test("retries a failed Tencent delivery once with the same code", async () => {
  const codes: string[] = [];
  const result = await sendTencentVerificationCodeWithRetry(
    tencentConfig,
    "recipient@example.com",
    "123456",
    async (_config, _destination, code) => {
      codes.push(code);
      return codes.length === 1
        ? { ok: false, errorCode: "NETWORK_ERROR" }
        : { ok: true, messageId: "accepted" };
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(codes, ["123456", "123456"]);
});

test("does not duplicate an accepted Tencent delivery", async () => {
  let attempts = 0;
  const result = await sendTencentVerificationCodeWithRetry(
    tencentConfig,
    "recipient@example.com",
    "654321",
    async () => {
      attempts += 1;
      return { ok: true, messageId: "accepted" };
    },
  );
  assert.equal(result.ok, true);
  assert.equal(attempts, 1);
});
