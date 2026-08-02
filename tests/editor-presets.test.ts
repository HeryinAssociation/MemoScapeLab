import assert from "node:assert/strict";
import test from "node:test";
import {
  isAdaptiveProjection,
  type AdaptiveProjectionConfig,
} from "../src/core/projection-types";
import { validateScene } from "../src/core/scene-validator";
import { EDITOR_PRESETS } from "../src/editor/presets";

const baseScene = {
  id: "preset-test",
  title: "预设测试",
  source: "/images/test.png",
};

test("ships all seven required editor presets", () => {
  assert.deepEqual(
    EDITOR_PRESETS.map((preset) => preset.name),
    [
      "标准 360°",
      "部分球面",
      "建筑街景",
      "轻度弧形",
      "强度弧形",
      "宽幅照片",
      "历史长卷",
    ],
  );
});

test("keeps every adaptive preset inside supported parameter ranges", () => {
  for (const preset of EDITOR_PRESETS) {
    if (!preset.projection) continue;
    const projection: AdaptiveProjectionConfig = preset.projection;
    assert.ok(projection.horizontalSpan >= 60);
    assert.ok(projection.horizontalSpan <= 360);
    assert.ok(projection.verticalSpan >= 30);
    assert.ok(projection.verticalSpan <= 180);
    assert.ok(projection.horizontalCurvature >= 0);
    assert.ok(projection.horizontalCurvature <= 1);
    assert.ok(projection.verticalCurvature >= 0);
    assert.ok(projection.verticalCurvature <= 1);
  }
});

test("produces validator-compatible adaptive preset scenes", () => {
  for (const preset of EDITOR_PRESETS) {
    if (!preset.projection) continue;
    const scene = validateScene({
      ...baseScene,
      mode: preset.mode,
      projection: preset.projection,
      view: preset.view,
    });
    assert.equal(isAdaptiveProjection(scene.projection), true);
  }
});
