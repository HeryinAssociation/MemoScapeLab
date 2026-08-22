"use client";

import { useEffect, useRef, useState } from "react";

const GUIDE_STEPS = [
  {
    eyebrow: "WELCOME / 01",
    title: "欢迎来到 MemoScapeLab",
    body: "接下来的 60 秒，我会带你看懂一张历史照片如何变成可浏览的沉浸式影像。所有步骤都能回退，也可以稍后重看。",
    note: "你的项目、原图和参数都会按账号独立保存。",
    art: "/guide/oc-normal.jpg",
    artLabel: "档案向导向你问好",
    scene: "welcome",
  },
  {
    eyebrow: "PROJECT ARCHIVE / 02",
    title: "一切从一个照片项目开始",
    body: "项目库是你的档案入口。每个项目会一起保存历史原图、生成全景、文字资料和完整投影参数。",
    note: "点击“新建照片项目”，就能建立第一份影像档案。",
    art: "/guide/oc-idea.jpg",
    artLabel: "档案向导提出一个新项目",
    scene: "archive",
  },
  {
    eyebrow: "FOUR-STEP FLOW / 03",
    title: "沿着四步工作流完成作品",
    body: "界面顶部会一直显示当前进度。你可以随时返回上一步补资料或重新调整，不必一次做完。",
    note: "如果已经有宽幅或全景照片，可以上传后直接进入投影调参。",
    art: "/guide/oc-idea.jpg",
    artLabel: "档案向导解释四步工作流",
    scene: "workflow",
  },
  {
    eyebrow: "SOURCE & GENERATION / 04",
    title: "先保留原档，再决定如何扩展",
    body: "历史原图是档案依据；已有宽幅或全景图也可以一并上传。需要扩展时，再用原图发起 AI 全景生成。",
    note: "生成通常需要 10–60 秒，完成后会自动保存。请只使用你有权处理与发布的影像。",
    art: "/guide/oc-annoy.jpg",
    artLabel: "档案向导提醒你留意生成与版权",
    scene: "safeguard",
  },
  {
    eyebrow: "REVIEW & PUBLISH / 05",
    title: "先保存草稿，确认后再发布",
    body: "项目默认保持草稿。完成投影调参后，先在预览页检查浏览范围和文字资料，再决定是否公开。",
    note: "发布后会获得公开访问地址；你仍可以随时撤回并继续修改。",
    art: "/guide/oc-normal.jpg",
    artLabel: "档案向导邀请你创建第一个项目",
    scene: "release",
  },
] as const;

function ScenePreview({ scene }: { scene: (typeof GUIDE_STEPS)[number]["scene"] }) {
  if (scene === "welcome") {
    return (
      <div className="guide-welcome-facts" aria-label="引导信息">
        <span><b>≈ 60</b><small>秒</small></span>
        <span><b>05</b><small>个提示</small></span>
        <span><b>∞</b><small>随时重看</small></span>
      </div>
    );
  }

  if (scene === "archive") {
    return (
      <div className="guide-project-card" aria-label="项目卡片示意">
        <div><small>ML—001</small><span>草稿</span></div>
        <strong>1991 年外滩</strong>
        <p>原图 ✓　全景 —　步骤 1/4</p>
      </div>
    );
  }

  if (scene === "workflow") {
    return (
      <ol className="guide-workflow" aria-label="四步工作流">
        <li><b>01</b><span>上传照片<small>原图与档案资料</small></span></li>
        <li><b>02</b><span>生成全景<small>可选的 AI 扩展</small></span></li>
        <li><b>03</b><span>投影调参<small>校准浏览效果</small></span></li>
        <li><b>04</b><span>预览发布<small>检查后再公开</small></span></li>
      </ol>
    );
  }

  if (scene === "safeguard") {
    return (
      <div className="guide-source-flow" aria-label="原图与全景图关系">
        <span><b>ORIGINAL</b><small>历史原图 · 档案依据</small></span>
        <i>→</i>
        <span><b>PANORAMA</b><small>上传已有或 AI 生成</small></span>
      </div>
    );
  }

  return (
    <div className="guide-release-states" aria-label="项目发布状态">
      <span><i />草稿<small>仅自己可见</small></span>
      <b>→ 检查预览 →</b>
      <span className="is-published"><i />已发布<small>可撤回修改</small></span>
    </div>
  );
}

export function OnboardingGuide({
  username,
  onComplete,
}: {
  username: string;
  onComplete: (startProject?: boolean) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = GUIDE_STEPS[stepIndex];
  const isLast = stepIndex === GUIDE_STEPS.length - 1;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);

  return (
    <div className="onboarding-backdrop">
      <section
        className={`onboarding-dialog is-${step.scene}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
      >
        <button className="onboarding-skip" type="button" onClick={() => onComplete()}>
          跳过引导 <span aria-hidden="true">×</span>
        </button>

        <div className="onboarding-art-panel" aria-hidden="true">
          <span className="onboarding-art-index">OC / {String(stepIndex + 1).padStart(2, "0")}</span>
          <div className="onboarding-orbit" />
          <img src={step.art} alt="" />
          <small>{step.artLabel}</small>
        </div>

        <div className="onboarding-copy-panel">
          <div className="onboarding-progress" aria-label={`第 ${stepIndex + 1} 步，共 ${GUIDE_STEPS.length} 步`}>
            {GUIDE_STEPS.map((item, index) => (
              <span className={index <= stepIndex ? "is-active" : ""} key={item.eyebrow} />
            ))}
          </div>
          <span className="onboarding-eyebrow">{step.eyebrow}</span>
          <h2 id="onboarding-title" ref={headingRef} tabIndex={-1}>
            {stepIndex === 0 ? `${username}，` : ""}{step.title}
          </h2>
          <p id="onboarding-body">{step.body}</p>
          <ScenePreview scene={step.scene} />
          <div className="onboarding-note"><span>TIP</span><p>{step.note}</p></div>

          <footer className="onboarding-actions">
            <span>{String(stepIndex + 1).padStart(2, "0")} / {String(GUIDE_STEPS.length).padStart(2, "0")}</span>
            <div>
              {stepIndex > 0 && <button type="button" onClick={() => setStepIndex((value) => value - 1)}>上一步</button>}
              {!isLast && <button className="is-primary" type="button" onClick={() => setStepIndex((value) => value + 1)}>继续 <b>→</b></button>}
              {isLast && <button type="button" onClick={() => onComplete()}>完成引导</button>}
              {isLast && <button className="is-primary" type="button" onClick={() => onComplete(true)}>创建第一个项目 <b>→</b></button>}
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
