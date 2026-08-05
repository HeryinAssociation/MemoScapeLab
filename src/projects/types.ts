import type { ImmersiveScene, SceneMode } from "../core/projection-types";

export type PublicationStatus = "draft" | "published";

export interface PanoramaProject {
  id: string;
  title: string;
  captureTime: string;
  location: string;
  notes: string;
  mode: SceneMode;
  originalImageUrl: string;
  originalThumbnailUrl: string;
  panoramaImageUrl: string;
  panoramaThumbnailUrl: string;
  scene: ImmersiveScene;
  workflowStep: number;
  publicationStatus: PublicationStatus;
  createdAt: string;
  updatedAt: string;
}

export type ProjectInput = Omit<PanoramaProject, "createdAt" | "updatedAt"> & {
  id?: string;
};

export const MODE_LABELS: Record<SceneMode, string> = {
  sphere360: "完整球面",
  partialSphere: "有限球面",
  curvedPhoto: "弧形照片",
  flatPhoto: "平面照片",
};
