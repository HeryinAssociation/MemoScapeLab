"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { authenticatedFetch, getCurrentAuth, setCurrentAuth, type CurrentUser } from "@/src/auth/client";
import { createWebpThumbnail } from "@/src/images/client-thumbnail";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

export function UserSettingsApp() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [devVerificationUrl, setDevVerificationUrl] = useState("");
  const [devVerificationCode, setDevVerificationCode] = useState("");

  const refresh = async () => {
    const auth = await getCurrentAuth(true);
    setUser(auth.user);
  };

  useEffect(() => {
    getCurrentAuth(true)
      .then((auth) => setUser(auth.user))
      .catch(() => window.location.assign("/login"));
  }, []);

  const updateUsername = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("profile"); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await authenticatedFetch("/api/users/me", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username") }),
      });
      const payload = (await response.json()) as { user?: CurrentUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error ?? "保存失败");
      const auth = await getCurrentAuth();
      setCurrentAuth({ ...auth, user: { ...auth.user, ...payload.user } });
      await refresh(); setMessage("用户名已经更新。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(""); }
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setBusy("avatar"); setError(""); setMessage("");
    try {
      const thumbnail = await createWebpThumbnail(file, file.name, {
        maxWidth: 384,
        maxHeight: 384,
        quality: 0.82,
        square: true,
      });
      const form = new FormData();
      form.set("file", file);
      form.set("thumbnail", thumbnail);
      const response = await authenticatedFetch("/api/users/me/avatar", { method: "POST", body: form });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "头像上传失败");
      await refresh(); setMessage("头像已经更新并保存至图床。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "头像上传失败"); }
    finally { setBusy(""); }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setMessage("");
    // React clears SyntheticEvent.currentTarget after the synchronous handler
    // frame. Keep the actual form node before awaiting the API request.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) { setError("两次输入的新密码不一致。"); return; }
    setBusy("password");
    try {
      const response = await authenticatedFetch("/api/users/me/password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }),
      });
      const payload = (await response.json()) as { csrfToken?: string; error?: string };
      if (!response.ok || !payload.csrfToken) throw new Error(payload.error ?? "密码修改失败");
      const nextUser = { ...user!, mustChangePassword: false };
      setCurrentAuth({ user: nextUser, csrfToken: payload.csrfToken }); setUser(nextUser);
      formElement.reset(); setMessage("密码已经更新，其他设备上的登录状态已解除。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "密码修改失败"); }
    finally { setBusy(""); }
  };

  const resend = async () => {
    setBusy("email"); setError(""); setMessage(""); setDevVerificationUrl(""); setDevVerificationCode("");
    try {
      const response = await authenticatedFetch("/api/auth/resend-verification", { method: "POST" });
      const payload = (await response.json()) as { delivery?: string; devVerificationUrl?: string; devVerificationCode?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "发送失败");
      if (payload.devVerificationUrl) setDevVerificationUrl(payload.devVerificationUrl);
      if (payload.devVerificationCode) setDevVerificationCode(payload.devVerificationCode);
      setMessage(payload.delivery === "not_configured" ? "邮件服务尚未完整配置。" : "新的邮箱验证码已经生成，有效期 30 分钟。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发送失败"); }
    finally { setBusy(""); }
  };

  if (!user) return <main className="settings-page"><div className="settings-loading">正在读取用户资料…</div></main>;

  return (
    <main className="settings-page">
      <header className="admin-topbar settings-topbar"><div><span className="eyebrow">ACCOUNT PROFILE / 用户设置</span><h1>用户设置</h1><p>管理您的公开身份、头像和登录安全。</p></div><div className="user-stats"><div><strong>{user.projectCount ?? 0}</strong><span>已构建项目</span></div><div><strong>{formatDate(user.createdAt)}</strong><span>注册时间</span></div></div></header>
      <div className="settings-content">
        {(message || error) && <div className={`settings-notice ${error ? "is-error" : ""}`}>{error || message}{devVerificationUrl && <a href={devVerificationUrl}>打开本地验证链接</a>}{devVerificationCode && <a href="/verify-email?pending=1">本地验证码：{devVerificationCode}</a>}</div>}
        {user.mustChangePassword && <div className="settings-warning"><b>需要修改密码</b><p>当前密码由管理员或初始化流程设置，请在下方创建您的个人密码。</p></div>}
        <section className="settings-card profile-settings-card">
          <div className="settings-card-heading"><span>01</span><div><h2>基本资料</h2><p>用户名会显示在左侧导航和项目工作台中。</p></div></div>
          <div className="avatar-editor">
            <div className="avatar-preview">{user.avatarUrl ? <img src={user.avatarUrl} alt="当前头像" /> : <span>{user.username.slice(0, 2).toUpperCase()}</span>}</div>
            <label className="secondary-button">{busy === "avatar" ? "正在上传…" : "更换头像"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} disabled={Boolean(busy)} /></label>
            <small>JPG、PNG 或 WebP，不超过 5 MB</small>
          </div>
          <form className="settings-form" onSubmit={updateUsername}><label><span>用户名</span><input name="username" defaultValue={user.username} minLength={2} maxLength={32} required /></label><button type="submit" disabled={Boolean(busy)}>{busy === "profile" ? "保存中…" : "保存用户名"}</button></form>
        </section>
        <section className="settings-card">
          <div className="settings-card-heading"><span>02</span><div><h2>联系方式</h2><p>注册邮箱和绑定手机在这里仅供查看。</p></div></div>
          <dl className="contact-list"><div><dt>注册邮箱</dt><dd>{user.email}</dd><span className={user.emailVerified ? "is-verified" : "is-pending"}>{user.emailVerified ? "✓ 已验证" : "○ 未验证"}</span>{!user.emailVerified && <button type="button" onClick={resend} disabled={Boolean(busy)}>{busy === "email" ? "发送中…" : "重新发送验证邮件"}</button>}</div><div><dt>绑定手机</dt><dd>{user.phone ?? "尚未绑定"}</dd><span className={user.phoneVerified ? "is-verified" : "is-pending"}>{user.phoneVerified ? "✓ 已验证" : "○ 短信验证下一阶段开放"}</span></div></dl>
        </section>
        <section className="settings-card">
          <div className="settings-card-heading"><span>03</span><div><h2>修改密码</h2><p>修改后会解除该账号在其他设备上的登录状态。</p></div></div>
          <form className="settings-form password-form" onSubmit={changePassword}><label><span>当前密码</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label><label><span>新密码</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label><label><span>确认新密码</span><input name="confirmPassword" type="password" autoComplete="new-password" required /></label><button type="submit" disabled={Boolean(busy)}>{busy === "password" ? "正在更新…" : "更新登录密码"}</button></form>
        </section>
      </div>
    </main>
  );
}
