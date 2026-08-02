"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { setCurrentAuth, type CurrentUser } from "@/src/auth/client";

interface RegisterResult {
  user?: CurrentUser;
  csrfToken?: string;
  delivery?: "development" | "sent" | "not_configured" | "failed";
  devVerificationUrl?: string;
  devVerificationCode?: string;
  error?: string;
}

export function RegisterApp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RegisterResult | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirmPassword")) {
      setError("两次输入的密码不一致。");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          email: form.get("email"),
          phone: form.get("phone"),
          password,
        }),
      });
      const payload = (await response.json()) as RegisterResult;
      if (!response.ok || !payload.user || !payload.csrfToken) throw new Error(payload.error ?? "注册失败");
      setCurrentAuth({ user: payload.user, csrfToken: payload.csrfToken });
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "注册失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page auth-register-page">
      <section className="auth-visual" aria-hidden="true">
        <div className="auth-brand"><span>AP</span><div><strong>ADAPTIVE PANNELLUM</strong><small>历史影像沉浸式工作台</small></div></div>
        <div className="auth-visual-copy"><span>CREATE ARCHIVE / 02</span><h1>建立属于您的<br />影像档案库。</h1><p>每个账号拥有独立项目与素材空间。</p></div>
        <div className="auth-grid-note">PRIVATE PROJECT OWNERSHIP<br />D1 + R2 SECURE STORAGE</div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">CREATE ACCOUNT / 用户注册</span>
          <h2>{result ? "账号创建完成" : "建立账号"}</h2>
          {result ? (
            <div className="registration-success">
              <span>✓</span>
              <p>邮箱验证码已为 <strong>{result.user?.email}</strong> 创建，有效期 30 分钟。</p>
              {result.delivery === "not_configured" && <div className="form-message">生产邮件服务尚未配置，请稍后在用户设置中重新发送。</div>}
              {result.delivery === "failed" && <div className="form-message is-error">邮件发送暂时失败，账号已经创建，可稍后重新发送。</div>}
              {result.devVerificationUrl && <a className="dev-verify-link" href={result.devVerificationUrl}>本地开发：打开邮箱验证链接</a>}
              {result.devVerificationCode && <div className="dev-verify-link">本地开发验证码：<strong>{result.devVerificationCode}</strong></div>}
              <Link className="auth-submit" href="/verify-email?pending=1">输入邮箱验证码 <b>→</b></Link>
            </div>
          ) : (
            <>
              <p>邮箱用于登录和验证；手机号可暂不填写，短信验证将在下一阶段启用。</p>
              <form className="auth-form" onSubmit={submit}>
                <div className="auth-field-row">
                  <label><span>用户名</span><input name="username" autoComplete="username" minLength={2} maxLength={32} required placeholder="2–32 个字符" /></label>
                  <label><span>绑定手机（选填）</span><div className="phone-field"><b>+86</b><input name="phone" inputMode="tel" autoComplete="tel-national" placeholder="13800000000" /></div></label>
                </div>
                <label><span>注册邮箱</span><input name="email" type="email" autoComplete="email" required placeholder="name@example.com" /></label>
                <div className="auth-field-row">
                  <label><span>密码</span><input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required placeholder="至少 8 个字符" /></label>
                  <label><span>确认密码</span><input name="confirmPassword" type="password" autoComplete="new-password" required placeholder="再次输入" /></label>
                </div>
                {error && <div className="form-message is-error" role="alert">{error}</div>}
                <button className="auth-submit" type="submit" disabled={loading}>{loading ? "正在创建…" : "创建账号并验证邮箱"}<b>→</b></button>
              </form>
              <p className="auth-switch">已有账号？<Link href="/login">返回登录</Link></p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
