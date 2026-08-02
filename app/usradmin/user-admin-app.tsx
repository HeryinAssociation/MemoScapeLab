"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { authenticatedFetch, type CurrentUser } from "@/src/auth/client";

type FilterState = { q: string; role: string; status: string; emailVerified: string; phoneVerified: string };
const EMPTY_FILTERS: FilterState = { q: "", role: "", status: "", emailVerified: "", phoneVerified: "" };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function UserAdminApp() {
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetTarget, setResetTarget] = useState<CurrentUser | null>(null);

  const load = useCallback(async (nextFilters = filters) => {
    await Promise.resolve();
    setLoading(true); setError("");
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const response = await fetch(`/api/admin/users?${params}`, { cache: "no-store" });
      const payload = (await response.json()) as { users?: CurrentUser[]; error?: string };
      if (!response.ok || !payload.users) throw new Error(payload.error ?? "用户读取失败");
      setUsers(payload.users);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "用户读取失败"); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/users", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { users?: CurrentUser[]; error?: string };
        if (!response.ok || !payload.users) throw new Error(payload.error ?? "用户读取失败");
        if (!cancelled) setUsers(payload.users);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "用户读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const patchUser = async (user: CurrentUser, patch: Record<string, unknown>, success: string) => {
    setError(""); setNotice("");
    try {
      const response = await authenticatedFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "操作失败");
      setNotice(success); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
  };

  const deleteUser = async (user: CurrentUser) => {
    if (!window.confirm(`彻底删除“${user.username}”及其 ${user.projectCount ?? 0} 个项目、素材和全部登录记录？此操作不可撤销。`)) return;
    try {
      const response = await authenticatedFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "删除失败");
      setNotice(`用户 ${user.username} 已彻底删除。`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除失败"); }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!resetTarget) return;
    const form = new FormData(event.currentTarget); const password = String(form.get("password") ?? "");
    await patchUser(resetTarget, { newPassword: password }, `已重置 ${resetTarget.username} 的密码，并解除其全部登录状态。`);
    setResetTarget(null);
  };

  return (
    <main className="user-admin-page">
      <header className="admin-topbar"><div><span className="eyebrow">USER DIRECTORY / 用户管理</span><h1>注册用户</h1><p>检索用户、调整验证状态并处理账号安全。</p></div><div className="user-admin-summary"><strong>{users.length}</strong><span>当前结果</span></div></header>
      <section className="user-admin-content">
        <form className="user-filter-bar" onSubmit={(event) => { event.preventDefault(); load(); }}>
          <label className="user-search"><span>⌕</span><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="检索用户名、邮箱或手机号" /></label>
          <select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">全部角色</option><option value="user">普通用户</option><option value="superadmin">超级管理员</option></select>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">全部状态</option><option value="active">正常</option><option value="banned">已封禁</option></select>
          <select value={filters.emailVerified} onChange={(event) => setFilters({ ...filters, emailVerified: event.target.value })}><option value="">邮箱验证</option><option value="true">已验证</option><option value="false">未验证</option></select>
          <select value={filters.phoneVerified} onChange={(event) => setFilters({ ...filters, phoneVerified: event.target.value })}><option value="">手机验证</option><option value="true">已验证</option><option value="false">未验证</option></select>
          <button type="submit">检索</button><button type="button" className="text-button" onClick={() => { setFilters(EMPTY_FILTERS); load(EMPTY_FILTERS); }}>清除</button>
        </form>
        {(error || notice) && <div className={`settings-notice ${error ? "is-error" : ""}`}>{error || notice}</div>}
        <div className="user-table-wrap">
          <table className="user-table"><thead><tr><th>用户</th><th>联系方式</th><th>验证状态</th><th>项目</th><th>注册时间</th><th>账号状态</th><th>管理操作</th></tr></thead>
            <tbody>{loading ? <tr><td colSpan={7} className="table-empty">正在读取用户目录…</td></tr> : users.length === 0 ? <tr><td colSpan={7} className="table-empty">没有符合条件的用户</td></tr> : users.map((user) => (
              <tr key={user.id} className={user.status === "banned" ? "is-banned" : ""}>
                <td><div className="table-user"><span>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.username.slice(0, 2).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.role === "superadmin" ? "SUPER ADMIN" : user.id.slice(0, 8)}</small></div></div></td>
                <td><strong>{user.email}</strong><small>{user.phone ?? "未绑定手机"}</small></td>
                <td><button className={user.emailVerified ? "verify-chip is-verified" : "verify-chip"} onClick={() => patchUser(user, { emailVerified: !user.emailVerified }, "邮箱验证状态已更新。")}>邮箱 {user.emailVerified ? "✓" : "—"}</button><button disabled={!user.phone} className={user.phoneVerified ? "verify-chip is-verified" : "verify-chip"} onClick={() => patchUser(user, { phoneVerified: !user.phoneVerified }, "手机验证状态已更新。")}>手机 {user.phoneVerified ? "✓" : "—"}</button></td>
                <td><strong>{user.projectCount ?? 0}</strong><small>个项目</small></td><td><strong>{dateTime(user.createdAt)}</strong></td>
                <td><span className={`account-status is-${user.status}`}><i />{user.status === "active" ? "正常" : "已封禁"}</span></td>
                <td><div className="row-actions"><button onClick={() => patchUser(user, { status: user.status === "active" ? "banned" : "active" }, user.status === "active" ? "用户已封禁。" : "用户已解封。")}>{user.status === "active" ? "封禁" : "解封"}</button><button onClick={() => setResetTarget(user)}>重置密码</button><button className="danger-action" onClick={() => deleteUser(user)}>删除</button></div></td>
              </tr>))}</tbody></table>
        </div>
      </section>
      {resetTarget && <div className="admin-modal-backdrop" onMouseDown={() => setResetTarget(null)}><form className="admin-modal" onSubmit={resetPassword} onMouseDown={(event) => event.stopPropagation()}><span className="eyebrow">RESET PASSWORD</span><h2>重置 {resetTarget.username} 的密码</h2><p>保存后会解除该用户的全部登录状态，并要求其下次登录后修改密码。</p><label><span>临时新密码</span><input name="password" type="password" minLength={8} maxLength={128} autoFocus required /></label><div><button type="button" onClick={() => setResetTarget(null)}>取消</button><button type="submit">确认重置</button></div></form></div>}
    </main>
  );
}
