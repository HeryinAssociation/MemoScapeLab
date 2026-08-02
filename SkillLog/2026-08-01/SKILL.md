---
name: "2026-08-01"
description: Restore the Adaptive Pannellum development context recorded in the 2026-08-01 handoff log. Use when continuing, reviewing, debugging, documenting, or extending the sibling app after its adaptive panorama renderer, visual calibration editor, D1/R2 project management, four-step workbench, database-backed Viewer, and light blueprint UI work.
---

# Adaptive Pannellum 开发日志 · 2026-08-01

把本 Skill 作为兄弟目录 `../app` 的开发接手日志。实时源码与数据库状态和本日志冲突时，以实时状态为准。

## 恢复上下文

1. 将应用根目录解析为本 Skill 的兄弟目录 `../app`。
2. 先阅读 [references/change-log.md](references/change-log.md)，确认已经完成的产品与界面改造。
3. 修改渲染、项目、数据库或路由前，阅读 [references/implementation-map.md](references/implementation-map.md)。
4. 启动、测试、处理本地数据或认证配置前，阅读 [references/operations.md](references/operations.md)。
5. 编辑前检查实时文件与 `git status --short`。把所有未提交修改视为需要保留的用户工作。

## 继续开发

- 保持 React 19、Vinext、Vite、Cloudflare Worker、D1 和 R2 架构，除非用户明确要求迁移。
- 保持 D1 为项目元数据和完整场景 JSON 的结构化真源，保持 R2 用于上传图片与其他二进制素材。
- 继续使用四种投影模式：`sphere360`、`partialSphere`、`curvedPhoto`、`flatPhoto`。
- 保持 `/proj`、`/work` 和 `/viewer?id=…` 读取同一项目数据；不要重新引入与数据库脱节的示例 Viewer。
- 保持调参器、项目页和发布预览的黄白设计图纸视觉语言；全景画布本身可保留深色承载背景。
- 保持发布动作禁用，直到用户明确开始构建面向访客的前端与发布权限流程。
- 不要部署；截至本日志，用户只要求本地构建。

## 验证改动

从 `../app` 使用当前锁文件对应的 pnpm 工作流：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

仅需验证打包时可运行 `pnpm build`。修复真实错误后再交付，不要用删除本地 D1/R2 状态的方式处理运行问题。
