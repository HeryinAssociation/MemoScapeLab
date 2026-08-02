import assert from "node:assert/strict";
import test from "node:test";
import { HTML_IMAGE_FLIP_Y } from "../src/adaptive/adaptive-renderer";

test("uploads HTML images without vertical texture flipping", () => {
  assert.equal(HTML_IMAGE_FLIP_Y, 0);
});
