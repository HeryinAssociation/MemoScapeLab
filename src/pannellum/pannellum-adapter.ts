import {
  isPartialSphereProjection,
  type ImmersiveScene,
} from "../core/projection-types";
import type { AdaptiveRendererOptions } from "../adaptive/adaptive-renderer";

interface PannellumViewer {
  destroy(): void;
  on(event: "load" | "error", listener: (...args: unknown[]) => void): void;
  getYaw(): number;
  getPitch(): number;
  getHfov(): number;
}

interface PannellumNamespace {
  viewer(
    container: HTMLElement | string,
    config: Record<string, unknown>,
  ): PannellumViewer;
}

declare global {
  interface Window {
    pannellum?: PannellumNamespace;
  }
}

async function waitForPannellum(timeout = 5000) {
  const startedAt = performance.now();
  while (!window.pannellum) {
    if (performance.now() - startedAt > timeout) {
      throw new Error("Pannellum 脚本加载超时，请刷新页面后重试。");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return window.pannellum;
}

export async function createPannellumViewer(
  container: HTMLElement,
  scene: ImmersiveScene,
  options: Pick<AdaptiveRendererOptions, "onViewChange"> = {},
) {
  const pannellum = await waitForPannellum();
  const buildConfig = (current: ImmersiveScene) => {
    const { view } = current;
    const projection =
      current.mode === "partialSphere" &&
      isPartialSphereProjection(current.projection)
        ? current.projection
        : { haov: 360, vaov: 180, vOffset: 0 };
    return {
      type: "equirectangular",
      panorama: current.source,
      title: current.title,
      author: current.metadata?.sourceLabel,
      autoLoad: true,
      autoRotate: false,
      showControls: true,
      showFullscreenCtrl: true,
      showZoomCtrl: true,
      mouseZoom: true,
      draggable: true,
      keyboardZoom: true,
      orientationOnByDefault: false,
      backgroundColor: [8 / 255, 11 / 255, 10 / 255],
      avoidShowingBackground: true,
      haov: projection.haov,
      vaov: projection.vaov,
      vOffset: projection.vOffset,
      yaw: view.yaw,
      pitch: view.pitch,
      hfov: view.hfov,
      minYaw: view.minYaw,
      maxYaw: view.maxYaw,
      minPitch: view.minPitch,
      maxPitch: view.maxPitch,
      minHfov: view.minHfov,
      maxHfov: view.maxHfov,
      hotSpots: current.hotspots?.map((hotspot) => ({
        id: hotspot.id,
        type: hotspot.type,
        text: hotspot.text,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
      })),
    };
  };

  let viewer = pannellum.viewer(container, buildConfig(scene));
  let destroyed = false;
  let viewFrame = 0;
  let lastView = { yaw: Number.NaN, pitch: Number.NaN, hfov: Number.NaN };

  const observeView = () => {
    if (destroyed || !options.onViewChange) return;
    const nextView = {
      yaw: viewer.getYaw(),
      pitch: viewer.getPitch(),
      hfov: viewer.getHfov(),
    };
    if (
      nextView.yaw !== lastView.yaw ||
      nextView.pitch !== lastView.pitch ||
      nextView.hfov !== lastView.hfov
    ) {
      lastView = nextView;
      options.onViewChange(nextView);
    }
    viewFrame = window.requestAnimationFrame(observeView);
  };

  if (options.onViewChange) viewFrame = window.requestAnimationFrame(observeView);

  return {
    update(nextScene: ImmersiveScene) {
      viewer.destroy();
      viewer = pannellum.viewer(container, buildConfig(nextScene));
    },
    destroy() {
      destroyed = true;
      if (viewFrame) window.cancelAnimationFrame(viewFrame);
      viewer.destroy();
    },
  };
}
