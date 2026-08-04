"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { renderScene, type RenderHandle } from "@/src/core/render-router";
import {
  isAdaptiveProjection,
  isPartialSphereProjection,
  type ImmersiveScene,
} from "@/src/core/projection-types";
import { MODE_LABELS, type PanoramaProject } from "@/src/projects/types";

type LoadState = "loading" | "ready" | "error";

function horizontalSpan(scene: ImmersiveScene) {
  if (isPartialSphereProjection(scene.projection)) return scene.projection.haov;
  if (isAdaptiveProjection(scene.projection)) return scene.projection.horizontalSpan;
  return 360;
}

function verticalSpan(scene: ImmersiveScene) {
  if (isPartialSphereProjection(scene.projection)) return scene.projection.vaov;
  if (isAdaptiveProjection(scene.projection)) return scene.projection.verticalSpan;
  return 180;
}

export function ViewerApp({
  projectId,
  embedded = false,
}: {
  projectId?: string;
  embedded?: boolean;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renderHandleRef = useRef<RenderHandle | null>(null);
  const [project, setProject] = useState<PanoramaProject | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("正在同步项目参数");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const endpoint = projectId
      ? `/api/projects/${encodeURIComponent(projectId)}`
      : "/api/projects";

    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          project?: PanoramaProject;
          projects?: PanoramaProject[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "项目参数读取失败");
        const selected = payload.project ?? payload.projects?.[0];
        if (!selected) throw new Error("项目数据库中还没有可预览的照片。");
        setProject(selected);
        setMessage("正在建立项目预览");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
        setMessage(error instanceof Error ? error.message : "项目参数读取失败");
      });

    return () => controller.abort();
  }, [projectId, reloadKey]);

  const scene = project?.scene ?? null;

  useEffect(() => {
    const target = viewerRef.current;
    if (!target || !scene) return;
    let cancelled = false;
    renderHandleRef.current?.destroy();
    renderHandleRef.current = null;

    renderScene(target, scene)
      .then((handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        renderHandleRef.current = handle;
        setLoadState("ready");
        setMessage("已同步数据库中的最新参数");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState("error");
        setMessage(error instanceof Error ? error.message : "项目预览启动失败");
      });

    return () => {
      cancelled = true;
      renderHandleRef.current?.destroy();
      renderHandleRef.current = null;
    };
  }, [scene]);

  const retry = () => {
    setProject(null);
    setLoadState("loading");
    setMessage("正在重新同步项目参数");
    setReloadKey((current) => current + 1);
  };

  return (
    <main className={`project-viewer ${embedded ? "is-embedded" : ""}`}>
      {!embedded && <header className="project-viewer-bar">
        <div>
          <span className="viewer-brand-mark">ML</span>
          <span>
            <small>{embedded ? "PUBLISH PREVIEW" : "PROJECT VIEWER"}</small>
            <strong>{project?.title ?? "正在读取项目"}</strong>
          </span>
        </div>
        <div>
          <span className={`viewer-sync-state is-${loadState}`}><i />{message}</span>
          {!embedded && project && (
            <Link href={`/work?id=${encodeURIComponent(project.id)}`}>返回工作台</Link>
          )}
        </div>
      </header>}

      <section className="project-viewer-frame">
        <div ref={viewerRef} className="project-viewer-canvas" />

        {!embedded && <div className="project-viewer-topline">
          <span>ARCHIVE / {project?.id ?? "SYNCING"}</span>
          {project && <b>{MODE_LABELS[project.mode]}</b>}
        </div>}

        {loadState !== "ready" && (
          <div className={`project-viewer-message ${loadState === "error" ? "is-error" : ""}`} role={loadState === "error" ? "alert" : "status"}>
            <span>{loadState === "error" ? "SYNC ERROR" : "DATABASE SYNC"}</span>
            <strong>{message}</strong>
            {loadState === "error" && <button type="button" onClick={retry}>重新同步</button>}
          </div>
        )}

        {!embedded && project && scene && (
          <div className={`project-viewer-caption ${detailsOpen ? "is-open" : ""}`}>
            <div className="project-viewer-caption-main">
              <span>{project.captureTime || scene.metadata?.sourceYear || "年代待考"}</span>
              <div>
                <h1>{project.title}</h1>
                <p>{project.location || scene.subtitle || "地点待标注"}</p>
              </div>
              <button type="button" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>
                {detailsOpen ? "收起参数" : "查看参数"}
              </button>
            </div>
            <div className="project-viewer-details">
              <dl>
                <div><dt>投影方式</dt><dd>{MODE_LABELS[scene.mode]}</dd></div>
                <div><dt>覆盖范围</dt><dd>{horizontalSpan(scene)}° × {verticalSpan(scene)}°</dd></div>
                <div><dt>默认视场</dt><dd>{scene.view.hfov}°</dd></div>
                <div><dt>水平边界</dt><dd>{scene.view.minYaw}° — {scene.view.maxYaw}°</dd></div>
              </dl>
              <p>{project.notes || scene.metadata?.disclaimer || "暂无项目备注。"}</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
