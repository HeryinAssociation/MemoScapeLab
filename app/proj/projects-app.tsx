"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MODE_LABELS, type PanoramaProject } from "@/src/projects/types";
import { authenticatedFetch } from "@/src/auth/client";

type ProjectListItem = Omit<PanoramaProject, "scene"> & {
  owner?: { id: string; username: string; email: string } | null;
  canDelete?: boolean;
};
type ProjectScope = "own" | "platform";
type ProjectFilter = "all" | "published" | "draft" | "taken_down";

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function projectState(project: ProjectListItem) {
  if (project.moderationStatus === "taken_down") return { key: "taken-down", label: "已下架" };
  if (project.publicationStatus === "published") return { key: "published", label: "已发布" };
  return { key: "draft", label: "草稿" };
}

export function ProjectsApp() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [scope, setScope] = useState<ProjectScope>("own");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("正在读取项目数据库");
  const [projectToDelete, setProjectToDelete] = useState<ProjectListItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [moderatingProject, setModeratingProject] = useState<ProjectListItem | null>(null);
  const [moderationReason, setModerationReason] = useState("");
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then(async (response) => {
        const payload = (await response.json()) as {
          projects?: ProjectListItem[];
          scope?: ProjectScope;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "项目读取失败");
        if (!cancelled) {
          setProjects(payload.projects ?? []);
          setScope(payload.scope ?? "own");
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "项目读取失败");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => ({
    all: projects.length,
    published: projects.filter((project) => project.publicationStatus === "published" && project.moderationStatus !== "taken_down").length,
    draft: projects.filter((project) => project.publicationStatus === "draft" && project.moderationStatus !== "taken_down").length,
    taken_down: projects.filter((project) => project.moderationStatus === "taken_down").length,
  }), [projects]);

  const visibleProjects = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return projects.filter((project) => {
      const stateMatches = filter === "all"
        || (filter === "taken_down" && project.moderationStatus === "taken_down")
        || (filter !== "taken_down" && project.moderationStatus !== "taken_down" && project.publicationStatus === filter);
      if (!stateMatches) return false;
      if (!keyword) return true;
      return [project.title, project.location, project.notes, project.owner?.username, project.owner?.email]
        .some((value) => value?.toLocaleLowerCase("zh-CN").includes(keyword));
    });
  }, [filter, projects, search]);

  const deleteProject = async () => {
    if (!projectToDelete || deletingId) return;
    setDeletingId(projectToDelete.id);
    setActionMessage("");
    try {
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectToDelete.id)}`, { method: "DELETE" });
      const payload = (await response.json()) as { deleted?: boolean; storageCleanupPending?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? "项目删除失败");
      setProjects((current) => current.filter((item) => item.id !== projectToDelete.id));
      setActionMessage(payload.storageCleanupPending ? "项目已删除；部分图片未能清理。" : "项目已删除。");
      setProjectToDelete(null);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "项目删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const updateModeration = async (project: ProjectListItem, action: "take_down" | "restore") => {
    if (moderatingId) return;
    setModeratingId(project.id);
    setActionMessage("");
    try {
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(project.id)}/moderation`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: moderationReason }),
      });
      const payload = (await response.json()) as { project?: ProjectListItem; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error ?? "项目治理操作失败");
      setProjects((current) => current.map((item) => item.id === project.id ? payload.project! : item));
      setActionMessage(action === "take_down" ? `“${project.title}”已下架。` : `“${project.title}”已解除下架并转为草稿。`);
      setModeratingProject(null);
      setModerationReason("");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "项目治理操作失败");
    } finally {
      setModeratingId(null);
    }
  };

  const isPlatformView = scope === "platform";

  return (
    <main className="projects-page">
      <header className="admin-topbar">
        <div>
          <span className="eyebrow">PROJECT ARCHIVE / 项目档案</span>
          <h1>{isPlatformView ? "平台项目治理" : "影像项目"}</h1>
          <p>{isPlatformView ? "查看全平台项目归属、发布状态，并处理不合规内容。" : "每张照片独立保存原图、生成图、档案信息与完整投影参数。"}</p>
        </div>
        <div className="topbar-actions">
          <span className={`database-status is-${status}`}><i />{status === "ready" ? `数据库已连接 · ${projects.length} 个项目` : message}</span>
          <Link className="admin-primary-button" href="/work"><b>＋</b> 新建照片项目</Link>
        </div>
      </header>

      <section className="projects-content" aria-live="polite">
        <div className="projects-toolbar">
          <div><strong>{isPlatformView ? "全部平台项目" : "全部项目"}</strong><span>{visibleProjects.length.toString().padStart(2, "0")}</span></div>
          <p>{actionMessage || "按最近修改排序"}</p>
        </div>

        {status === "ready" && (
          <div className="project-review-controls">
            <div className="project-filter-tabs" role="group" aria-label="筛选项目状态">
              {([['all', '全部'], ['published', '已发布'], ['draft', '草稿'], ['taken_down', '已下架']] as const).map(([key, label]) => (
                <button className={filter === key ? "is-active" : ""} type="button" key={key} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>
              ))}
            </div>
            <label className="project-search"><span>搜索</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isPlatformView ? "标题、地点、用户名或邮箱" : "标题、地点或备注"} /></label>
          </div>
        )}

        {status === "loading" && <div className="project-grid" aria-label="正在加载项目">{[0, 1, 2].map((item) => <div className="project-card project-skeleton" key={item} />)}</div>}
        {status === "error" && <div className="empty-projects"><span>!</span><h2>暂时无法读取项目</h2><p>{message}</p><button type="button" onClick={() => window.location.reload()}>重新连接</button></div>}
        {status === "ready" && projects.length === 0 && <div className="empty-projects"><span>＋</span><h2>建立第一个照片项目</h2><p>上传历史原图或宽幅照片后，所有调参数据都会保存在本地数据库中。</p><Link href="/work">进入工作台</Link></div>}
        {status === "ready" && projects.length > 0 && visibleProjects.length === 0 && <div className="empty-projects"><span>⌕</span><h2>没有符合条件的项目</h2><p>尝试切换状态或清空搜索关键词。</p><button type="button" onClick={() => { setFilter("all"); setSearch(""); }}>清除筛选</button></div>}

        {status === "ready" && visibleProjects.length > 0 && (
          <div className="project-grid">
            {visibleProjects.map((project, index) => {
              const cover = project.panoramaThumbnailUrl || project.originalThumbnailUrl || project.panoramaImageUrl || project.originalImageUrl;
              const state = projectState(project);
              return (
                <article className={`project-card ${state.key === "taken-down" ? "is-taken-down" : ""}`} key={project.id}>
                  <Link className="project-card-link" href={`/work?id=${encodeURIComponent(project.id)}`}>
                    <div className="project-cover">
                      <span>NO IMAGE</span>
                      {cover && <img src={cover} alt="" loading={index < 6 ? "eager" : "lazy"} decoding="async" fetchPriority={index < 3 ? "high" : "low"} onError={(event) => { event.currentTarget.hidden = true; }} />}
                      <div className="project-cover-topline"><small>ML—{String(index + 1).padStart(3, "0")}</small><span>{MODE_LABELS[project.mode]}</span></div>
                      <div className="project-cover-footer"><span className={`project-state is-${state.key}`}><i /> {state.label}</span><b>{isPlatformView ? "审核项目 →" : "继续编辑 →"}</b></div>
                    </div>
                    <div className="project-card-copy">
                      <div className="project-card-title"><h2>{project.title}</h2><span>{formatUpdated(project.updatedAt)}</span></div>
                      {isPlatformView && project.owner && <div className="project-owner"><span>项目用户</span><strong>{project.owner.username}</strong><small>{project.owner.email}</small></div>}
                      <dl><div><dt>时间</dt><dd>{project.captureTime || "待考"}</dd></div><div><dt>地点</dt><dd>{project.location || "待标注"}</dd></div></dl>
                      <p>{project.notes || "尚未添加文字备注。"}</p>
                      {project.moderationStatus === "taken_down" && <div className="project-moderation-reason"><strong>下架原因</strong><span>{project.moderationReason || "未记录原因"}</span></div>}
                      <div className="project-techline"><span>原图 {project.originalImageUrl ? "✓" : "—"}</span><span>AIGC {project.panoramaImageUrl ? "✓" : "—"}</span><span>步骤 {project.workflowStep}/4</span></div>
                    </div>
                  </Link>
                  <div className="project-card-actions">
                    {isPlatformView && (project.moderationStatus === "taken_down"
                      ? <button className="project-restore-button" type="button" onClick={() => void updateModeration(project, "restore")}>解除下架</button>
                      : <button className="project-takedown-button" type="button" onClick={() => { setModeratingProject(project); setModerationReason(""); }}>下架</button>)}
                    {project.canDelete !== false && <button className="project-delete-button" type="button" aria-label={`删除项目：${project.title}`} onClick={() => setProjectToDelete(project)}>删除</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {moderatingProject && (
        <div className="project-delete-modal" role="presentation">
          <div className="project-delete-dialog project-moderation-dialog" role="dialog" aria-modal="true" aria-labelledby="moderate-project-title">
            <small>CONTENT MODERATION</small><h2 id="moderate-project-title">下架“{moderatingProject.title}”</h2>
            <p>项目将立即停止公开访问，关联图片转为私有；项目所有者在解除下架前无法再次发布。</p>
            <label><span>下架原因</span><textarea autoFocus maxLength={500} value={moderationReason} onChange={(event) => setModerationReason(event.target.value)} placeholder="请填写具体、可追溯的违规原因" /></label>
            <div><button type="button" disabled={Boolean(moderatingId)} onClick={() => setModeratingProject(null)}>取消</button><button className="is-danger" type="button" disabled={Boolean(moderatingId) || !moderationReason.trim()} onClick={() => void updateModeration(moderatingProject, "take_down")}>{moderatingId ? "正在下架…" : "确认下架"}</button></div>
          </div>
        </div>
      )}

      {projectToDelete && (
        <div className="project-delete-modal" role="presentation">
          <div className="project-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description">
            <small>PERMANENT DELETE</small><h2 id="delete-project-title">永久删除“{projectToDelete.title}”？</h2><p id="delete-project-description">项目档案、生成记录和关联图片会一并永久删除。此操作无法撤销。</p>
            <div><button type="button" disabled={Boolean(deletingId)} onClick={() => setProjectToDelete(null)}>取消</button><button className="is-danger" type="button" disabled={Boolean(deletingId)} onClick={() => void deleteProject()}>{deletingId ? "正在删除…" : "确认永久删除"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
