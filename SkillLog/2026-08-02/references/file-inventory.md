# 工作区文件清单

以下清单记录创建本 Skill 时 `../app` 的工作区状态。它不是提交边界；所有内容均应视为需要保留的用户工作。

## 已修改的跟踪文件

- `.gitignore`
- `.openai/hosting.json`
- `README.md`
- `app/globals.css`
- `app/layout.tsx`
- `app/page.tsx`
- `app/viewer-app.tsx`
- `package.json`
- `public/configs/laozao-shanghai-001.json`
- `src/core/projection-types.ts`
- `src/core/render-router.ts`
- `src/core/scene-validator.ts`
- `src/pannellum/pannellum-adapter.ts`
- `tests/rendered-html.test.mjs`
- `tests/scene-validator.test.ts`
- `worker/index.ts`

## 有意删除或替换

- `package-lock.json` 已删除，由 `pnpm-lock.yaml` 替代。

## 新增的主要文件和目录

- `.dev.vars.example`、`.npmrc`、`pnpm-lock.yaml`
- `app/admin-shell.tsx`、`app/editor-app.tsx`
- `app/login/`、`app/reg/`、`app/verify-email/`
- `app/proj/`、`app/work/`、`app/viewer/`
- `app/usr/`、`app/usradmin/`
- `db/`、`drizzle/`、`docs/`
- `src/adaptive/`、`src/auth/`、`src/editor/`、`src/projects/`
- `worker/auth.ts`、`worker/tencent-ses.ts`
- `tests/auth.test.ts`、`tests/adaptive-renderer.test.ts`
- `tests/bundled-projects.test.ts`、`tests/editor-presets.test.ts`
- `public/images/data.json` 与两张导入历史原图
- `public/og-editor.png`、`public/shanghai-editor-scene.json`

## 本地生成与敏感状态

- `.dev.vars` 存在但被忽略，包含敏感配置；不得加入清单内容、补丁或日志正文。
- `.wrangler/` 保存本地 D1/R2 状态并被忽略，不要删除。
- `dist/`、`.vinext/`、`tsconfig.tsbuildinfo` 等属于构建或工具生成状态。

继续工作时重新运行 `git status --short`；若它与本清单不同，以实时状态为准，并判断新增差异是否属于用户后续工作。
