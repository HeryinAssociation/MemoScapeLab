import type { ImmersiveScene } from "../core/projection-types";

export function serializeScene(
  scene: ImmersiveScene,
  source: string,
): string {
  return JSON.stringify({ ...scene, source }, null, 2);
}

export function downloadSceneConfig(
  scene: ImmersiveScene,
  source: string,
) {
  const blob = new Blob([serializeScene(scene, source)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${scene.id || "scene"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

