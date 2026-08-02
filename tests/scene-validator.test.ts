import assert from "node:assert/strict";
import test from "node:test";
import {
  SceneValidationError,
  validateScene,
} from "../src/core/scene-validator";
import { isPartialSphereProjection } from "../src/core/projection-types";

const validPartialScene = {
  id: "test-scene",
  title: "测试场景",
  source: "/images/test.png",
  mode: "partialSphere",
  projection: {
    haov: 190,
    vaov: 82,
    vOffset: -3,
  },
  view: {
    yaw: 0,
    pitch: 0,
    hfov: 72,
    minYaw: -72,
    maxYaw: 72,
    minPitch: -22,
    maxPitch: 25,
    minHfov: 55,
    maxHfov: 88,
  },
};

test("accepts a valid partialSphere scene", () => {
  const scene = validateScene(validPartialScene);
  assert.equal(scene.mode, "partialSphere");
  assert.equal(
    isPartialSphereProjection(scene.projection)
      ? scene.projection.haov
      : undefined,
    190,
  );
  assert.equal(scene.view.maxYaw, 72);
});

test("rejects partialSphere without projection settings", () => {
  const invalid = structuredClone(validPartialScene);
  delete (invalid as Partial<typeof validPartialScene>).projection;
  assert.throws(
    () => validateScene(invalid),
    (error) =>
      error instanceof SceneValidationError &&
      error.issues.some((issue) => issue.includes("projection")),
  );
});

test("rejects inverted view boundaries and out-of-range defaults", () => {
  const invalid = structuredClone(validPartialScene);
  invalid.view.minYaw = 80;
  invalid.view.maxYaw = -80;
  assert.throws(
    () => validateScene(invalid),
    (error) =>
      error instanceof SceneValidationError &&
      error.issues.some((issue) => issue.includes("minYaw")),
  );
});

test("accepts a complete curvedPhoto projection", () => {
  const adaptive = {
    ...validPartialScene,
    mode: "curvedPhoto",
    projection: {
      horizontalSpan: 190,
      verticalSpan: 78,
      horizontalCurvature: 0.68,
      verticalCurvature: 0.18,
      edgeCompression: 0.12,
      centerX: 0.5,
      centerY: 0.5,
      horizonY: 0.52,
      edgeMode: "feather",
      edgeFeather: 0.025,
    },
  };
  const scene = validateScene(adaptive);
  assert.equal(scene.mode, "curvedPhoto");
});

test("rejects an unsupported adaptive edge mode", () => {
  const invalid = {
    ...validPartialScene,
    mode: "curvedPhoto",
    projection: {
      horizontalSpan: 190,
      verticalSpan: 78,
      horizontalCurvature: 0.68,
      verticalCurvature: 0.18,
      edgeCompression: 0.12,
      centerX: 0.5,
      centerY: 0.5,
      horizonY: 0.52,
      edgeMode: "repeat-forever",
      edgeFeather: 0.025,
    },
  };
  assert.throws(
    () => validateScene(invalid),
    (error) =>
      error instanceof SceneValidationError &&
      error.issues.some((issue) => issue.includes("edgeMode")),
  );
});
