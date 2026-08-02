import photoRecords from "../../public/images/data.json";
import type { ImmersiveScene, SceneMode } from "../core/projection-types";

interface BundledProjectSeed {
  id: string;
  title: string;
  captureTime: string;
  location: string;
  notes: string;
  originalImageUrl: string;
  panoramaImageUrl: string;
  mode: SceneMode;
  projection: NonNullable<ImmersiveScene["projection"]>;
  scene: ImmersiveScene;
}

type PhotoRecord = (typeof photoRecords)[number];

const DEFAULT_VIEW = {
  yaw: 0,
  pitch: 0,
  hfov: 72,
  minYaw: -74,
  maxYaw: 74,
  minPitch: -20,
  maxPitch: 24,
  minHfov: 52,
  maxHfov: 90,
};

const DEFAULT_PROJECTION = {
  horizontalSpan: 190,
  verticalSpan: 78,
  horizontalCurvature: 0.68,
  verticalCurvature: 0.18,
  edgeCompression: 0.12,
  centerX: 0.5,
  centerY: 0.5,
  horizonY: 0.52,
  edgeMode: "feather" as const,
  edgeFeather: 0.025,
};

function recordFor(imagePath: string): PhotoRecord {
  const record = photoRecords.find((item) => item.image_path === imagePath);
  if (!record) {
    throw new Error(`images/data.json 缺少 ${imagePath} 的元数据。`);
  }
  return record;
}

function sourceRecord(record: PhotoRecord): Record<string, unknown> {
  return structuredClone(record) as Record<string, unknown>;
}

const virtualShanghai = recordFor("images/vs_001_19327.jpg");
const laozaoShanghai = recordFor(
  "images/lz_001_521da5f3-a2d5-4931-bd38-020cbd563b6a.jpg",
);

const projectDefinitions = [
  {
    id: "bund-clocktower-1930",
    title: "上海，外白渡桥（The Garden Bridge）",
    captureTime: "1880 年",
    location: "上海 · 外白渡桥",
    notes:
      "历史原图记录外白渡桥（Garden Bridge）。布里斯托大学“中国历史照片”参考号：yo-s19。建筑档案来自 Virtual Shanghai。",
    originalImageUrl: "/images/vs_001_19327.jpg",
    panoramaImageUrl: "/images/virtual-shanghai-001.png",
    mode: "curvedPhoto" as const,
    projection: { ...DEFAULT_PROJECTION, horizontalCurvature: 0.58 },
    sourceYear: "1880",
    sourceLabel: "Virtual Shanghai / 布里斯托大学中国历史照片",
    sourceUrl:
      "building_url" in virtualShanghai
        ? String(virtualShanghai.building_url)
        : String(virtualShanghai.image_url),
    record: virtualShanghai,
  },
  {
    id: "shanghai-riverside-1948",
    title: "1991 年夏天的外滩",
    captureTime: "1991 年夏",
    location: "上海 · 黄浦区 · 外滩",
    notes:
      "1991年夏天的外滩，没有智能手机，没有网络，也没有打卡的人潮。来源：Li Ly；标签：90年代、外滩、黄浦区。",
    originalImageUrl:
      "/images/lz_001_521da5f3-a2d5-4931-bd38-020cbd563b6a.jpg",
    panoramaImageUrl: "/images/laozao-shanghai-001.png",
    mode: "partialSphere" as const,
    projection: { haov: 190, vaov: 82, vOffset: -3 },
    sourceYear: "1991 年夏",
    sourceLabel:
      "source" in laozaoShanghai ? `老照片 / ${laozaoShanghai.source}` : "老照片",
    sourceUrl: String(laozaoShanghai.image_url),
    record: laozaoShanghai,
  },
] as const;

export const BUNDLED_PROJECTS: readonly BundledProjectSeed[] =
  projectDefinitions.map((project) => {
    const scene: ImmersiveScene = {
      id: project.id,
      title: project.title,
      subtitle: project.location,
      source: project.panoramaImageUrl,
      mode: project.mode,
      projection: project.projection,
      view: { ...DEFAULT_VIEW },
      metadata: {
        sourceYear: project.sourceYear,
        sourceLabel: project.sourceLabel,
        sourceUrl: project.sourceUrl,
        originalImageUrl: project.originalImageUrl,
        sourceRecord: sourceRecord(project.record),
        aiExpanded: true,
        disclaimer: "扩展区域由 AI 辅助生成，仅用于沉浸式历史场景展示。",
      },
    };

    return {
      id: project.id,
      title: project.title,
      captureTime: project.captureTime,
      location: project.location,
      notes: project.notes,
      originalImageUrl: project.originalImageUrl,
      panoramaImageUrl: project.panoramaImageUrl,
      mode: project.mode,
      projection: project.projection,
      scene,
    };
  });
