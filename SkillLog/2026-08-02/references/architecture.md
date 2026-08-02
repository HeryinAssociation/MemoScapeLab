# 当前架构

## 技术边界

- 应用根目录：本 Skill 的兄弟目录 `../app`。
- 前端：React 19、Next App Router API 兼容层、Vinext、Vite。
- 服务端：`app/worker/index.ts` Cloudflare Worker 入口。
- 结构化数据：D1，绑定名 `DB`。
- 图片与头像：R2，绑定名 `MEDIA`。
- 包管理：pnpm；不要重新生成 npm lockfile。

## 路由

| 路径 | 作用 | 访问条件 |
| --- | --- | --- |
| `/` | 状态分流 | 根据 Session、改密与邮箱验证状态跳转 |
| `/login` | 登录 | 匿名用户 |
| `/reg` | 注册 | 匿名用户 |
| `/verify-email` | 邮箱验证码或兼容验证链接 | 未验证登录用户；旧链接模式可匿名 |
| `/proj` | 用户项目列表 | 已登录、已验证、无需强制改密 |
| `/work` | 四步项目工作台 | 同 `/proj` |
| `/viewer` | 项目 Viewer | 根据项目发布与所有权判断 |
| `/usr` | 用户设置与强制改密 | 已登录；允许未验证用户 |
| `/usradmin` | 用户管理 | 已验证超级管理员 |

## 关键文件

- `app/worker/index.ts`：数据库初始化、路由守卫、项目与素材 API、Worker 入口。
- `app/worker/auth.ts`：注册登录、Session、Cookie、CSRF、密码、邮箱验证、用户和管理员 API。
- `app/worker/tencent-ses.ts`：腾讯 SES 请求体、TC3 签名和发送。
- `app/db/schema.ts`：用户、Session、验证令牌、审计、登录尝试和项目表定义。
- `app/drizzle/0001_projects.sql`、`0002_user_auth.sql`：持久化迁移快照。
- `app/src/auth/client.ts`：客户端认证缓存和带 CSRF 的请求封装。
- `app/src/projects/bundled-projects.ts`：两张历史照片及元数据的项目种子。
- `app/src/core/`：投影类型、校验与渲染调度。
- `app/src/adaptive/`：自适应 WebGL 渲染器。
- `app/src/editor/`：编辑器状态和预设。
- `app/app/work/workbench-app.tsx`：四步工作流与投影调参/发布布局。
- `app/app/globals.css`：站点、认证、项目管理与工作台视觉样式。

## D1 关系

- `users 1 → N projects`，外键为 `projects.owner_user_id`。
- `users 1 → N sessions`，服务端仅存 Session Token 的 SHA-256 摘要。
- `users 1 → N email_verification_tokens`，验证码或链接凭证同样只存摘要。
- `admin_audit_logs` 记录管理员对目标用户的敏感操作。
- `auth_attempts` 记录登录和邮箱验证码失败窗口与锁定时间。

## 认证数据流

1. 登录验证 PBKDF2 密码摘要与 Pepper。
2. 服务端生成随机 Session Token，只把摘要写入 D1。
3. 浏览器获得 HttpOnly Cookie；客户端另外保存可读的 CSRF Token。
4. Worker 在每个受保护路由/API重新读取 Session、用户状态、角色、邮箱验证和项目所有权。
5. 登出删除 D1 Session 并过期 Cookie。

## 投影模式

- `sphere360`：Pannellum 完整球面。
- `partialSphere`：Pannellum 有限球面，使用 `haov`、`vaov`、`vOffset`。
- `curvedPhoto`：自适应 WebGL 弧形照片。
- `flatPhoto`：自适应 WebGL 平面宽幅照片。

保留场景 JSON 运行时校验，不要把投影参数直接强制转换后绕过验证器。
