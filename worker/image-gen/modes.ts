export type ImageGenerationMode =
  | "historical_only"
  | "historical_with_present_panorama";

export const RECOMMENDED_IMAGE_GENERATION_MODE: ImageGenerationMode =
  "historical_with_present_panorama";

const HISTORICAL_ONLY_PROMPT =
  "将参考历史照片扩展为一张完整、连续、可沉浸浏览的 2:1 等距柱状全景图。保持历史照片中可见的建筑、道路、人物、植被与光线风格一致，向四周合理补全同一年代的环境。输出必须首尾无缝、地平线连续、透视稳定，不得复制地标或生成突兀接缝。";

const CONSTRAINED_PROMPT =
  "生成一张目标历史时期场景的完整 2:1 等距柱状全景图。第一张参考图是现实全景，只用于锁定道路、桥梁、水岸、建筑轮廓、地平线、相机位置和 360 度空间连续性；第二张参考图是历史照片，用于确定年代、建筑立面、材料、街道设施、人物服饰、交通工具与影调。移除现实全景中的现代车辆、标识、护栏、路灯、广告、空调与新增建筑，以符合史料的同期景物替换。保留可信且稳定的关键地理信息。严格避免无依据增加电线杆或重复街具；桥面和道路中央不得出现马路牙子、隔离带或不合逻辑的障碍；道路边界、桥梁结构与行车空间必须连续合理。输出首尾无缝、地平线连续、比例统一、无拼接断裂、无重复建筑，并保持全景各方向内容和光照一致。";

export function normalizeImageGenerationMode(value: unknown): ImageGenerationMode {
  return value === "historical_only"
    ? "historical_only"
    : RECOMMENDED_IMAGE_GENERATION_MODE;
}

export function defaultPromptForMode(mode: ImageGenerationMode, historicalPeriod = "") {
  const prompt = mode === "historical_with_present_panorama"
    ? CONSTRAINED_PROMPT
    : HISTORICAL_ONLY_PROMPT;
  const period = historicalPeriod.trim();
  return period ? `目标历史时期：${period}。${prompt}` : prompt;
}

export function referencePathsForMode(
  project: { originalImageUrl: string; referencePanoramaImageUrl: string },
  mode: ImageGenerationMode,
) {
  if (mode === "historical_with_present_panorama") {
    return [project.referencePanoramaImageUrl, project.originalImageUrl].filter(Boolean);
  }
  return [project.originalImageUrl].filter(Boolean);
}
