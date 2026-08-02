# 实现地图

## 技术边界

- 应用根目录：`../app`
- 前端：React 19、Next App Router 兼容接口、Vinext、Vite
- 服务端：Cloudflare Worker
- 结构化数据：D1，逻辑绑定 `DB`
- 图片和二进制素材：R2，逻辑绑定 `MEDIA`
- 当前包管理器：pnpm；不要恢复已移除的 npm 锁文件

## 核心路由

| 路径 | 作用 |
| --- | --- |
| `/proj` | 项目卡片列表与项目入口 |
| `/work?id=…` | 上传、生成预留、投影调参、发布预览四步工作流 |
| `/viewer?id=…` | 从项目数据库读取参数的单项目 Viewer |

实时源码还可能包含 `/login`、`/reg`、`/verify-email`、`/usr` 和 `/usradmin`。如果这些路由存在，保留服务端访问控制和项目所有权校验。

## 关键文件

- `../app/app/editor-app.tsx`：可视化调参器、预设、上传、JSON 与保存回调。
- `../app/app/work/workbench-app.tsx`：四步工作流、项目保存、Viewer 发布预览。
- `../app/app/proj/projects-app.tsx`：项目卡片列表。
- `../app/app/viewer-app.tsx`：数据库项目读取和单项目渲染。
- `../app/app/admin-shell.tsx`：管理后台左侧 AppBar。
- `../app/app/globals.css`：项目页、工作台、调参器与 Viewer 的设计图纸主题。
- `../app/worker/index.ts`：Worker 入口、项目和素材 API、数据库初始化。
- `../app/db/schema.ts`：D1 表和索引定义。
- `../app/drizzle/`：数据库迁移快照。
- `../app/src/core/`：投影类型、场景校验、加载和渲染路由。
- `../app/src/adaptive/`：WebGL 曲面/平面照片渲染器与着色器。
- `../app/src/editor/`：预设和配置导出。
- `../app/src/projects/`：项目类型以及实时源码中的内置项目数据。

## 项目数据流

1. `/proj` 调用项目列表 API。
2. 项目卡片链接到 `/work?id=项目ID`。
3. `/work` 读取项目、恢复 `scene` 和元数据。
4. 上传图片时先写入 R2，再把返回的稳定 URL 写入项目。
5. 调参器通过 `onSceneChange` 把最新场景同步给工作台，通过 `onSave` 写入 D1。
6. 打开发布预览前再次持久化场景。
7. 嵌入式 Viewer 使用项目 ID 重新读取数据库，确保展示的是已保存参数。

## 投影模式

- `sphere360`：Pannellum 完整球面。
- `partialSphere`：Pannellum 有限球面，使用 `haov`、`vaov`、`vOffset`。
- `curvedPhoto`：自适应 WebGL 弧形照片。
- `flatPhoto`：自适应 WebGL 平面宽幅照片。

不要绕过 `scene-validator` 强制接受场景 JSON。修改投影结构时同步更新类型、校验器、渲染路由、预设和测试。
