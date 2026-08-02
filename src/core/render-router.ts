import type { ImmersiveScene } from "./projection-types";
import {
  createAdaptiveRenderer,
  type AdaptiveRendererOptions,
} from "../adaptive/adaptive-renderer";
import { createPannellumViewer } from "../pannellum/pannellum-adapter";

export interface RenderHandle {
  destroy(): void;
  update?(scene: ImmersiveScene): void;
}

export async function renderScene(
  container: HTMLElement,
  scene: ImmersiveScene,
  options: AdaptiveRendererOptions = {},
): Promise<RenderHandle> {
  switch (scene.mode) {
    case "sphere360":
    case "partialSphere":
      return createPannellumViewer(container, scene, options);
    case "curvedPhoto":
    case "flatPhoto":
      return createAdaptiveRenderer(container, scene, options);
    default: {
      const exhaustive: never = scene.mode;
      throw new Error(`不受支持的场景模式：${exhaustive}`);
    }
  }
}
