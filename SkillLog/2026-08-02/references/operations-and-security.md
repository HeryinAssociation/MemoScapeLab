# 本地运行、账号与安全

## 常用命令

从 `../app` 运行：

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test` 会先构建，再运行全部 Node 测试。开发服务器可能因端口占用从 3000 自动切换；只使用终端实际输出的地址。

## 本地配置

- `.dev.vars.example` 只保存占位符和非敏感默认值。
- `.dev.vars` 已存在且被 Git 忽略；把它视为敏感文件，不要输出全文。
- 当前关键变量包括 `PASSWORD_PEPPER`、超级管理员初始化变量、腾讯 SES 密钥、地区、发件地址和模板 ID。
- 修改 `.dev.vars` 后重启开发服务器，确保 Worker 载入新值。
- 托管环境使用 Secret，不要把本地 `.dev.vars` 上传或提交。

## Pepper 规则

- Pepper 是服务器级共享秘密；Salt 是每个密码独立且可随摘要存储的数据。
- 任何 Pepper 变化都会使所有既有密码摘要失效。不要把“更新环境变量”误认为无影响配置修改。
- 若 Pepper 已变化，撤销现有 Session，并通过受控密码重置为每个账号生成新摘要。
- 重置时必须使用运行环境将实际读取的 Pepper；不要在脱离环境的脚本中默认使用空字符串。
- 不要在日志、命令输出、Skill 或聊天回复中保存 Pepper。

## 超级管理员恢复

1. 先确认操作目标是本地 D1，而非远程数据库。
2. 确认 `superadmin` 仍为 `active`、`email_verified = 1`。
3. 从 `.dev.vars` 安全读取当前 Pepper，不输出该值。
4. 生成强随机临时密码，使用项目的 `hashPassword` 创建摘要。
5. 原子更新密码摘要并设 `must_change_password = 1`。
6. 删除该用户 Session 和对应登录锁定记录。
7. 使用正在运行的 `/api/auth/login` 验证 HTTP 200，然后立即调用登出接口清理测试 Session。
8. 只向用户显示新临时密码一次；不要把它写入本 Skill 或仓库。

本日志创建时已完成一次上述验证，但不保存临时密码。

## 腾讯 SES

- 发信域名：`mail.metaconstr.net`。
- 发件地址：`verify@mail.metaconstr.net`。
- 使用 `SendEmail`、版本 `2020-10-02`、默认地区 `ap-guangzhou`、触发类型 `1`。
- 使用已审核模板及 `{{code}}` 变量；HTML 模板位于 `../app/docs/tencent-ses-email-verification-template.html`。
- 一组早期密钥已在聊天中暴露，必须保持禁用；不得从聊天历史复制使用。
- 只使用用户后来写入 `.dev.vars` 的轮换密钥，并且不要读取或输出其值。
- 在模板审核和模板 ID 有效后再做真实发信测试；测试时只向用户明确授权的邮箱发送。

## 数据与工作区保护

- 本地 Miniflare D1/R2 状态位于 `../app/.wrangler/state/`，数据库文件名可能变化，不要长期硬编码哈希文件名。
- 在修改本地 D1 前先解析绝对路径并确认它位于 `../app` 内。
- 不要删除 `.wrangler/state` 来“修复”登录，这会丢失本地用户与项目数据。
- 当前 Git 工作区是脏的；修改前检查状态，不要使用 `git reset --hard`、`git checkout --` 或批量清理。
- 删除用户账号、R2 文件或数据库数据前必须确认精确目标与授权范围。
