"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { BrandMark } from "./brand-art";
import {
  DEFAULT_ADAPTIVE_PROJECTION,
  isAdaptiveProjection,
  isPartialSphereProjection,
  type AdaptiveProjectionConfig,
  type EdgeMode,
  type ImmersiveScene,
  type SceneMode,
  type ViewConfig,
} from "@/src/core/projection-types";
import { renderScene, type RenderHandle } from "@/src/core/render-router";
import { validateScene } from "@/src/core/scene-validator";
import { serializeScene } from "@/src/editor/config-exporter";
import { EDITOR_PRESETS } from "@/src/editor/presets";
import type { AdaptiveViewState } from "@/src/adaptive/adaptive-renderer";

export const INITIAL_SCENE: ImmersiveScene = {
  id: "shanghai-editor-scene",
  title: "上海历史街景调参",
  subtitle: "为当前照片寻找最自然的视域与投影方式",
  source: "/images/laozao-shanghai-001.png",
  mode: "curvedPhoto",
  projection: { ...DEFAULT_ADAPTIVE_PROJECTION },
  view: {
    yaw: 0,
    pitch: 0,
    hfov: 72,
    minYaw: -74,
    maxYaw: 74,
    minPitch: -20,
    maxPitch: 24,
    minHfov: 52,
    maxHfov: 90,
  },
  metadata: {
    sourceYear: "年代待考",
    aiColorized: true,
    aiExpanded: true,
    disclaimer: "扩展区域由 AI 辅助生成，仅用于沉浸式历史场景展示。",
  },
};

const MODES: Array<{
  id: SceneMode;
  name: string;
  short: string;
}> = [
  { id: "sphere360", name: "完整球面", short: "360°" },
  { id: "partialSphere", name: "有限球面", short: "部分" },
  { id: "curvedPhoto", name: "弧形照片", short: "曲面" },
  { id: "flatPhoto", name: "平面照片", short: "平面" },
];

const SAMPLE_IMAGES = [
  {
    title: "江畔钟楼",
    source: "/images/virtual-shanghai-001.png",
  },
  {
    title: "外滩滨江",
    source: "/images/laozao-shanghai-001.png",
  },
];

type PreviewDevice = "desktop" | "tablet" | "mobile";
type EditorStatus = "loading" | "ready" | "error";
type SaveFeedback = "idle" | "saving" | "saved" | "error";

interface EditorAppProps {
  initialScene?: ImmersiveScene;
  embedded?: boolean;
  originalImageUrl?: string;
  originalImageThumbnailUrl?: string;
  originalImageTitle?: string;
  onSceneChange?: (scene: ImmersiveScene) => void;
  onSave?: (scene: ImmersiveScene) => Promise<void> | void;
  onImageUpload?: (file: File) => Promise<string>;
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  hint,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`range-field ${disabled ? "is-disabled" : ""}`}>
      <span className="range-heading">
        <span>
          <strong>{label}</strong>
          {hint && <small>{hint}</small>}
        </span>
        <span className="range-number">
          <input
            type="number"
            value={Number(value.toFixed(step < 1 ? 3 : 1))}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-label={`${label}数值`}
          />
          <em>{suffix}</em>
        </span>
      </span>
      <span className="range-track">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
        />
        <span
          className="range-progress"
          style={{ width: `${((value - min) / (max - min)) * 100}%` }}
        />
      </span>
    </label>
  );
}

function ParameterGroup({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <details className="parameter-group" open>
      <summary>
        <span>{title}</span>
        {badge && <small>{badge}</small>}
      </summary>
      <div className="parameter-body">{children}</div>
    </details>
  );
}

function adaptiveProjection(scene: ImmersiveScene) {
  return isAdaptiveProjection(scene.projection)
    ? scene.projection
    : DEFAULT_ADAPTIVE_PROJECTION;
}

function projectionSpan(scene: ImmersiveScene, axis: "horizontal" | "vertical") {
  if (isPartialSphereProjection(scene.projection)) {
    return axis === "horizontal" ? scene.projection.haov : scene.projection.vaov;
  }
  const projection = adaptiveProjection(scene);
  return axis === "horizontal"
    ? projection.horizontalSpan
    : projection.verticalSpan;
}

