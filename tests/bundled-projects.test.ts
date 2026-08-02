import assert from "node:assert/strict";
import test from "node:test";
import { validateScene } from "../src/core/scene-validator";
import { BUNDLED_PROJECTS } from "../src/projects/bundled-projects";

test("imports both historical originals and keeps their panoramas separate", () => {
  assert.equal(BUNDLED_PROJECTS.length, 2);

  for (const project of BUNDLED_PROJECTS) {
    assert.match(project.originalImageUrl, /\.jpg$/);
    assert.match(project.panoramaImageUrl, /\.png$/);
    assert.notEqual(project.originalImageUrl, project.panoramaImageUrl);
    assert.equal(project.scene.source, project.panoramaImageUrl);
    assert.equal(
      project.scene.metadata?.originalImageUrl,
      project.originalImageUrl,
    );
    assert.ok(project.scene.metadata?.sourceRecord);
  }
});

test("maps the imported metadata to the two project records", () => {
  const [gardenBridge, bund1991] = BUNDLED_PROJECTS;

  assert.equal(gardenBridge.captureTime, "1880 年");
  assert.match(gardenBridge.title, /外白渡桥/);
  assert.equal(
    gardenBridge.scene.metadata?.sourceRecord?.image_path,
    "images/vs_001_19327.jpg",
  );

  assert.equal(bund1991.captureTime, "1991 年夏");
  assert.match(bund1991.location, /黄浦区/);
  assert.equal(
    bund1991.scene.metadata?.sourceRecord?.image_path,
    "images/lz_001_521da5f3-a2d5-4931-bd38-020cbd563b6a.jpg",
  );
});

test("keeps source metadata through scene export and import validation", () => {
  const original = BUNDLED_PROJECTS[0].scene;
  const restored = validateScene(JSON.parse(JSON.stringify(original)));

  assert.equal(restored.metadata?.sourceUrl, original.metadata?.sourceUrl);
  assert.equal(
    restored.metadata?.sourceRecord?.image_path,
    "images/vs_001_19327.jpg",
  );
});
