"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { EditorApp, INITIAL_SCENE } from "../editor-app";
import { ViewerApp } from "../viewer-app";
import {
  isAdaptiveProjection,
  isPartialSphereProjection,
  type ImmersiveScene,
} from "@/src/core/projection-types";
import { MODE_LABELS, type PanoramaProject } from "@/src/projects/types";
import { authenticatedFetch, getCurrentAuth } from "@/src/auth/client";

interface WorkbenchDraft {
  id?: string;
  title: string;
  captureTime: string;
  location: string;
  notes: string;
  mode: ImmersiveScene["mode"];
  originalImageUrl: string;
  panoramaImageUrl: string;
  scene: ImmersiveScene;
  workflowStep: number;
  publicationStatus: "draft" | "published";
}

const STEPS = [
  { id: 1, title: "上传照片", short: "SOURCE" },
  { id: 2, title: "生成全景", short: "GENERATE" },
  { id: 3, title: "投影调参", short: "CALIBRATE" },
  { id: 4, title: "发布", short: "PUBLISH" },
] as const;

type UploadKind = "original" | "panorama";

const UPLOAD_LIMITS: Record<UploadKind, number> = {
  original: 10 * 1024 * 1024,
  panorama: 50 * 1024 * 1024,
};

const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function uploadFileThroughBackend(
  uploadUrl: string,
  file: File,
  csrfToken: string,
  onProgress: (percent: number) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("x-csrf-token", csrfToken);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        try {
          const payload = JSON.parse(request.responseText) as { asset?: { url?: string } };
          if (!payload.asset?.url) throw new Error("上传接口没有返回图片地址。");
          resolve(payload.asset.url);
        } catch (caught) {
          reject(caught instanceof Error ? caught : new Error("无法读取图片上传结果。"));
        }
      } else {
        const message = (() => {
          try {
            return (JSON.parse(request.responseText) as { error?: string }).error;
          } catch {
            return "";
          }
        })();
        reject(new Error(message || `LightCOS 上传失败（HTTP ${request.status}）。`));
      }
    });
    request.addEventListener("error", () => reject(new Error("无法连接 MemoScapeLab 图片上传接口。")));
    request.addEventListener("abort", () => reject(new Error("图片上传已取消。")));
    request.send(file);
  });
}

function sceneCoverage(scene: ImmersiveScene) {
  if (isPartialSphereProjection(scene.projection)) {
    return `${scene.projection.haov}° × ${scene.projection.vaov}°`;
  }
  if (isAdaptiveProjection(scene.projection)) {
    return `${scene.projection.horizontalSpan}° × ${scene.projection.verticalSpan}°`;
  }
  return "360° × 180°";
}

function cloneInitialScene(): ImmersiveScene {
  return {
    ...INITIAL_SCENE,
    id: "new-project",
    title: "未命名照片项目",
    subtitle: "",
    source: "",
    projection: INITIAL_SCENE.projection
      ? { ...INITIAL_SCENE.projection }
      : undefined,
    view: { ...INITIAL_SCENE.view },
    metadata: { ...INITIAL_SCENE.metadata },
  };
}

function emptyDraft(): WorkbenchDraft {
  return {
    title: "",
    captureTime: "",
    location: "",
    notes: "",
    mode: "curvedPhoto",
    originalImageUrl: "",
    panoramaImageUrl: "",
    scene: cloneInitialScene(),
    workflowStep: 1,
    publicationStatus: "draft",
  };
}

function draftFromProject(project: PanoramaProject): WorkbenchDraft {
  return {
    id: project.id,
    title: project.title,
    captureTime: project.captureTime,
    location: project.location,
    notes: project.notes,
    mode: project.mode,
    originalImageUrl: project.originalImageUrl,
    panoramaImageUrl: project.panoramaImageUrl,
    scene: project.scene,
    workflowStep: project.workflowStep,
    publicationStatus: project.publicationStatus,
  };
}

