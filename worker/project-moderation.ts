import type { D1Database } from "./auth";

export type ProjectModerationAction = "take_down" | "restore";

export type ProjectModerationResult =
  | { status: "not_found" }
  | {
      status: "updated";
      moderationStatus: "clear" | "taken_down";
      moderationReason: string;
      moderatedAt: string;
    };

export class ProjectModerationInputError extends Error {}

export function normalizeModerationReason(action: ProjectModerationAction, value: unknown) {
  if (action === "restore") return "";
  const reason = String(value ?? "").trim();
  if (!reason) throw new ProjectModerationInputError("下架时必须填写原因。");
  if (reason.length > 500) throw new ProjectModerationInputError("下架原因不能超过 500 个字符。");
  return reason;
}

export async function moderateProject(
  db: D1Database,
  input: {
    projectId: string;
    adminUserId: string;
    action: ProjectModerationAction;
    reason?: unknown;
    now?: string;
  },
): Promise<ProjectModerationResult> {
  const project = await db.prepare(
    "SELECT id, title, owner_user_id, moderation_status, moderation_reason FROM projects WHERE id = ?",
  ).bind(input.projectId).first<{
    id: string;
    title: string;
    owner_user_id: string | null;
    moderation_status: "clear" | "taken_down";
    moderation_reason: string;
  }>();
  if (!project) return { status: "not_found" };

  const reason = normalizeModerationReason(input.action, input.reason);
  const now = input.now ?? new Date().toISOString();
  const moderationStatus = input.action === "take_down" ? "taken_down" : "clear";
  const auditDetails = JSON.stringify({
    projectId: project.id,
    title: project.title,
    reason,
    previousStatus: project.moderation_status,
    previousReason: project.moderation_reason,
  });

  await db.batch([
    db.prepare(`
      UPDATE projects SET
        publication_status = 'draft', moderation_status = ?, moderation_reason = ?,
        moderated_at = ?, moderated_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).bind(moderationStatus, reason, now, input.adminUserId, now, project.id),
    db.prepare(
      "UPDATE assets SET visibility = 'private', updated_at = ? WHERE project_id = ?",
    ).bind(now, project.id),
    db.prepare(`
      INSERT INTO admin_audit_logs (
        id, admin_user_id, target_user_id, action, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.adminUserId,
      project.owner_user_id,
      input.action === "take_down" ? "project.take_down" : "project.restore",
      auditDetails,
      now,
    ),
  ]);

  return { status: "updated", moderationStatus, moderationReason: reason, moderatedAt: now };
}
