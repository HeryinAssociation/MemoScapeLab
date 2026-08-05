import assert from "node:assert/strict";
import test from "node:test";
import { calculateThumbnailGeometry } from "../src/images/client-thumbnail";

test("fits panorama thumbnails inside the display envelope without cropping", () => {
  assert.deepEqual(calculateThumbnailGeometry(12000, 6000), {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 12000,
    sourceHeight: 6000,
    targetWidth: 1600,
    targetHeight: 800,
  });
});

test("center-crops avatar thumbnails to a square without upscaling", () => {
  assert.deepEqual(calculateThumbnailGeometry(1200, 800, {
    maxWidth: 384,
    maxHeight: 384,
    square: true,
  }), {
    sourceX: 200,
    sourceY: 0,
    sourceWidth: 800,
    sourceHeight: 800,
    targetWidth: 384,
    targetHeight: 384,
  });
});
