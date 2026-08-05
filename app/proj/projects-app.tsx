"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MODE_LABELS, type PanoramaProject } from "@/src/projects/types";

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

export function ProjectsApp() {
  const [projects, setProjects] = useState<PanoramaProject[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("正在读取项目数据库");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then(async (response) => {
        const payload = (await response.json()) as {
          projects?: PanoramaProject[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "项目读取失败");
        if (!cancelled) {
          setProjects(payload.projects ?? []);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "项目读取失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="projects-page">
      <header className="admin-topbar">
        <div>
          <span className="eyebrow">PROJECT ARCHIVE / 项目档案</span>
          <h1>影像项目</h1>
          <p>每张照片独立保存原图、生成图、档案信息与完整投影参数。</p>
        </div>
        <div className="topbar-actions">
          <span className={`database-status is-${status}`}>
            <i />
            {status === "ready" ? `数据库已连接 · ${projects.length} 个项目` : message}
          </span>
          <Link className="admin-primary-button" href="/work">
            <b>＋</b> 新建照片项目
          </Link>
        </div>
      </header>

      <section className="projects-content" aria-live="polite">
        <div className="projects-toolbar">
          <div>
            <strong>全部项目</strong>
            <span>{projects.length.toString().padStart(2, "0")}</span>
          </div>
          <p>按最近修改排序</p>
        </div>

        {status === "loading" && (
          <div className="project-grid" aria-label="正在加载项目">
            {[0, 1, 2].map((item) => (
              <div className="project-card project-skeleton" key={item} />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="empty-projects">
            <span>!</span>
            <h2>暂时无法读取项目</h2>
            <p>{message}</p>
            <button type="button" onClick={() => window.location.reload()}>
              重新连接
            </button>
          </div>
        )}

        {status === "ready" && projects.length === 0 && (
          <div className="empty-projects">
            <span>＋</span>
            <h2>建立第一个照片项目</h2>
            <p>上传历史原图或宽幅照片后，所有调参数据都会保存在本地数据库中。</p>
            <Link href="/work">进入工作台</Link>
          </div>
        )}

        {status === "ready" && projects.length > 0 && (
          <div className="project-grid">
            {projects.map((project, index) => {
              const cover = project.panoramaThumbnailUrl || project.originalThumbnailUrl || project.panoramaImageUrl || project.originalImageUrl;
              return (
                <Link className="project-card" href={`/work?id=${encodeURIComponent(project.id)}`} key={project.id}>
                  <div
                    className="project-cover"
                    style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
                  >
                    {!cover && <span>NO IMAGE</span>}
                    <div className="project-cover-topline">
                      <small>ML—{String(index + 1).padStart(3, "0")}</small>
                      <span>{MODE_LABELS[project.mode]}</span>
                    </div>
                    <div className="project-cover-footer">
                      <span className="project-state"><i /> 草稿</span>
                      <b>继续编辑 →</b>
                    </div>
                  </div>
                  <div className="project-card-copy">
                    <div className="project-card-title">
                      <h2>{project.title}</h2>
                      <span>{formatUpdated(project.updatedAt)}</span>
                    </div>
                    <dl>
                      <div><dt>时间</dt><dd>{project.captureTime || "待考"}</dd></div>
                      <div><dt>地点</dt><dd>{project.location || "待标注"}</dd></div>
                    </dl>
                    <p>{project.notes || "尚未添加文字备注。"}</p>
                    <div className="project-techline">
                      <span>原图 {project.originalImageUrl ? "✓" : "—"}</span>
                      <span>AIGC {project.panoramaImageUrl ? "✓" : "—"}</span>
                      <span>步骤 {project.workflowStep}/4</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
