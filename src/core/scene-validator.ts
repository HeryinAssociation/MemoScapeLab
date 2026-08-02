import type {
  AdaptiveProjectionConfig,
  EdgeMode,
  ImmersiveScene,
  PartialSphereProjectionConfig,
  ProjectionConfig,
  SceneHotspot,
  SceneMetadata,
  SceneMode,
  ViewConfig,
} from "./projection-types";

export class SceneValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`场景配置无效：${issues.join("；")}`);
    this.name = "SceneValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  options?: { optional?: false },
): string;
function readString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  options: { optional: true },
): string | undefined;
function readString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  options: { optional?: boolean } = {},
) {
  const value = record[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${key} 必须是非空字符串`);
    return "";
  }
  return value;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push(`${key} 必须是布尔值`);
    return undefined;
  }
  return value;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  min: number,
  max: number,
) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${key} 必须是有效数字`);
    return min;
  }
  if (value < min || value > max) {
    issues.push(`${key} 必须位于 ${min}—${max} 之间`);
  }
  return value;
}

function parseView(value: unknown, issues: string[]): ViewConfig {
  if (!isRecord(value)) {
    issues.push("view 必须是对象");
    value = {};
  }
  const record = value as Record<string, unknown>;
  const view = {
    yaw: readNumber(record, "yaw", issues, -180, 180),
    pitch: readNumber(record, "pitch", issues, -90, 90),
    hfov: readNumber(record, "hfov", issues, 20, 140),
    minYaw: readNumber(record, "minYaw", issues, -180, 180),
    maxYaw: readNumber(record, "maxYaw", issues, -180, 180),
    minPitch: readNumber(record, "minPitch", issues, -90, 90),
    maxPitch: readNumber(record, "maxPitch", issues, -90, 90),
    minHfov: readNumber(record, "minHfov", issues, 20, 140),
    maxHfov: readNumber(record, "maxHfov", issues, 20, 140),
  };

  if (view.minYaw >= view.maxYaw) issues.push("minYaw 必须小于 maxYaw");
  if (view.minPitch >= view.maxPitch)
    issues.push("minPitch 必须小于 maxPitch");
  if (view.minHfov >= view.maxHfov)
    issues.push("minHfov 必须小于 maxHfov");
  if (view.yaw < view.minYaw || view.yaw > view.maxYaw)
    issues.push("默认 yaw 必须位于 yaw 边界内");
  if (view.pitch < view.minPitch || view.pitch > view.maxPitch)
    issues.push("默认 pitch 必须位于 pitch 边界内");
  if (view.hfov < view.minHfov || view.hfov > view.maxHfov)
    issues.push("默认 hfov 必须位于 hfov 边界内");

  return view;
}

function parsePartialProjection(
  value: unknown,
  issues: string[],
): PartialSphereProjectionConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push("projection 必须是对象");
    return undefined;
  }
  return {
    haov: readNumber(value, "haov", issues, 1, 360),
    vaov: readNumber(value, "vaov", issues, 1, 180),
    vOffset: readNumber(value, "vOffset", issues, -90, 90),
  };
}

const EDGE_MODES: EdgeMode[] = [
  "wrap",
  "clamp",
  "feather",
  "mirror",
  "background",
];

function parseAdaptiveProjection(
  value: unknown,
  issues: string[],
): AdaptiveProjectionConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push("projection 必须是对象");
    return undefined;
  }
  const edgeMode = readString(value, "edgeMode", issues) as EdgeMode;
  if (!EDGE_MODES.includes(edgeMode)) {
    issues.push(`edgeMode “${edgeMode}” 不受支持`);
  }
  return {
    horizontalSpan: readNumber(
      value,
      "horizontalSpan",
      issues,
      60,
      360,
    ),
    verticalSpan: readNumber(value, "verticalSpan", issues, 30, 180),
    horizontalCurvature: readNumber(
      value,
      "horizontalCurvature",
      issues,
      0,
      1,
    ),
    verticalCurvature: readNumber(
      value,
      "verticalCurvature",
      issues,
      0,
      1,
    ),
    edgeCompression: readNumber(
      value,
      "edgeCompression",
      issues,
      0,
      0.4,
    ),
    centerX: readNumber(value, "centerX", issues, 0, 1),
    centerY: readNumber(value, "centerY", issues, 0, 1),
    horizonY: readNumber(value, "horizonY", issues, 0, 1),
    edgeMode,
    edgeFeather: readNumber(value, "edgeFeather", issues, 0, 0.2),
  };
}

