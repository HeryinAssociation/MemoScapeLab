"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { authenticatedFetch } from "@/src/auth/client";
import type { ImmersiveScene } from "@/src/core/projection-types";
import { MODE_LABELS, type PanoramaProject } from "@/src/projects/types";
import type { ImageGenProviderName } from "@/worker/image-gen/types";
import { EditorApp, INITIAL_SCENE } from "../editor-app";

type LoadState = "loading" | "ready" | "error";
type GenStatus = "idle" | "running" | "succeeded" | "failed";

const WORKFLOW_STEPS = [
  { n: 1, label: "上传照片" },
  { n: 2, label: "生成全景" },
  { n: 3, label: "投影调参" },
  { n: 4, label: "发布" },
] as const;

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
    } else {
      setLoadState("ready");
      setStep(1);
      setMessage("新建项目：请先上传原图");
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
    originalImageUrl?: string;
    scene?: ImmersiveScene;
    workflowStep?: number;
  }) => {
    const scene = options.scene ?? project?.scene ?? INITIAL_SCENE;
    const body = {
      title: title || "未命名项目",
      captureTime,
      location,
      notes,
      mode: project?.mode ?? "curvedPhoto",
      originalImageUrl: options.originalImageUrl ?? project?.originalImageUrl ?? "",
      panoramaImageUrl: project?.panoramaImageUrl ?? "",
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

  const uploadOriginal = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setMessage(`正在上传原图：${file.name}`);
      const form = new FormData();
      form.append("file", file);
      const response = await authenticatedFetch("/api/assets", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "上传失败");
      const url = payload.url!;
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
      // 新项目的场景 source 指向上传原图
      const scene: ImmersiveScene = project
        ? project.scene
        : { ...INITIAL_SCENE, source: url };
      await saveProject({ originalImageUrl: url, scene, workflowStep: 1 });
      setMessage("原图已保存，可以进入下一步");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
    }
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
          setGenStatus("succeeded");
          setMessage("全景生成完成");
          const projectResponse = await authenticatedFetch(
            `/api/projects/${encodeURIComponent(project?.id ?? "")}`,
          );
          const projectPayload = (await projectResponse.json()) as {
            project?: PanoramaProject;
            error?: string;
          };
          if (projectResponse.ok && projectPayload.project) {
            setProject(projectPayload.project);
          }
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

  const publishProject = async () => {
    if (!project) return;
    try {
      const body = {
        title,
        captureTime,
        location,
        notes,
        mode: project.mode,
        originalImageUrl: project.originalImageUrl,
        panoramaImageUrl: project.panoramaImageUrl,
        scene: project.scene,
        workflowStep: 4,
        publicationStatus: "published",
      };
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { project?: PanoramaProject; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "发布失败");
      setProject(payload.project!);
      setMessage("项目已发布");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布失败");
    }
  };

  const saveScene = async (scene: ImmersiveScene) => {
    await saveProject({ scene, workflowStep: 3 });
    setMessage("投影参数已保存到数据库");
  };

  const cover = project?.panoramaImageUrl || project?.originalImageUrl;

  return (
    <main className="workbench-page">
      <header className="workbench-topbar">
        <div className="workbench-title">
          <Link href="/proj">← 返回项目库</Link>
          <span />
          <span>
            <small>ADAPTIVE PANNELLUM / WORKBENCH</small>
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
            <span>{step > item.n ? "✓" : String(item.n).padStart(2, "0")}</span>
            <span>
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
              <p>上传历史原图或宽幅照片，并填写影像元数据。保存后即可进入全景生成。</p>
            </div>
            <div className="source-layout">
              <div className="source-uploads">
                <label className={`source-upload-card ${project?.originalImageUrl ? "has-image" : ""}`}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={uploadOriginal}
                  />
                  {project?.originalImageUrl && (
                    <span
                      className="source-upload-preview"
                      style={{ backgroundImage: `url("${project.originalImageUrl}")` }}
                    />
                  )}
                  <span className="source-upload-icon">＋</span>
                  <strong>{project?.originalImageUrl ? "重新上传原图" : "选择历史原图"}</strong>
                  <small>支持 JPG / PNG / WebP，单张不超过 30 MB</small>
                  <em>CLICK TO UPLOAD</em>
                </label>
                <span className="upload-flow-arrow">→</span>
                <div className="source-upload-card has-image">
                  {cover ? (
                    <span className="source-upload-preview" style={{ backgroundImage: `url("${cover}")` }} />
                  ) : (
                    <>
                      <span className="source-upload-icon">▦</span>
                      <strong>待生成全景</strong>
                      <small>保存原图后可进入生成步骤</small>
                    </>
                  )}
                </div>
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
                  <small>{project?.originalImageUrl ? "原图已保存" : "尚未上传原图"}</small>
                  <button
                    type="button"
                    disabled={!project?.originalImageUrl}
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
                style={project?.originalImageUrl ? { backgroundImage: `url("${project.originalImageUrl}")` } : undefined}
              />
              <span>→</span>
              <span
                className="reserved-image panorama"
                style={project?.panoramaImageUrl ? { backgroundImage: `url("${project.panoramaImageUrl}")` } : undefined}
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
              originalImageTitle="历史照片原照"
              onSave={saveScene}
            />
          </div>
        )}

        {loadState === "ready" && step === 4 && project && (
          <div className="publish-step">
            <div
              className="publish-preview"
              style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
            >
              <span>{project.publicationStatus === "published" ? "PUBLISHED" : "DRAFT"}</span>
              <div>
                <small>{project.captureTime || "年代待考"}</small>
                <h1>{project.title}</h1>
              </div>
            </div>
            <div className="publish-copy">
              <span className="eyebrow">PUBLISH</span>
              <h2>发布项目</h2>
              <p>发布后项目将以只读方式在成片浏览页展示，供访客沉浸浏览。</p>
              <dl>
                <div><dt>投影方式</dt><dd>{MODE_LABELS[project.mode]}</dd></div>
                <div><dt>全景图</dt><dd>{project.panoramaImageUrl ? "已生成" : "未生成"}</dd></div>
                <div><dt>状态</dt><dd>{project.publicationStatus === "published" ? "已发布" : "草稿"}</dd></div>
              </dl>
              <button
                type="button"
                disabled={project.publicationStatus === "published"}
                onClick={publishProject}
              >
                {project.publicationStatus === "published" ? "已发布" : "发布项目"}
              </button>
              <Link className="text-button" href={`/viewer?id=${encodeURIComponent(project.id)}`}>
                在成片浏览页打开 →
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
