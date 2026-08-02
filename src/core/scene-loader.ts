import { validateScene } from "./scene-validator";
import type { ImmersiveScene } from "./projection-types";

export async function loadScene(
  url: string,
  signal?: AbortSignal,
): Promise<ImmersiveScene> {
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("无法连接场景配置，请检查网络或文件路径。");
  }

  if (!response.ok) {
    throw new Error(`场景配置加载失败（HTTP ${response.status}）。`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("场景配置不是有效的 JSON。");
  }

  return validateScene(data);
}

