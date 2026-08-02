# 本地运行、安全与继续工作

## 本地命令

从 `../app` 运行：

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
```

开发地址以终端实际输出为准。不要从 `AdaptivePannellum` 父目录运行开发命令，应用清单位于 `../app/package.json`。

## 数据持久化

- 本地 D1/R2 状态通常位于 `../app/.wrangler/state/`。
- 不要删除 `.wrangler/state` 来解决接口、登录或项目问题；这会丢失本地数据库与素材状态。
- 修改表结构时同步维护 `db/schema.ts` 与 `drizzle/` 迁移文件。
- 项目数据以 D1 中的 `scene_json` 为准；浏览器存储只能用于非权威的设备偏好或临时草稿。

## 工作区保护

- 当前工作区包含大量未提交修改和新增文件；执行任何编辑前先运行 `git status --short`。
- 不要使用 `git reset --hard`、`git checkout --` 或批量清理覆盖用户工作。
- 不要恢复 `package-lock.json`；实时项目已切换为 `pnpm-lock.yaml`。
- 删除项目、用户、R2 素材或数据库数据前确认精确目标和授权。

## 机密信息

- `.dev.vars` 属于敏感本地配置，不得把其内容写入 Skill、日志、补丁或回复。
- 不要记录密码、Password Pepper、Session Token、邮箱验证码或云服务密钥。
- 如果实时源码启用了用户系统，保持服务端 Session、CSRF、项目所有权和角色校验；不要只在前端隐藏入口。

## 已知后续事项

- AI 全景生成仍为占位，需要后续接入用户自定义模型 API。
- 真实前端发布与可见性管理仍未实现，发布按钮必须保持禁用。
- 用户自定义大模型 API 设置窗口尚待后续构建。
- 手机验证码等认证扩展以实时源码和最新任务为准。

## 交付前验证

优先运行 `pnpm typecheck` 与相关测试；涉及路由、Worker、渲染或样式的完整改动运行 `pnpm test`。记录通过/失败事实，不要把历史测试数量当作永久保证。