function parseHotspots(value: unknown, issues: string[]) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push("hotspots 必须是数组");
    return undefined;
  }
  return value.map((item, index): SceneHotspot => {
    const path = `hotspots[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} 必须是对象`);
      item = {};
    }
    const type = readString(item, "type", issues);
    if (type !== "info") issues.push(`${path}.type 当前仅支持 info`);
    return {
      id: readString(item, "id", issues),
      type: "info",
      text: readString(item, "text", issues),
      yaw: readNumber(item, "yaw", issues, -180, 180),
      pitch: readNumber(item, "pitch", issues, -90, 90),
    };
  });
}

function parseMetadata(value: unknown, issues: string[]) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push("metadata 必须是对象");
    return undefined;
  }
  const sourceRecord = value.sourceRecord;
  if (sourceRecord !== undefined && !isRecord(sourceRecord)) {
    issues.push("sourceRecord 必须是对象");
  }
  return {
    sourceYear: readString(value, "sourceYear", issues, { optional: true }),
    sourceLabel: readString(value, "sourceLabel", issues, { optional: true }),
    sourceUrl: readString(value, "sourceUrl", issues, { optional: true }),
    originalImageUrl: readString(value, "originalImageUrl", issues, {
      optional: true,
    }),
    sourceRecord: isRecord(sourceRecord) ? sourceRecord : undefined,
    aiColorized: readBoolean(value, "aiColorized", issues),
    aiExpanded: readBoolean(value, "aiExpanded", issues),
    disclaimer: readString(value, "disclaimer", issues, { optional: true }),
  } satisfies SceneMetadata;
}

export function validateScene(value: unknown): ImmersiveScene {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new SceneValidationError(["根节点必须是对象"]);
  }

  const mode = readString(value, "mode", issues) as SceneMode;
  if (
    !["sphere360", "partialSphere", "curvedPhoto", "flatPhoto"].includes(mode)
  ) {
    issues.push(`mode “${mode}” 不受支持`);
  }

  let projection: ProjectionConfig | undefined;
  if (mode === "partialSphere") {
    projection = parsePartialProjection(value.projection, issues);
  } else if (mode === "curvedPhoto" || mode === "flatPhoto") {
    projection = parseAdaptiveProjection(value.projection, issues);
  }
  if (mode === "partialSphere" && !projection) {
    issues.push("partialSphere 必须提供 projection");
  }
  if ((mode === "curvedPhoto" || mode === "flatPhoto") && !projection) {
    issues.push(`${mode} 必须提供 adaptive projection`);
  }

  const source = readString(value, "source", issues);
  if (source && !source.startsWith("/") && !source.startsWith("https://")) {
    issues.push("source 必须是站内绝对路径或 HTTPS 地址");
  }

  const scene: ImmersiveScene = {
    id: readString(value, "id", issues),
    title: readString(value, "title", issues),
    subtitle: readString(value, "subtitle", issues, { optional: true }),
    source,
    thumbnail: readString(value, "thumbnail", issues, { optional: true }),
    mode,
    projection,
    view: parseView(value.view, issues),
    hotspots: parseHotspots(value.hotspots, issues),
    metadata: parseMetadata(value.metadata, issues),
  };

  if (issues.length > 0) throw new SceneValidationError(issues);
  return scene;
}
