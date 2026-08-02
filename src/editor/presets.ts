import {
  DEFAULT_ADAPTIVE_PROJECTION,
  type AdaptiveProjectionConfig,
  type ImmersiveScene,
  type SceneMode,
} from "../core/projection-types";

export interface EditorPreset {
  id: string;
  name: string;
  description: string;
  mode: SceneMode;
  projection?: AdaptiveProjectionConfig;
  view: ImmersiveScene["view"];
}

const view = (
  yaw: number,
  pitch: number,
  hfov: number,
  minYaw: number,
  maxYaw: number,
  minPitch: number,
  maxPitch: number,
  minHfov: number,
  maxHfov: number,
) => ({
  yaw,
  pitch,
  hfov,
  minYaw,
  maxYaw,
  minPitch,
  maxPitch,
  minHfov,
  maxHfov,
});

export const EDITOR_PRESETS: EditorPreset[] = [
  {
    id: "sphere",
    name: "标准 360°",
    description: "接缝自然的等距柱状全景",
    mode: "sphere360",
    view: view(0, 0, 88, -180, 180, -75, 75, 40, 110),
  },
  {
    id: "partial",
    name: "部分球面",
    description: "隐藏接缝与上下极区",
    mode: "partialSphere",
    view: view(0, 0, 72, -72, 72, -22, 25, 55, 88),
  },
  {
    id: "architecture",
    name: "建筑街景",
    description: "水平弯曲，垂直结构稳定",
    mode: "curvedPhoto",
    projection: {
      ...DEFAULT_ADAPTIVE_PROJECTION,
      horizontalSpan: 190,
      verticalSpan: 78,
      horizontalCurvature: 0.68,
      verticalCurvature: 0.12,
      edgeCompression: 0.12,
    },
    view: view(0, 0, 72, -74, 74, -20, 24, 52, 90),
  },
  {
    id: "soft-curve",
    name: "轻度弧形",
    description: "保留宽幅构图的小幅沉浸感",
    mode: "curvedPhoto",
    projection: {
      ...DEFAULT_ADAPTIVE_PROJECTION,
      horizontalSpan: 155,
      verticalSpan: 68,
      horizontalCurvature: 0.38,
      verticalCurvature: 0.05,
      edgeCompression: 0.06,
    },
    view: view(0, 0, 68, -52, 52, -16, 18, 48, 82),
  },
  {
    id: "deep-curve",
    name: "强度弧形",
    description: "大范围街景与广场",
    mode: "curvedPhoto",
    projection: {
      ...DEFAULT_ADAPTIVE_PROJECTION,
      horizontalSpan: 225,
      verticalSpan: 88,
      horizontalCurvature: 0.88,
      verticalCurvature: 0.24,
      edgeCompression: 0.2,
    },
    view: view(0, -2, 78, -92, 92, -24, 28, 55, 96),
  },
  {
    id: "wide",
    name: "宽幅照片",
    description: "平面浏览与轻度视差",
    mode: "flatPhoto",
    projection: {
      ...DEFAULT_ADAPTIVE_PROJECTION,
      horizontalSpan: 125,
      verticalSpan: 58,
      horizontalCurvature: 0,
      verticalCurvature: 0,
      edgeCompression: 0,
      edgeFeather: 0.04,
    },
    view: view(0, 0, 62, -32, 32, -12, 12, 44, 76),
  },
  {
    id: "scroll",
    name: "历史长卷",
    description: "超宽画面、低垂直视差",
    mode: "curvedPhoto",
    projection: {
      ...DEFAULT_ADAPTIVE_PROJECTION,
      horizontalSpan: 240,
      verticalSpan: 48,
      horizontalCurvature: 0.52,
      verticalCurvature: 0,
      edgeCompression: 0.16,
      edgeFeather: 0.06,
    },
    view: view(0, 0, 64, -104, 104, -8, 8, 46, 78),
  },
];