export function WorkbenchApp({ projectId }: { projectId?: string }) {
  const [draft, setDraft] = useState<WorkbenchDraft>(() => emptyDraft());
  const [step, setStep] = useState(projectId ? 3 : 1);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"original" | "panorama" | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notice, setNotice] = useState(projectId ? "正在载入项目" : "新项目尚未保存");
  const [error, setError] = useState("");
  const [viewerRevision, setViewerRevision] = useState(0);
  const [publishDetailsOpen, setPublishDetailsOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(projectId)}`)
      .then(async (response) => {
        const payload = (await response.json()) as {
          project?: PanoramaProject;
          error?: string;
        };
        if (!response.ok || !payload.project) {
          throw new Error(payload.error ?? "项目载入失败");
        }
        if (!cancelled) {
          const next = draftFromProject(payload.project);
          setDraft(next);
          setStep(Math.max(1, Math.min(4, next.workflowStep || 3)));
          setNotice("项目数据已从本地数据库载入");
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "项目载入失败");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const imageSource = draft.panoramaImageUrl || draft.originalImageUrl;
  const canCalibrate = Boolean(imageSource);

  const projectPayload = useCallback(
    (scene: ImmersiveScene = draft.scene, workflowStep: number = step) => ({
      ...(draft.id ? { id: draft.id } : {}),
      title: draft.title.trim() || scene.title || "未命名照片项目",
      captureTime: draft.captureTime,
      location: draft.location,
      notes: draft.notes,
      mode: scene.mode,
      originalImageUrl: draft.originalImageUrl,
      panoramaImageUrl: draft.panoramaImageUrl,
      workflowStep,
      publicationStatus: draft.publicationStatus,
      scene: {
        ...scene,
        title: draft.title.trim() || scene.title || "未命名照片项目",
        subtitle: draft.location,
        source: scene.source || imageSource,
        metadata: {
          ...scene.metadata,
          sourceYear: draft.captureTime,
        },
      },
    }),
    [draft, imageSource, step],
  );

  const persistProject = useCallback(
    async (scene: ImmersiveScene = draft.scene, workflowStep: number = step) => {
      setSaving(true);
      setError("");
      try {
        const payload = projectPayload(scene, workflowStep);
        const endpoint = draft.id
          ? `/api/projects/${encodeURIComponent(draft.id)}`
          : "/api/projects";
        const response = await authenticatedFetch(endpoint, {
          method: draft.id ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = (await response.json()) as {
          project?: PanoramaProject;
          error?: string;
        };
        if (!response.ok || !result.project) {
          throw new Error(result.error ?? "保存失败");
        }
        setDraft(draftFromProject(result.project));
        setNotice("已保存到本地项目数据库");
        if (!draft.id) {
          window.history.replaceState(
            {},
            "",
            `/work?id=${encodeURIComponent(result.project.id)}`,
          );
        }
        return result.project;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "保存失败";
        setError(message);
        setNotice("保存未完成");
        throw caught;
      } finally {
        setSaving(false);
      }
    },
    [draft, projectPayload, step],
  );

  const uploadFile = useCallback(async (file: File, kind: UploadKind) => {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      throw new Error("仅支持 JPG/JPEG、PNG 和 WebP 图片。");
    }
    if (file.size > UPLOAD_LIMITS[kind]) {
      throw new Error(`${kind === "original" ? "历史原图" : "全景图"}不能超过 ${UPLOAD_LIMITS[kind] / 1024 / 1024} MB。`);
    }

    setUploadProgress(0);
    const intentResponse = await authenticatedFetch("/api/assets/upload-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        filename: file.name,
        contentType: file.type,
        size: file.size,
        projectId: draft.id,
      }),
    });
    const intent = (await intentResponse.json()) as {
      assetId?: string;
      uploadUrl?: string;
      error?: string;
    };
    if (!intentResponse.ok || !intent.assetId || !intent.uploadUrl) {
      throw new Error(intent.error ?? "无法创建 LightCOS 上传任务。");
    }

    const auth = await getCurrentAuth();
    return uploadFileThroughBackend(intent.uploadUrl, file, auth.csrfToken, setUploadProgress);
  }, [draft.id]);

  const uploadSource = async (
    kind: "original" | "panorama",
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(kind);
    setUploadProgress(0);
    setError("");
    try {
      const url = await uploadFile(file, kind);
      const title = draft.title || file.name.replace(/\.[^.]+$/, "");
      setDraft((current) => {
        const useAsScene = kind === "panorama" || !current.panoramaImageUrl;
        const nextScene = useAsScene
          ? { ...current.scene, title, source: url }
          : current.scene;
        return {
          ...current,
          title,
          [kind === "original" ? "originalImageUrl" : "panoramaImageUrl"]: url,
          scene: nextScene,
        };
      });
      setNotice(`${kind === "original" ? "历史原图" : "宽幅照片"}已存入 LightCOS 图床`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片上传失败");
    } finally {
      setUploading(null);
      setUploadProgress(0);
    }
  };

  const uploadFromEditor = useCallback(
    async (file: File) => {
      setUploading("panorama");
      setUploadProgress(0);
      try {
        const url = await uploadFile(file, "panorama");
        setDraft((current) => ({ ...current, panoramaImageUrl: url }));
        setNotice("调参照片已存入 LightCOS 图床");
        return url;
      } finally {
        setUploading(null);
        setUploadProgress(0);
      }
    },
    [uploadFile],
  );

  const handleSceneChange = useCallback((scene: ImmersiveScene) => {
    setDraft((current) =>
      current.scene === scene
        ? current
        : { ...current, scene, mode: scene.mode },
    );
  }, []);

  const currentTitle = useMemo(
    () => draft.title || (draft.id ? "照片项目" : "新建照片项目"),
    [draft.id, draft.title],
  );

  const continueFromSource = async () => {
    if (!imageSource || !draft.title.trim()) return;
    try {
      await persistProject(
        { ...draft.scene, source: imageSource, title: draft.title },
        2,
      );
      setStep(2);
    } catch {
      // The visible error state already explains the failure.
    }
  };

  const enterCalibration = async () => {
    if (!canCalibrate) return;
    setStep(3);
    try {
      await persistProject({ ...draft.scene, source: imageSource }, 3);
    } catch {
      // Users can continue adjusting locally and retry saving.
    }
  };

  const openPublishPreview = async () => {
    if (!draft.id) return;
    try {
      await persistProject(draft.scene, 3);
      setViewerRevision((current) => current + 1);
      setStep(4);
    } catch {
      // The preview only opens after the latest parameters are persisted.
    }
  };

  if (loading) {
    return (
      <main className="workbench-page workbench-loading">
        <span className="loading-orbit" />
        <strong>正在打开项目工作台</strong>
        <small>{projectId}</small>
      </main>
    );
  }

  if (error && projectId && !draft.id) {
    return (
      <main className="workbench-page workbench-loading">
        <span className="error-orbit">!</span>
        <strong>项目无法打开</strong>
        <small>{error}</small>
        <Link href="/proj">返回项目库</Link>
      </main>
    );
  }

  return (
    <main className="workbench-page">
      <header className="workbench-topbar">
        <div className="workbench-title">
          <Link href="/proj">← 项目库</Link>
          <span />
          <div>
            <small>{draft.id ? `ID ${draft.id}` : "NEW PROJECT"}</small>
            <strong>{currentTitle}</strong>
          </div>
        </div>
        <div className="workbench-save-state">
          <span className={error ? "has-error" : ""}><i /> {error || notice}</span>
          {draft.id && <b>{MODE_LABELS[draft.mode]}</b>}
          {step === 3 && draft.id && (
            <button className="workbench-preview-button" type="button" disabled={saving} onClick={() => void openPublishPreview()}>
              发布预览 →
            </button>
          )}
          {step === 4 && (
            <button className="workbench-preview-button" type="button" onClick={() => setStep(3)}>
              ← 返回调参
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void persistProject()}
          >
            {saving ? "正在保存…" : "保存项目"}
          </button>
        </div>
      </header>

      <nav className="workflow-steps" aria-label="项目制作流程">
        {STEPS.map((item) => {
          return (
            <button
              type="button"
              key={item.id}
              className={`${step === item.id ? "is-active" : ""} ${item.id < step ? "is-complete" : ""}`}
              disabled={item.id === 3 && !canCalibrate}
              onClick={() => item.id === 4 ? void openPublishPreview() : setStep(item.id)}
            >
              <span>{item.id < step ? "✓" : item.id}</span>
              <div><small>{item.short}</small><strong>{item.title}</strong></div>
              {item.id === 4 && <em>预览</em>}
            </button>
          );
        })}
      </nav>

      <section className={`workflow-stage stage-${step}`}>
        {step === 1 && (
          <div className="source-step">
            <div className="step-intro">
              <span>STEP 01 / SOURCE</span>
              <h1>建立照片档案</h1>
              <p>原图与生成后的宽幅图会作为两个独立素材保存；如果已有宽幅照片，可直接上传并进入调参。</p>
            </div>

            <div className="source-layout">
              <div className="source-uploads">
                <UploadPanel
                  kind="original"
                  title="历史原图"
                  description="未经扩展的老照片、档案扫描图"
                  imageUrl={draft.originalImageUrl}
                  uploading={uploading === "original"}
                  progress={uploading === "original" ? uploadProgress : 0}
                  onChange={(event) => void uploadSource("original", event)}
                />
                <div className="upload-flow-arrow" aria-hidden="true">→</div>
                <UploadPanel
                  kind="panorama"
                  title="宽幅 / 全景照片"
                  description="已生成的 AIGC 全景或其他宽幅照片"
                  imageUrl={draft.panoramaImageUrl}
                  uploading={uploading === "panorama"}
                  progress={uploading === "panorama" ? uploadProgress : 0}
                  onChange={(event) => void uploadSource("panorama", event)}
                />
              </div>

              <div className="metadata-card">
                <div className="metadata-heading">
                  <div><small>METADATA</small><h2>影像元数据</h2></div>
                  <span>01—05</span>
                </div>
                <label>
                  <span>项目标题 *</span>
                  <input
                    value={draft.title}
                    placeholder="例如：1930 年代外滩江畔街景"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        title: event.target.value,
                        scene: { ...current.scene, title: event.target.value },
                      }))
                    }
                  />
                </label>
                <div className="metadata-row">
                  <label><span>拍摄时间</span><input value={draft.captureTime} placeholder="约 1930 年代" onChange={(event) => setDraft((current) => ({ ...current, captureTime: event.target.value }))} /></label>
                  <label><span>地点</span><input value={draft.location} placeholder="上海 · 外滩" onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} /></label>
                </div>
                <label>
                  <span>文字备注</span>
                  <textarea value={draft.notes} placeholder="记录照片来源、画面内容、生成过程或考证信息……" onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
                </label>
                <div className="metadata-action-row">
                  <small>{!imageSource ? "请至少上传一张照片" : !draft.title.trim() ? "请填写项目标题" : "资料已就绪"}</small>
                  <button type="button" disabled={!imageSource || !draft.title.trim() || saving} onClick={() => void continueFromSource()}>
                    保存并继续 <span>→</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="reserved-step">
            <div className="reserved-visual">
              <div className="reserved-image" style={draft.originalImageUrl ? { backgroundImage: `url("${draft.originalImageUrl}")` } : undefined} />
              <span>AI</span>
              <div className="reserved-image panorama" style={draft.panoramaImageUrl ? { backgroundImage: `url("${draft.panoramaImageUrl}")` } : undefined} />
            </div>
            <span className="eyebrow">STEP 02 / GENERATE</span>
            <h1>全景生成模块已预留</h1>
            <p>后续将接入用户自定义的大模型 API，把历史原图扩展为可调参的宽幅或全景照片。本轮可使用已上传的宽幅照片直接继续。</p>
            <div className="reserved-actions">
              <button type="button" disabled>开始 AI 生成 · 后续开放</button>
              <button type="button" className="admin-primary-button" disabled={!canCalibrate} onClick={() => void enterCalibration()}>
                使用当前照片进入调参 →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="calibration-step">
            <EditorApp
              key={draft.id ?? "new-project-editor"}
              embedded
              originalImageUrl={draft.originalImageUrl}
              originalImageTitle={draft.title || "历史照片原照"}
              initialScene={{ ...draft.scene, source: draft.scene.source || imageSource }}
              onSceneChange={handleSceneChange}
              onSave={async (scene) => {
                await persistProject(scene, 3);
              }}
              onImageUpload={uploadFromEditor}
            />
          </div>
        )}

        {step === 4 && (
          <div className="publish-step">
            <div className="publish-viewer-wrap">
              {draft.id && (
                <ViewerApp key={`${draft.id}-${viewerRevision}`} projectId={draft.id} embedded />
              )}
            </div>
            <div className="publish-copy">
              <span className="eyebrow">STEP 04 / PUBLISH</span>
              <h2>发布流程已预留</h2>
              <p>项目与技术参数已经可以完整保存。后续前端完成后，这里将提供发布状态、前端可见性与撤回管理。</p>
              <dl className="publish-status-list">
                <div><dt>项目状态</dt><dd>草稿</dd></div>
                <div><dt>投影方式</dt><dd>{MODE_LABELS[draft.mode]}</dd></div>
                <div><dt>参数记录</dt><dd>已写入项目数据库</dd></div>
              </dl>
              <button
                type="button"
                className="publish-parameter-toggle"
                aria-expanded={publishDetailsOpen}
                onClick={() => setPublishDetailsOpen((open) => !open)}
              >
                {publishDetailsOpen ? "收起参数" : "查看参数"}
                <span>{publishDetailsOpen ? "−" : "+"}</span>
              </button>
              {publishDetailsOpen && (
                <div className="publish-parameter-panel">
                  <dl>
                    <div><dt>投影方式</dt><dd>{MODE_LABELS[draft.scene.mode]}</dd></div>
                    <div><dt>覆盖范围</dt><dd>{sceneCoverage(draft.scene)}</dd></div>
                    <div><dt>默认视场</dt><dd>{draft.scene.view.hfov}°</dd></div>
                    <div><dt>水平边界</dt><dd>{draft.scene.view.minYaw}° — {draft.scene.view.maxYaw}°</dd></div>
                  </dl>
                  <p>{draft.notes || draft.scene.metadata?.disclaimer || "暂无项目备注。"}</p>
                </div>
              )}
              <button type="button" disabled>发布到前端 · 后续开放</button>
              <button type="button" className="text-button" onClick={() => setStep(3)}>← 返回继续调参</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function UploadPanel({
  kind,
  title,
  description,
  imageUrl,
  uploading,
  progress,
  onChange,
}: {
  kind: "original" | "panorama";
  title: string;
  description: string;
  imageUrl: string;
  uploading: boolean;
  progress: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={`source-upload-card ${imageUrl ? "has-image" : ""}`}>
      {imageUrl && <span className="source-upload-preview" style={{ backgroundImage: `url("${imageUrl}")` }} />}
      <span className="source-upload-index">{kind === "original" ? "A" : "B"}</span>
      <span className="source-upload-icon">{uploading ? "···" : imageUrl ? "↻" : "+"}</span>
      <strong>{uploading ? `正在上传 LightCOS · ${progress}%` : imageUrl ? `更换${title}` : `上传${title}`}</strong>
      <small>{description}</small>
      {uploading && <span className="source-upload-progress" aria-label={`上传进度 ${progress}%`}><i style={{ width: `${progress}%` }} /></span>}
      <em>{`LIGHTCOS · JPG / PNG / WEBP · 最大 ${kind === "original" ? "10" : "50"} MB`}</em>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={onChange} hidden />
    </label>
  );
}
