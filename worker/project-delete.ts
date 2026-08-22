import type { D1Database, R2Bucket } from "./auth";
import {
  createLightCosPresignedUrl,
  lightCosConfigFromEnv,
  lightCosRequestUrl,
  type LightCosBindings,
} from "./lightcos";

interface ProjectDeleteEnv extends LightCosBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
}

interface ProjectAsset {
  bucket: string;
  object_key: string;
}

export type DeleteOwnedProjectResult =
  | { status: "not_found" }
  | { status: "busy" }
  | { status: "deleted"; storageCleanupPending: boolean };

async function deleteLightCosAssets(env: ProjectDeleteEnv, assets: ProjectAsset[]) {
  if (!assets.length) return 0;
  const config = lightCosConfigFromEnv(env);
  if (!config) return assets.length;

  const results = await Promise.allSettled(assets.map(async (asset) => {
    const deleteUrl = await createLightCosPresignedUrl({
      config,
      method: "DELETE",
      bucket: asset.bucket,
      key: asset.object_key,
      expiresInSeconds: 5 * 60,
    });
    const response = await fetch(lightCosRequestUrl(config, deleteUrl), { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`LightCOS 删除失败（HTTP ${response.status}）`);
    }
  }));

  return results.filter((result) => result.status === "rejected").length;
}

async function deleteProjectR2Objects(env: ProjectDeleteEnv, ownerUserId: string, projectId: string) {
  let cursor: string | undefined;
  do {
    const result = await env.MEDIA.list({
      prefix: `users/${ownerUserId}/projects/${projectId}/`,
      ...(cursor ? { cursor } : {}),
    });
    const keys = result.objects.map((item) => item.key);
    if (keys.length) await env.MEDIA.delete(keys);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}

/**
 * Permanently deletes one project owned by the current user.
 * Database visibility is removed atomically before best-effort object-storage cleanup.
 */
export async function deleteOwnedProject(
  env: ProjectDeleteEnv,
  projectId: string,
  ownerUserId: string,
): Promise<DeleteOwnedProjectResult> {
  const project = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND owner_user_id = ?",
  ).bind(projectId, ownerUserId).first<{ id: string }>();
  if (!project) return { status: "not_found" };

  const activeTask = await env.DB.prepare(`
    SELECT id FROM image_gen_tasks
    WHERE project_id = ? AND owner_user_id = ? AND status IN ('pending', 'running')
    LIMIT 1
  `).bind(projectId, ownerUserId).first<{ id: string }>();
  if (activeTask) return { status: "busy" };

  const assets = await env.DB.prepare(`
    SELECT bucket, object_key FROM assets
    WHERE project_id = ? AND owner_user_id = ? AND storage_provider = 'lightcos'
  `).bind(projectId, ownerUserId).all<ProjectAsset>();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM image_gen_tasks WHERE project_id = ? AND owner_user_id = ?")
      .bind(projectId, ownerUserId),
    env.DB.prepare("DELETE FROM assets WHERE project_id = ? AND owner_user_id = ?")
      .bind(projectId, ownerUserId),
    env.DB.prepare("DELETE FROM projects WHERE id = ? AND owner_user_id = ?")
      .bind(projectId, ownerUserId),
  ]);

  let cleanupFailures = await deleteLightCosAssets(env, assets.results);
  try {
    await deleteProjectR2Objects(env, ownerUserId, projectId);
  } catch {
    cleanupFailures += 1;
  }

  return {
    status: "deleted",
    storageCleanupPending: cleanupFailures > 0,
  };
}
