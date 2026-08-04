"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authenticatedFetch, getCurrentAuth, setCurrentAuth } from "@/src/auth/client";

type VerificationState = "form" | "loading" | "success" | "error";

export function VerifyEmailApp() {
  const [state, setState] = useState<VerificationState>("loading");
  const [message, setMessage] = useState("正在读取邮箱验证信息…");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState("");

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (token) {
        try {
          const response = await fetch("/api/auth/verify-email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(payload.error ?? "验证失败");
          setState("success");
          setMessage("注册邮箱已经验证成功。");
        } catch (caught) {
          setState("error");
          setMessage(caught instanceof Error ? caught.message : "验证失败，请重新发送验证邮件。");
        }
        return;
      }

      try {
        const auth = await getCurrentAuth(true);
        if (auth.user.emailVerified) {
          setState("success");
          setMessage("注册邮箱已经验证成功。");
          return;
        }
        setEmail(auth.user.email);
        setState("form");
        setMessage("验证码会在注册后自动发送；如暂未收到，可重新发送。验证码 30 分钟内有效。");
      } catch {
        window.location.assign("/login?next=%2Fverify-email%3Fpending%3D1");
      }
    });
  }, []);

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await authenticatedFetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "验证失败");
      const auth = await getCurrentAuth(true);
      setCurrentAuth({ ...auth, user: { ...auth.user, emailVerified: true } });
      setState("success");
      setMessage("注册邮箱已经验证成功。");
    } catch (caught) {
      setState("form");
      setMessage(caught instanceof Error ? caught.message : "验证码验证失败。");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setDevCode("");
    try {
      const response = await authenticatedFetch("/api/auth/resend-verification", { method: "POST" });
      const payload = (await response.json()) as {
        delivery?: string;
        devVerificationCode?: string;
        retryAfter?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.delivery === "rate_limited"
            ? `发送过于频繁，请 ${payload.retryAfter ?? 60} 秒后再试。`
            : payload.error ?? "发送失败",
        );
      }
      if (payload.delivery === "not_configured") throw new Error("邮件服务尚未完整配置。");
      if (payload.delivery === "failed") throw new Error("邮件发送暂时失败，请稍后重试。");
      setDevCode(payload.devVerificationCode ?? "");
      setMessage("新的邮箱验证码已经发送，有效期 30 分钟。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "发送失败。");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await authenticatedFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setCurrentAuth(null);
      window.location.assign("/login");
    }
  };

  return (
    <main className="auth-page auth-verify-page">
      <section className="auth-visual" aria-hidden="true"><div className="auth-brand"><span>ML</span><div><strong>MEMOSCAPELAB</strong><small>EMAIL VERIFICATION</small></div></div></section>
      <section className="auth-panel"><div className="auth-form-wrap verify-result">
        <span className={`verify-symbol is-${state}`}>{state === "loading" ? "··" : state === "success" ? "✓" : state === "error" ? "!" : "@"}</span>
        <span className="eyebrow">EMAIL VERIFICATION / 邮箱验证</span>
        <h2>{state === "success" ? "验证完成" : state === "error" ? "无法完成验证" : state === "form" ? "验证注册邮箱" : "正在验证"}</h2>
        {email && <p>注册邮箱：<strong>{email}</strong></p>}
        <p className={state === "form" && message.includes("失败") ? "form-message is-error" : ""}>{message}</p>
        {state === "form" && (
          <form className="auth-form verify-code-form" onSubmit={verifyCode}>
            <label><span>6 位邮箱验证码</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="000000" /></label>
            {devCode && <div className="dev-verify-link">本地开发验证码：<strong>{devCode}</strong></div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? "正在验证…" : "确认邮箱验证码"}<b>→</b></button>
            <button className="verify-resend-button" type="button" onClick={resend} disabled={busy}>没有收到？重新发送验证码</button>
          </form>
        )}
        {state === "success" && <Link className="auth-submit" href="/proj">进入项目工作台<b>→</b></Link>}
        {state === "error" && <Link className="auth-submit" href="/usr">前往用户设置<b>→</b></Link>}
        {state !== "loading" && <button className="verify-logout-button" type="button" onClick={logout} disabled={busy}>← 返回登录（登出）</button>}
      </div></section>
    </main>
  );
}
