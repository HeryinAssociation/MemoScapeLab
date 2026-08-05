"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { EditorApp, INITIAL_SCENE } from "../editor-app";
import { ViewerApp } from "../viewer-app";
import {
  isAdaptiveProjection,
  isPartialSphereProjection,
  type ImmersiveScene,
} from "@/src/core/projection-types";
import { MODE_LABELS, type PanoramaProject } from "@/src/projects/types";
import { authenticatedFetch } from "@/src/auth/client";
import { createWebpThumbnail } from "@/src/images/client-thumbnail";
import type { ImageGenProviderName } from "@/worker/image-gen/types";

type LoadState = "loading" | "ready" | "error";
type GenStatus = "idle" | "running" | "succeeded" | "failed";
type UploadKind = "original" | "panorama";
type StoredAssetKind = UploadKind | "thumbnail";

interface UploadedAsset {
  id: string;
  url: string;
}

const WORKFLOW_STEPS = [
  { n: 1, label: "上传照片" },
  { n: 2, label: "生成全景" },
  { n: 3, label: "投影调参" },
  { n: 4, label: "发布" },
] as const;

const UPLOAD_LIMITS: Record<UploadKind, number> = {
  original: 10 * 1024 * 1024,
  panorama: 50 * 1024 * 1024,
};

