export type SceneMode =
  | "sphere360"
  | "partialSphere"
  | "curvedPhoto"
  | "flatPhoto";

export type EdgeMode =
  | "wrap"
  | "clamp"
  | "feather"
  | "mirror"
  | "background";

export interface PartialSphereProjectionConfig {
  haov: number;
  vaov: number;
  vOffset: number;
}

export interface AdaptiveProjectionConfig {
  horizontalSpan: number;
  verticalSpan: number;
  horizontalCurvature: number;
  verticalCurvature: number;
  edgeCompression: number;
  centerX: number;
  centerY: number;
  horizonY: number;
  edgeMode: EdgeMode;
  edgeFeather: number;
}

export type ProjectionConfig =
  | PartialSphereProjectionConfig
  | AdaptiveProjectionConfig;

export interface ViewConfig {
  yaw: number;
  pitch: number;
  hfov: number;
  minYaw: number;
  maxYaw: number;
  minPitch: number;
  maxPitch: number;
  minHfov: number;
  maxHfov: number;
}

export interface SceneHotspot {
  id: string;
  type: "info";
  text: string;
  yaw: number;
  pitch: number;
}

export interface SceneMetadata {
  sourceYear?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  originalImageUrl?: string;
  sourceRecord?: Record<string, unknown>;
  aiColorized?: boolean;
  aiExpanded?: boolean;
  disclaimer?: string;
}

export interface ImmersiveScene {
  id: string;
  title: string;
  subtitle?: string;
  source: string;
  thumbnail?: string;
  mode: SceneMode;
  projection?: ProjectionConfig;
  view: ViewConfig;
  hotspots?: SceneHotspot[];
  metadata?: SceneMetadata;
}

export const DEFAULT_ADAPTIVE_PROJECTION: AdaptiveProjectionConfig = {
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
};

export function isPartialSphereProjection(
  projection: ProjectionConfig | undefined,
): projection is PartialSphereProjectionConfig {
  return Boolean(projection && "haov" in projection);
}

export function isAdaptiveProjection(
  projection: ProjectionConfig | undefined,
): projection is AdaptiveProjectionConfig {
  return Boolean(projection && "horizontalSpan" in projection);
}
