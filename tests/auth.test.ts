import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../worker/auth";

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