const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function WorkbenchApp({ projectId }: { projectId?: string }) {
  const [project, setProject] = useState<PanoramaProject | null>(null);
  // 新建项目（无 id）时服务端即可渲染步骤 1；带 id 时才需要先加载数据库
  const [loadState, setLoadState] = useState<LoadState>(projectId ? "loading" : "ready");
  const [message, setMessage] = useState(
    projectId ? "正在读取项目" : "新建项目：请先上传原图",
  );
  const [step, setStep] = useState(1);

  const [title, setTitle] = useState("");
  const [captureTime, setCaptureTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [genError, setGenError] = useState("");
  const [genProvider, setGenProvider] = useState<ImageGenProviderName | "">("");
  const pollTimerRef = useRef<number | null>(null);
  const [uploading, setUploading] = useState<UploadKind | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (projectId) {
      fetch(`/api/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as { project?: PanoramaProject; error?: string };
          if (!response.ok) throw new Error(payload.error ?? "项目读取失败");
          const loaded = payload.project!;
          setProject(loaded);
          setTitle(loaded.title);
          setCaptureTime(loaded.captureTime);
          setLocation(loaded.location);
          setNotes(loaded.notes);
          setStep(Math.min(4, Math.max(1, loaded.workflowStep)));
          setLoadState("ready");
          setMessage("项目已载入");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLoadState("error");
          setMessage(error instanceof Error ? error.message : "项目读取失败");
        });
    }
    return () => controller.abort();
  }, [projectId]);

  useEffect(
    () => () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    },
    [],
  );

  /** 创建或更新项目行，返回最新项目。 */
  const saveProject = async (options: {
    title?: string;
    originalImageUrl?: string;
    originalThumbnailUrl?: string;
    panoramaImageUrl?: string;
    panoramaThumbnailUrl?: string;
    scene?: ImmersiveScene;
    workflowStep?: number;
  }) => {
    const scene = options.scene ?? project?.scene ?? INITIAL_SCENE;
    const body = {
      title: (options.title ?? title) || "未命名项目",
      captureTime,
      location,
      notes,
      mode: project?.mode ?? "curvedPhoto",
      originalImageUrl: options.originalImageUrl ?? project?.originalImageUrl ?? "",
      originalThumbnailUrl: options.originalThumbnailUrl ?? project?.originalThumbnailUrl ?? "",
      panoramaImageUrl: options.panoramaImageUrl ?? project?.panoramaImageUrl ?? "",
      panoramaThumbnailUrl: options.panoramaThumbnailUrl ?? project?.panoramaThumbnailUrl ?? "",
      scene,
      workflowStep: options.workflowStep ?? step,
      publicationStatus: project?.publicationStatus ?? "draft",
    };
    const response = project
      ? await authenticatedFetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      : await authenticatedFetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
    const payload = (await response.json()) as { project?: PanoramaProject; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "项目保存失败");
    setProject(payload.project!);
    return payload.project!;
  };

  const uploadAsset = async (
    file: File,
    kind: StoredAssetKind,
    parentAssetId?: string,
  ): Promise<UploadedAsset> => {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      throw new Error("仅支持 JPG/JPEG、PNG 和 WebP 图片。");
    }
    if (kind !== "thumbnail" && file.size > UPLOAD_LIMITS[kind]) {
      const label = kind === "original" ? "历史原图" : "宽幅 / 全景照片";
      throw new Error(`${label}不能超过 ${UPLOAD_LIMITS[kind] / 1024 / 1024} MB。`);
    }
    if (kind === "thumbnail" && (file.type !== "image/webp" || file.size > 5 * 1024 * 1024)) {
      throw new Error("缩略图必须为不超过 5 MB 的 WebP 图片。");
    }

    const intentResponse = await authenticatedFetch("/api/assets/upload-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        filename: file.name,
        contentType: file.type,
        size: file.size,
        projectId: project?.id,
        parentAssetId,
      }),
    });
    const intent = (await intentResponse.json()) as { assetId?: string; uploadUrl?: string; error?: string };
    if (!intentResponse.ok || !intent.assetId || !intent.uploadUrl) {
      throw new Error(intent.error ?? "无法创建 LightCOS 上传任务");
    }

    const uploadResponse = await authenticatedFetch(intent.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    const uploaded = (await uploadResponse.json()) as {
      asset?: { url?: string };
      error?: string;
    };
    if (!uploadResponse.ok || !uploaded.asset?.url) {
      throw new Error(uploaded.error ?? "LightCOS 上传失败");
    }
    return { id: intent.assetId, url: uploaded.asset.url };
  };

  const uploadImagePair = async (file: File, kind: UploadKind) => {
    setMessage(`正在生成 ${kind === "original" ? "历史原图" : "全景图"} WebP 缩略图`);
    const thumbnail = await createWebpThumbnail(file, file.name, {
      maxWidth: 1600,
      maxHeight: 900,
      quality: 0.82,
    });
    const sourceAsset = await uploadAsset(file, kind);
    const thumbnailAsset = await uploadAsset(thumbnail, "thumbnail", sourceAsset.id);
    return { source: sourceAsset, thumbnail: thumbnailAsset };
  };

  const uploadSource = async (kind: UploadKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(kind);
    try {
      const label = kind === "original" ? "历史原图" : "宽幅 / 全景照片";
      setMessage(`正在上传${label}：${file.name}`);
      const pair = await uploadImagePair(file, kind);
      const url = pair.source.url;
      const thumbnailUrl = pair.thumbnail.url;
      const nextTitle = title || file.name.replace(/\.[^.]+$/, "");
      if (!title) setTitle(nextTitle);
      const currentScene = project?.scene ?? INITIAL_SCENE;
      const scene = kind === "panorama" || !project
        ? { ...currentScene, title: nextTitle, source: url, thumbnail: thumbnailUrl }
        : currentScene;
      await saveProject({
        title: nextTitle,
        originalImageUrl: kind === "original" ? url : undefined,
        originalThumbnailUrl: kind === "original" ? thumbnailUrl : undefined,
        panoramaImageUrl: kind === "panorama" ? url : undefined,
        panoramaThumbnailUrl: kind === "panorama" ? thumbnailUrl : undefined,
        scene,
        workflowStep: project?.workflowStep ?? 1,
      });
      setMessage(`${label}已存入 LightCOS`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(null);
    }
  };

  const storeGeneratedPanorama = async (sourceUrl: string, taskId: string) => {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error("无法读取刚生成的全景图。");
    const blob = await response.blob();
    const contentType = ALLOWED_UPLOAD_TYPES.has(blob.type) ? blob.type : "image/png";
    const extension = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
    const file = new File([blob], `aigc-${taskId}.${extension}`, { type: contentType });
    const pair = await uploadImagePair(file, "panorama");
    const currentScene = project?.scene ?? INITIAL_SCENE;
    await saveProject({
      panoramaImageUrl: pair.source.url,
      panoramaThumbnailUrl: pair.thumbnail.url,
      scene: {
        ...currentScene,
        source: pair.source.url,
        thumbnail: pair.thumbnail.url,
        metadata: { ...currentScene.metadata, aiExpanded: true },
      },
      workflowStep: 2,
    });
  };

  const startGenerate = async () => {
    if (!project) return;
    setGenStatus("running");
    setGenError("");
    try {
      const body: Record<string, unknown> = { projectId: project.id };
      if (genProvider) body.provider = genProvider;
      const response = await authenticatedFetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "生成任务提交失败");
      pollTask(payload.taskId!);
    } catch (error) {
      setGenStatus("failed");
      setGenError(error instanceof Error ? error.message : "生成任务提交失败");
    }
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const pollTask = (taskId: string) => {
    stopPolling();
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const response = await authenticatedFetch(`/api/generate/${encodeURIComponent(taskId)}`);
        const payload = (await response.json()) as {
          status?: string;
          error?: string;
          images?: Array<{ key: string; url: string }>;
        };
        if (!response.ok) throw new Error(payload.error ?? "任务查询失败");
        if (payload.status === "succeeded") {
          stopPolling();
          const generatedUrl = payload.images?.[0]?.url;
          if (!generatedUrl) throw new Error("生成任务没有返回全景图片。");
          setMessage("正在生成缩略图并保存全景文件");
          await storeGeneratedPanorama(generatedUrl, taskId);
          setGenStatus("succeeded");
          setMessage("全景图与 WebP 缩略图已保存");
        } else if (payload.status === "failed") {
          stopPolling();
          setGenStatus("failed");
          setGenError(payload.error ?? "全景生成失败");
          setMessage("全景生成失败");
        }
        // pending / running → 继续轮询
      } catch (error) {
        stopPolling();
        setGenStatus("failed");
        setGenError(error instanceof Error ? error.message : "任务查询失败");
        setMessage("任务查询失败");
      }
    }, 3000);
  };

  const saveScene = async (scene: ImmersiveScene) => {
    await saveProject({ scene, workflowStep: 3 });
    setMessage("投影参数已保存到数据库");
  };

  const cover = project?.panoramaThumbnailUrl || project?.originalThumbnailUrl || project?.panoramaImageUrl || project?.originalImageUrl;

  return (
    <main className="workbench-page">
      <header className="workbench-topbar">
        <div className="workbench-title">
          <Link href="/proj">← 返回项目库</Link>
          <span />
          <span>
            <small>MEMOSCAPELAB / WORKBENCH</small>
            <strong>{title || project?.title || "新建照片项目"}</strong>
          </span>
        </div>
        <div className="workbench-save-state">
          <span><i />{message}</span>
          <b>{project ? project.id.slice(0, 8) : "DRAFT"}</b>
        </div>
      </header>

      <nav className="workflow-steps" aria-label="工作流步骤">
        {WORKFLOW_STEPS.map((item) => (
          <button
            type="button"
            key={item.n}
            className={[
              step === item.n ? "is-active" : "",
              step > item.n ? "is-complete" : "",
            ].join(" ")}
            disabled={loadState === "loading"}
            onClick={() => setStep(item.n)}
          >
            <span className="workflow-step-index">{step > item.n ? "✓" : String(item.n).padStart(2, "0")}</span>
            <span className="workflow-step-copy">
              <small>STEP {String(item.n).padStart(2, "0")}</small>
              <strong>{item.label}</strong>
            </span>
            {step > item.n && <em>完成</em>}
          </button>
        ))}
      </nav>

      <section className="workflow-stage">
        {loadState === "loading" && (
          <div className="workbench-loading">
            <span className="loading-orbit" />
            <strong>正在读取项目</strong>
            <small>DATABASE SYNC</small>
          </div>
        )}

        {loadState === "error" && (
          <div className="workbench-loading">
            <span className="error-orbit">!</span>
            <strong>项目读取失败</strong>
            <small>{message}</small>
            <Link href="/proj">返回项目库</Link>
          </div>
        )}

        {loadState === "ready" && step === 1 && (
          <div className="source-step">
            <div className="step-intro">
              <span>STEP 01 / 影像来源</span>
              <h1>上传照片</h1>
              <p>上传历史原图或宽幅照片；浏览器会在上传前同步生成 WebP 缩略图。保存后即可进入全景生成。</p>
            </div>
            <div className="source-layout">
              <div className="source-uploads">
                <label className={`source-upload-card ${project?.originalImageUrl ? "has-image" : ""}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    disabled={uploading !== null}
                    onChange={(event) => void uploadSource("original", event)}
                  />
                  {project?.originalImageUrl && (
                    <span
                      className="source-upload-preview"
                      style={{ backgroundImage: `url("${project.originalThumbnailUrl || project.originalImageUrl}")` }}
                    />
                  )}
                  <span className="source-upload-icon">{uploading === "original" ? "···" : "＋"}</span>
                  <strong>
                    {uploading === "original"
                      ? "正在上传 LightCOS"
                      : project?.originalImageUrl
                        ? "重新上传原图"
                        : "选择历史原图"}
                  </strong>
                  <small>未经扩展的老照片、档案扫描图</small>
                  <em>原文件 + WEBP 缩略图 · 最大 10 MB</em>
                </label>
                <span className="upload-flow-arrow">→</span>
                <label className={`source-upload-card ${project?.panoramaImageUrl ? "has-image" : ""}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    disabled={uploading !== null}
                    onChange={(event) => void uploadSource("panorama", event)}
                  />
                  {project?.panoramaImageUrl && (
                    <span className="source-upload-preview" style={{ backgroundImage: `url("${cover}")` }} />
                  )}
                  <span className="source-upload-icon">{uploading === "panorama" ? "···" : "▦"}</span>
                  <strong>
                    {uploading === "panorama"
                      ? "正在上传 LightCOS"
                      : project?.panoramaImageUrl
                        ? "更换宽幅 / 全景照片"
                        : "上传宽幅 / 全景照片"}
                  </strong>
                  <small>已有的 AIGC 全景或其他宽幅照片（可选）</small>
                  <em>原文件 + WEBP 缩略图 · 最大 50 MB</em>
                </label>
              </div>

              <div className="metadata-card">
                <div className="metadata-heading">
                  <span>
                    <small>ARCHIVE NOTES</small>
                    <h2>影像元数据</h2>
                  </span>
                  <span>#{project ? "SAVED" : "NEW"}</span>
                </div>
                <label>
                  <span>项目标题</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="如：1991 年外滩" />
                </label>
                <div className="metadata-row">
                  <label>
                    <span>拍摄时间</span>
                    <input value={captureTime} onChange={(event) => setCaptureTime(event.target.value)} placeholder="如：1991 年" />
                  </label>
                  <label>
                    <span>地点</span>
                    <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="如：上海外滩" />
                  </label>
                </div>
                <label>
                  <span>项目备注</span>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="来源、版权与修复说明" />
                </label>
                <div className="metadata-action-row">
                  <small>{cover ? "照片已保存" : "尚未上传照片"}</small>
                  <button
                    type="button"
                    disabled={!cover || uploading !== null}
                    onClick={async () => {
                      try {
                        await saveProject({ workflowStep: 2 });
                        setStep(2);
                        setMessage("可以开始生成全景");
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "保存失败");
                      }
                    }}
                  >
                    保存并继续<span>→</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {loadState === "ready" && step === 2 && (
          <div className="reserved-step">
            <div className="reserved-visual">
              <span
                className="reserved-image"
                style={project?.originalImageUrl ? { backgroundImage: `url("${project.originalThumbnailUrl || project.originalImageUrl}")` } : undefined}
              />
              <span>→</span>
              <span
                className="reserved-image panorama"
                style={project?.panoramaImageUrl ? { backgroundImage: `url("${project.panoramaThumbnailUrl || project.panoramaImageUrl}")` } : undefined}
              />
            </div>
            <h1>生成全景</h1>
            <p>
              以已上传的历史原图为参考，调用大模型图生图接口扩出可 360 度浏览的全景图。
              生成任务在服务端执行，完成后结果自动存入项目库。
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0", fontSize: 11 }}>
              <span>图片生成厂商：</span>
              <select
                value={genProvider}
                onChange={(event) => setGenProvider(event.target.value as ImageGenProviderName | "")}
                style={{ padding: "6px 8px", border: "1px solid rgba(7,16,12,0.19)", borderRadius: 4, background: "transparent", color: "var(--admin-ink)", fontSize: 11 }}
              >
                <option value="">默认（系统设置）</option>
                <option value="seedream">Seedream（火山方舟）</option>
                <option value="openai">OpenAI</option>
                <option value="qwen">Qwen（阿里云百炼）</option>
              </select>
            </label>
            <div className="reserved-actions">
              <button
                className="admin-primary-button"
                type="button"
                disabled={!project?.originalImageUrl || genStatus === "running"}
                onClick={startGenerate}
              >
                {genStatus === "running" ? "生成中…" : project?.panoramaImageUrl ? "重新生成全景" : "开始生成全景"}
              </button>
              {project?.panoramaImageUrl && (
                <button type="button" onClick={() => setStep(3)}>进入投影调参</button>
              )}
            </div>
            {genStatus === "running" && <p>任务已提交，正在等待生成结果（通常需要 10-60 秒）…</p>}
            {genStatus === "failed" && <p style={{ color: "#b34c3c" }}>生成失败：{genError}</p>}
            {genStatus === "succeeded" && <p>生成完成，全景图已保存。</p>}
          </div>
        )}

        {loadState === "ready" && step === 3 && project && (
          <div className="calibration-step">
            <EditorApp
              embedded
              initialScene={project.scene}
              originalImageUrl={project.originalImageUrl}
              originalImageThumbnailUrl={project.originalThumbnailUrl}
              originalImageTitle="历史照片原照"
              onSave={saveScene}
            />
          </div>
        )}

        {loadState === "ready" && step === 4 && project && (
          <div className="publish-step">
            <div className="publish-viewer-wrap">
              <ViewerApp projectId={project.id} embedded allowFullscreen />
            </div>
            <div className="publish-copy">
              <span className="eyebrow">PUBLISH PREVIEW</span>
              <h2>{project.title}</h2>
              <p>在工作台内检查最终浏览效果。左侧预览可切换为全屏，不会跳转到单独页面。</p>

              <h3>照片元数据</h3>
              <dl className="publish-status-list">
                <div><dt>拍摄时间</dt><dd>{project.captureTime || "未填写"}</dd></div>
                <div><dt>拍摄地点</dt><dd>{project.location || "未填写"}</dd></div>
                <div><dt>投影方式</dt><dd>{MODE_LABELS[project.mode]}</dd></div>
                <div><dt>全景图</dt><dd>{project.panoramaImageUrl ? "已生成" : "未生成"}</dd></div>
                <div><dt>浏览范围</dt><dd>{project.scene.view.minYaw}° — {project.scene.view.maxYaw}°</dd></div>
                <div><dt>默认视场</dt><dd>{project.scene.view.hfov}°</dd></div>
              </dl>

              <h3>投影参数</h3>
              <dl className="publish-technical-list">
                {isPartialSphereProjection(project.scene.projection) && <>
                  <div><dt>水平覆盖</dt><dd>{project.scene.projection.haov}°</dd></div>
                  <div><dt>垂直覆盖</dt><dd>{project.scene.projection.vaov}°</dd></div>
                  <div><dt>垂直偏移</dt><dd>{project.scene.projection.vOffset}°</dd></div>
                </>}
                {isAdaptiveProjection(project.scene.projection) && <>
                  <div><dt>水平 / 垂直覆盖</dt><dd>{project.scene.projection.horizontalSpan}° / {project.scene.projection.verticalSpan}°</dd></div>
                  <div><dt>水平 / 垂直曲率</dt><dd>{project.scene.projection.horizontalCurvature} / {project.scene.projection.verticalCurvature}</dd></div>
                  <div><dt>地平线</dt><dd>{project.scene.projection.horizonY}</dd></div>
                  <div><dt>边缘模式</dt><dd>{project.scene.projection.edgeMode}</dd></div>
                </>}
                <div><dt>俯仰范围</dt><dd>{project.scene.view.minPitch}° — {project.scene.view.maxPitch}°</dd></div>
                <div><dt>视场范围</dt><dd>{project.scene.view.minHfov}° — {project.scene.view.maxHfov}°</dd></div>
              </dl>

              <div className="publish-notes">
                <strong>文字备注</strong>
                <p>{project.notes || "暂无文字备注。"}</p>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
