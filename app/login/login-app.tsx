"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { setCurrentAuth, type CurrentUser } from "@/src/auth/client";

export function LoginApp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: form.get("identifier"), password: form.get("password") }),
      });
      const payload = (await response.json()) as { user?: CurrentUser; csrfToken?: string; error?: string };
      if (!response.ok || !payload.user || !payload.csrfToken) throw new Error(payload.error ?? "登录失败");
      setCurrentAuth({ user: payload.user, csrfToken: payload.csrfToken });
      const requested = new URLSearchParams(window.location.search).get("next");
      const next = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/proj";
      window.location.assign(
        payload.user.mustChangePassword
          ? "/usr?password=required"
          : payload.user.emailVerified
            ? next
            : "/verify-email?pending=1",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-hidden="true">
        <div className="auth-brand"><span>ML</span><div><strong>MEMOSCAPELAB</strong><small>历史影像沉浸式工作台</small></div></div>
        <div className="auth-visual-copy"><span>ARCHIVE ACCESS / 01</span><h1>让历史照片<br />重新拥有空间。</h1><p>管理原始档案、生成全景并保存每一次投影调参。</p></div>
        <div className="auth-grid-note">31.2304° N / 121.4737° E<br />SHANGHAI IMAGE ARCHIVE</div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">MEMBER SIGN IN / 用户登录</span>
          <h2>欢迎回来</h2>
          <p>使用用户名或注册邮箱进入您的项目档案。</p>
          <form className="auth-form" onSubmit={submit}>
            <label><span>用户名或邮箱</span><input name="identifier" autoComplete="username" required placeholder="name@example.com" /></label>
            <label><span>密码</span><input name="password" type="password" autoComplete="current-password" required placeholder="输入登录密码" /></label>
            {error && <div className="form-message is-error" role="alert">{error}</div>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? "正在验证…" : "登录项目工作台"}<b>→</b></button>
          </form>
          <p className="auth-switch">还没有账号？<Link href="/reg">创建新账号</Link></p>
          <small className="auth-security">登录状态由安全的 HttpOnly Cookie 保存，页面脚本无法读取认证令牌。</small>
        </div>
      </section>
    </main>
  );
}