export function EditorApp({
  initialScene = INITIAL_SCENE,
  embedded = false,
  originalImageUrl = "",
  originalImageThumbnailUrl = "",
  originalImageTitle = "历史照片原照",
  onSceneChange,
  onSave,
  onImageUpload,
}: EditorAppProps = {}) {
  const [startingScene] = useState(initialScene);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewShellRef = useRef<HTMLDivElement>(null);
  const renderHandleRef = useRef<{
    identity: string;
    handle: RenderHandle;
  } | null>(null);
  const latestSceneRef = useRef(startingScene);
  const liveViewRef = useRef<AdaptiveViewState>({
    yaw: startingScene.view.yaw,
    pitch: startingScene.view.pitch,
    hfov: startingScene.view.hfov,
  });
  const objectUrlRef = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const saveFeedbackTimerRef = useRef<number | null>(null);

  const [scene, setScene] = useState<ImmersiveScene>(startingScene);
  const [exportSource, setExportSource] = useState(startingScene.source);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [status, setStatus] = useState<EditorStatus>("loading");
  const [statusMessage, setStatusMessage] = useState("正在建立实时预览");
  const [liveView, setLiveView] = useState<AdaptiveViewState>({
    yaw: startingScene.view.yaw,
    pitch: startingScene.view.pitch,
    hfov: startingScene.view.hfov,
  });
  const [notice, setNotice] = useState("所有参数修改会立即反映在预览中");
  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>("idle");

  const identity = `${scene.mode}:${scene.source}`;
  const isAdaptive =
    scene.mode === "curvedPhoto" || scene.mode === "flatPhoto";
  const projection = adaptiveProjection(scene);

  const handleLiveViewChange = (view: AdaptiveViewState) => {
    liveViewRef.current = view;
    setLiveView(view);
  };

  useEffect(() => {
    latestSceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    let cancelled = false;
    setStatus("loading");
    setStatusMessage("正在建立实时预览");

    renderScene(target, scene, { onViewChange: handleLiveViewChange })
      .then((handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        const activeIdentity = `${latestSceneRef.current.mode}:${latestSceneRef.current.source}`;
        if (activeIdentity !== identity) {
          handle.destroy();
          return;
        }
        renderHandleRef.current = { identity, handle };
        handle.update?.(latestSceneRef.current);
        setStatus("ready");
        setStatusMessage("实时预览已就绪");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setStatusMessage(
          error instanceof Error ? error.message : "实时预览启动失败。",
        );
      });

    return () => {
      cancelled = true;
      if (renderHandleRef.current?.identity === identity) {
        renderHandleRef.current.handle.destroy();
        renderHandleRef.current = null;
      }
    };
    // Renderer identity intentionally excludes parameter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    const renderer = renderHandleRef.current;
    if (renderer?.identity === identity) {
      renderer.handle.update?.(scene);
    }
  }, [identity, scene]);

  useEffect(() => {
    onSceneChange?.(scene);
  }, [onSceneChange, scene]);

  useEffect(() => {
    if (!originalPreviewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOriginalPreviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [originalPreviewOpen]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (saveFeedbackTimerRef.current) window.clearTimeout(saveFeedbackTimerRef.current);
    },
    [],
  );

  const exportJson = useMemo(
    () => serializeScene(scene, exportSource),
    [exportSource, scene],
  );

  const updateAdaptive = <K extends keyof AdaptiveProjectionConfig>(
    key: K,
    value: AdaptiveProjectionConfig[K],
  ) => {
    setScene((current) => ({
      ...current,
      projection: {
        ...adaptiveProjection(current),
        [key]: value,
      },
    }));
  };

  const updateView = (key: keyof ViewConfig, value: number) => {
    if (key === "yaw" || key === "pitch" || key === "hfov") {
      liveViewRef.current = { ...liveViewRef.current, [key]: value };
    }
    setScene((current) => ({
      ...current,
      view: { ...current.view, [key]: value },
    }));
  };

  const adjustZoom = (difference: number) => {
    const hfov = Math.min(
      scene.view.maxHfov,
      Math.max(scene.view.minHfov, scene.view.hfov + difference),
    );
    liveViewRef.current = { ...liveViewRef.current, hfov };
    setLiveView(liveViewRef.current);
    setScene((current) => ({
      ...current,
      view: { ...current.view, hfov },
    }));
  };

  const updateSpan = (axis: "horizontal" | "vertical", value: number) => {
    setScene((current) => {
      if (
        current.mode === "partialSphere" &&
        isPartialSphereProjection(current.projection)
      ) {
        return {
          ...current,
          projection: {
            ...current.projection,
            [axis === "horizontal" ? "haov" : "vaov"]: value,
          },
        };
      }
      return {
        ...current,
        projection: {
          ...adaptiveProjection(current),
          [axis === "horizontal" ? "horizontalSpan" : "verticalSpan"]: value,
        },
      };
    });
  };

  const changeMode = (mode: SceneMode) => {
    setScene((current) => {
      if (mode === "sphere360") {
        return {
          ...current,
          mode,
          projection: undefined,
          view: {
            ...current.view,
            minYaw: -180,
            maxYaw: 180,
            minPitch: -75,
            maxPitch: 75,
          },
        };
      }
      if (mode === "partialSphere") {
        return {
          ...current,
          mode,
          projection: {
            haov: projectionSpan(current, "horizontal"),
            vaov: projectionSpan(current, "vertical"),
            vOffset: 0,
          },
          view: {
            ...current.view,
            minYaw: Math.max(current.view.minYaw, -90),
            maxYaw: Math.min(current.view.maxYaw, 90),
            minPitch: Math.max(current.view.minPitch, -35),
            maxPitch: Math.min(current.view.maxPitch, 35),
          },
        };
      }
      const nextProjection = {
        ...adaptiveProjection(current),
        ...(mode === "flatPhoto"
          ? { horizontalCurvature: 0, verticalCurvature: 0 }
          : {}),
      };
      return { ...current, mode, projection: nextProjection };
    });
    setNotice(`已切换为 ${MODES.find((item) => item.id === mode)?.name}`);
  };

  const applyPreset = (presetId: string) => {
    const preset = EDITOR_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setScene((current) => ({
      ...current,
      mode: preset.mode,
      projection:
        preset.mode === "partialSphere"
          ? { haov: 190, vaov: 82, vOffset: -3 }
          : preset.projection
            ? { ...preset.projection }
            : undefined,
      view: { ...preset.view },
    }));
    setNotice(`已应用“${preset.name}”预设`);
  };

  const chooseSample = (source: string, title: string) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setScene((current) => ({ ...current, source, title }));
    setExportSource(source);
    setNotice(`已载入示例：${title}`);
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (onImageUpload) {
      try {
        setNotice(`正在保存照片：${file.name}`);
        const url = await onImageUpload(file);
        setScene((current) => ({
          ...current,
          title: file.name.replace(/\.[^.]+$/, ""),
          source: url,
        }));
        setExportSource(url);
        setNotice(`照片已保存：${file.name}`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "照片保存失败");
      }
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const safeName = file.name.replace(/\s+/g, "-");
    setScene((current) => ({
      ...current,
      id: safeName.replace(/\.[^.]+$/, "") || "local-scene",
      title: file.name.replace(/\.[^.]+$/, ""),
      source: url,
    }));
    setExportSource(`/images/${safeName}`);
    setNotice(`已载入本地照片：${file.name}`);
  };

  const importConfig = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = validateScene(JSON.parse(await file.text()));
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setScene(imported);
      setExportSource(imported.source);
      setNotice(`已导入配置：${file.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "配置导入失败");
    }
    event.target.value = "";
  };

  const saveDraft = async () => {
    if (saveFeedback === "saving") return;
    if (saveFeedbackTimerRef.current) window.clearTimeout(saveFeedbackTimerRef.current);
    setSaveFeedback("saving");
    if (onSave) {
      try {
        setNotice("正在保存项目参数");
        const sceneToSave = {
          ...scene,
          view: { ...scene.view, ...liveViewRef.current },
        };
        await onSave(sceneToSave);
        setScene(sceneToSave);
        setNotice("投影参数已保存");
        setSaveFeedback("saved");
        saveFeedbackTimerRef.current = window.setTimeout(() => setSaveFeedback("idle"), 4000);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "项目参数保存失败");
        setSaveFeedback("error");
        saveFeedbackTimerRef.current = window.setTimeout(() => setSaveFeedback("idle"), 6000);
      }
      return;
    }
    try {
      localStorage.setItem("memoscape-lab-editor-draft", exportJson);
      setNotice("草稿已保存");
      setSaveFeedback("saved");
      saveFeedbackTimerRef.current = window.setTimeout(() => setSaveFeedback("idle"), 4000);
    } catch {
      setNotice("草稿保存失败");
      setSaveFeedback("error");
      saveFeedbackTimerRef.current = window.setTimeout(() => setSaveFeedback("idle"), 6000);
    }
  };

  const saveButtonLabel = saveFeedback === "saving"
    ? "保存中…"
    : saveFeedback === "saved"
      ? "✓ 已保存"
      : onSave
        ? "保存项目"
        : "保存草稿";

  const restoreDraft = () => {
    const draft = localStorage.getItem("memoscape-lab-editor-draft")
      ?? localStorage.getItem("adaptive-pannellum-editor-draft");
    if (!draft) {
      setNotice("当前设备上没有已保存草稿");
      return;
    }
    try {
      const restored = validateScene(JSON.parse(draft));
      setScene(restored);
      setExportSource(restored.source);
      setNotice("已恢复设备草稿");
    } catch {
      setNotice("草稿格式无效，无法恢复");
    }
  };

  const copyConfig = async () => {
    await navigator.clipboard.writeText(exportJson);
    setNotice("配置 JSON 已复制");
  };

  const resetConfig = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setScene(startingScene);
    setExportSource(startingScene.source);
    setNotice("已恢复编辑器默认参数");
  };

  return (
    <main className={`editor-shell ${embedded ? "editor-embedded" : ""}`}>
      <header className="editor-header">
        <div className="editor-brand">
          <BrandMark className="brand-mark" tone="on-dark" />
          <span>
            <strong>MemoscapeLab</strong>
            <small>投影调参工作台 / EDITOR 02</small>
          </span>
        </div>
        <div className="editor-header-actions">
          <span className="autosave-status">
            <i />
            {notice}
          </span>
          <button
            className="primary-action"
            type="button"
            disabled={saveFeedback === "saving"}
            aria-busy={saveFeedback === "saving"}
            onClick={() => void saveDraft()}
          >
            {saveButtonLabel}
          </button>
        </div>
      </header>

      <section className="editor-workspace">
        <aside className="asset-panel">
          <div className="panel-title">
            <span>照片与预设</span>
            <small>ASSETS</small>
          </div>

          {embedded ? (
            <div className="asset-section original-photo-section">
              <div className="asset-section-heading">
                <span>历史照片原照</span>
                <small>ORIGINAL</small>
              </div>
              {originalImageUrl ? (
                <button
                  type="button"
                  className="original-photo-card"
                  onClick={() => setOriginalPreviewOpen(true)}
                  aria-label={`放大查看${originalImageTitle}`}
                >
                  {/* User-uploaded and local archive images intentionally bypass optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalImageThumbnailUrl || originalImageUrl} alt={originalImageTitle} />
                  <span>点击放大浏览</span>
                </button>
              ) : (
                <div className="original-photo-empty">尚未上传历史原照</div>
              )}
            </div>
          ) : (
            <>
              <div className="upload-zone">
                <span className="upload-symbol" aria-hidden="true">
                  +
                </span>
                <strong>载入待调照片</strong>
                <p>支持 JPG、PNG、WebP，本地处理不上传</p>
                <button type="button" onClick={() => uploadInputRef.current?.click()}>
                  选择照片
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={uploadImage}
                  hidden
                />
              </div>

              <div className="asset-section">
                <div className="asset-section-heading">
                  <span>示例照片</span>
                  <small>2</small>
                </div>
                <div className="sample-grid">
                  {SAMPLE_IMAGES.map((image) => (
                    <button
                      type="button"
                      className={`sample-image ${scene.source === image.source ? "is-active" : ""}`}
                      key={image.source}
                      onClick={() => chooseSample(image.source, image.title)}
                    >
                      <span
                        style={{ backgroundImage: `url(${image.source})` }}
                        aria-hidden="true"
                      />
                      <strong>{image.title}</strong>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="asset-section preset-section">
            <div className="asset-section-heading">
              <span>投影预设</span>
              <small>{EDITOR_PRESETS.length}</small>
            </div>
            <div className="preset-list">
              {EDITOR_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => applyPreset(preset.id)}
                >
                  <span className="preset-mark" />
                  <span>
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="asset-footer">
            <button type="button" onClick={restoreDraft}>
              恢复草稿
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()}>
              导入配置
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={importConfig}
              hidden
            />
          </div>
        </aside>

        <section className="preview-column">
          {embedded ? (
            <div className="compact-preview-toolbar">
              <span className={`renderer-status status-${status}`}>
                <i />
                YAW {liveView.yaw.toFixed(1)}° · PITCH {liveView.pitch.toFixed(1)}° · HFOV {liveView.hfov.toFixed(1)}°
              </span>
              <div>
                <button type="button" onClick={() => adjustZoom(5)} aria-label="缩小视图" title="缩小">−</button>
                <button type="button" onClick={() => adjustZoom(-5)} aria-label="放大视图" title="放大">＋</button>
                <button type="button" onClick={() => previewShellRef.current?.requestFullscreen()}>全屏</button>
              </div>
            </div>
          ) : (
            <div className="preview-toolbar">
              <div className="mode-switcher" aria-label="投影模式">
                {MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode.id}
                    className={scene.mode === mode.id ? "is-active" : ""}
                    onClick={() => changeMode(mode.id)}
                    title={mode.name}
                  >
                    <span>{mode.short}</span>
                    {mode.name}
                  </button>
                ))}
              </div>
              <div className="preview-tools">
                <button
                  type="button"
                  className={guidesVisible ? "is-active" : ""}
                  onClick={() => setGuidesVisible((visible) => !visible)}
                >
                  辅助线
                </button>
                <div className="device-switcher">
                  {(["desktop", "tablet", "mobile"] as PreviewDevice[]).map(
                    (item) => (
                      <button
                        type="button"
                        key={item}
                        className={device === item ? "is-active" : ""}
                        onClick={() => setDevice(item)}
                        aria-label={`${item}预览`}
                      >
                        {item === "desktop"
                          ? "桌面"
                          : item === "tablet"
                            ? "平板"
                            : "手机"}
                      </button>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => previewShellRef.current?.requestFullscreen()}
                >
                  全屏
                </button>
              </div>
            </div>
          )}

          <div className="preview-stage">
            <div
              ref={previewShellRef}
              className={`preview-device preview-${device}`}
            >
              <div ref={previewRef} className="editor-render-target" />
              {guidesVisible && !embedded && (
                <div className="projection-guides" aria-hidden="true">
                  <span className="guide-center-x" />
                  <span className="guide-center-y" />
                  <span
                    className="guide-horizon"
                    style={{ top: `${projection.horizonY * 100}%` }}
                  />
                  <span className="guide-safe-area" />
                </div>
              )}
              {!embedded && <div className="preview-readout">
                <span className={`renderer-status status-${status}`}>
                  <i />
                  {statusMessage}
                </span>
                <span>
                  YAW {liveView.yaw.toFixed(1)}° / PITCH{" "}
                  {liveView.pitch.toFixed(1)}° / HFOV{" "}
                  {liveView.hfov.toFixed(1)}°
                </span>
              </div>}
              {!embedded && <div className="preview-scene-label">
                <small>{scene.mode}</small>
                <strong>{scene.title}</strong>
              </div>}
            </div>
          </div>

          {!embedded && <div className="projection-summary">
            <div>
              <small>水平覆盖</small>
              <strong>{projectionSpan(scene, "horizontal").toFixed(0)}°</strong>
            </div>
            <div>
              <small>垂直覆盖</small>
              <strong>{projectionSpan(scene, "vertical").toFixed(0)}°</strong>
            </div>
            <div>
              <small>水平曲率</small>
              <strong>
                {isAdaptive
                  ? `${(projection.horizontalCurvature * 100).toFixed(0)}%`
                  : "原生"}
              </strong>
            </div>
            <div>
              <small>垂直曲率</small>
              <strong>
                {isAdaptive
                  ? `${(projection.verticalCurvature * 100).toFixed(0)}%`
                  : "原生"}
              </strong>
            </div>
            <div>
              <small>边缘方式</small>
              <strong>{isAdaptive ? projection.edgeMode : "视域限制"}</strong>
            </div>
          </div>}
        </section>

        <aside className="parameter-panel">
          <div className="panel-title">
            <span>参数控制</span>
            <small>LIVE</small>
          </div>

          <div className="parameter-scroll">
            <ParameterGroup title="投影覆盖" badge="PROJECTION">
              <RangeField
                label="水平覆盖角"
                value={projectionSpan(scene, "horizontal")}
                min={60}
                max={scene.mode === "sphere360" ? 360 : 280}
                suffix="°"
                hint="整张照片横向对应的视角"
                disabled={scene.mode === "sphere360"}
                onChange={(value) => updateSpan("horizontal", value)}
              />
              <RangeField
                label="垂直覆盖角"
                value={projectionSpan(scene, "vertical")}
                min={30}
                max={180}
                suffix="°"
                hint="避免顶部和底部被拉向极点"
                disabled={scene.mode === "sphere360"}
                onChange={(value) => updateSpan("vertical", value)}
              />
              {scene.mode === "partialSphere" &&
                isPartialSphereProjection(scene.projection) && (
                  <RangeField
                    label="垂直偏移"
                    value={scene.projection.vOffset}
                    min={-40}
                    max={40}
                    suffix="°"
                    onChange={(value) =>
                      setScene((current) => ({
                        ...current,
                        projection: isPartialSphereProjection(
                          current.projection,
                        )
                          ? { ...current.projection, vOffset: value }
                          : current.projection,
                      }))
                    }
                  />
                )}
            </ParameterGroup>

            <ParameterGroup title="曲率混合" badge="CURVATURE">
              <RangeField
                label="水平曲率"
                value={projection.horizontalCurvature}
                min={0}
                max={1}
                step={0.01}
                hint="0 平面 / 1 圆柱"
                disabled={!isAdaptive}
                onChange={(value) =>
                  updateAdaptive("horizontalCurvature", value)
                }
              />
              <RangeField
                label="垂直曲率"
                value={projection.verticalCurvature}
                min={0}
                max={1}
                step={0.01}
                hint="0 垂直平面 / 1 球面"
                disabled={!isAdaptive}
                onChange={(value) =>
                  updateAdaptive("verticalCurvature", value)
                }
              />
              <RangeField
                label="边缘压缩"
                value={projection.edgeCompression}
                min={0}
                max={0.4}
                step={0.01}
                hint="减轻两侧建筑横向拉宽"
                disabled={!isAdaptive}
                onChange={(value) => updateAdaptive("edgeCompression", value)}
              />
            </ParameterGroup>

            <ParameterGroup title="构图校正" badge="ALIGNMENT">
              <RangeField
                label="视觉中心 X"
                value={projection.centerX}
                min={0}
                max={1}
                step={0.005}
                disabled={!isAdaptive}
                onChange={(value) => updateAdaptive("centerX", value)}
              />
              <RangeField
                label="视觉中心 Y"
                value={projection.centerY}
                min={0}
                max={1}
                step={0.005}
                disabled={!isAdaptive}
                onChange={(value) => updateAdaptive("centerY", value)}
              />
              <RangeField
                label="地平线位置"
                value={projection.horizonY}
                min={0}
                max={1}
                step={0.005}
                disabled={!isAdaptive}
                onChange={(value) => updateAdaptive("horizonY", value)}
              />
            </ParameterGroup>

            <ParameterGroup title="视角边界" badge="VIEW LIMITS">
              <RangeField
                label="默认 Yaw"
                value={scene.view.yaw}
                min={scene.view.minYaw}
                max={scene.view.maxYaw}
                suffix="°"
                onChange={(value) => updateView("yaw", value)}
              />
              <div className="range-pair">
                <RangeField
                  label="最小 Yaw"
                  value={scene.view.minYaw}
                  min={-180}
                  max={0}
                  suffix="°"
                  onChange={(value) => updateView("minYaw", value)}
                />
                <RangeField
                  label="最大 Yaw"
                  value={scene.view.maxYaw}
                  min={0}
                  max={180}
                  suffix="°"
                  onChange={(value) => updateView("maxYaw", value)}
                />
              </div>
              <div className="range-pair">
                <RangeField
                  label="最小 Pitch"
                  value={scene.view.minPitch}
                  min={-90}
                  max={0}
                  suffix="°"
                  onChange={(value) => updateView("minPitch", value)}
                />
                <RangeField
                  label="最大 Pitch"
                  value={scene.view.maxPitch}
                  min={0}
                  max={90}
                  suffix="°"
                  onChange={(value) => updateView("maxPitch", value)}
                />
              </div>
              <RangeField
                label="默认视场 HFOV"
                value={scene.view.hfov}
                min={scene.view.minHfov}
                max={scene.view.maxHfov}
                suffix="°"
                onChange={(value) => updateView("hfov", value)}
              />
              <div className="range-pair">
                <RangeField
                  label="最小 HFOV"
                  value={scene.view.minHfov}
                  min={20}
                  max={70}
                  suffix="°"
                  onChange={(value) => updateView("minHfov", value)}
                />
                <RangeField
                  label="最大 HFOV"
                  value={scene.view.maxHfov}
                  min={70}
                  max={140}
                  suffix="°"
                  onChange={(value) => updateView("maxHfov", value)}
                />
              </div>
            </ParameterGroup>

            <ParameterGroup title="边缘处理" badge="EDGES">
              <label className="select-field">
                <span>
                  <strong>边缘模式</strong>
                  <small>控制照片范围外的显示方式</small>
                </span>
                <select
                  value={projection.edgeMode}
                  disabled={!isAdaptive}
                  onChange={(event) =>
                    updateAdaptive("edgeMode", event.target.value as EdgeMode)
                  }
                >
                  <option value="clamp">Clamp 截止</option>
                  <option value="feather">Feather 渐隐</option>
                  <option value="background">Background 背景</option>
                  <option value="mirror">Mirror 镜像</option>
                  <option value="wrap">Wrap 循环</option>
                </select>
              </label>
              <RangeField
                label="边缘渐隐宽度"
                value={projection.edgeFeather}
                min={0}
                max={0.2}
                step={0.005}
                disabled={!isAdaptive || projection.edgeMode !== "feather"}
                onChange={(value) => updateAdaptive("edgeFeather", value)}
              />
            </ParameterGroup>

            <details className="json-inspector">
              <summary>查看当前配置 JSON</summary>
              <pre>{exportJson}</pre>
            </details>
          </div>

          <div className="parameter-actions">
            <button type="button" onClick={resetConfig}>
              恢复默认
            </button>
            <button type="button" onClick={copyConfig}>
              复制配置
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={saveFeedback === "saving"}
              aria-busy={saveFeedback === "saving"}
              onClick={() => void saveDraft()}
            >
              {saveButtonLabel}
            </button>
          </div>
        </aside>
      </section>
      {saveFeedback !== "idle" && (
        <div
          className={`editor-save-feedback is-${saveFeedback}`}
          role={saveFeedback === "error" ? "alert" : "status"}
          aria-live="assertive"
        >
          <b aria-hidden="true">
            {saveFeedback === "saving" ? "···" : saveFeedback === "saved" ? "✓" : "!"}
          </b>
          <span>
            <strong>
              {saveFeedback === "saving" ? "正在保存" : saveFeedback === "saved" ? "保存成功" : "保存失败"}
            </strong>
            <small>{saveFeedback === "error" ? notice : saveFeedback === "saved" ? "投影参数已写入项目" : "请稍候"}</small>
          </span>
        </div>
      )}
      {embedded && originalPreviewOpen && originalImageUrl && (
        <div
          className="original-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`放大查看${originalImageTitle}`}
          onClick={() => setOriginalPreviewOpen(false)}
        >
          <button type="button" onClick={() => setOriginalPreviewOpen(false)} aria-label="关闭原照预览">×</button>
          {/* The lightbox preserves the original image bytes and dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={originalImageUrl} alt={originalImageTitle} onClick={(event) => event.stopPropagation()} />
          <span>{originalImageTitle}</span>
        </div>
      )}
    </main>
  );
}
