"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { authenticatedFetch, getCurrentAuth, setCurrentAuth, type CurrentUser } from "@/src/auth/client";

type AdminSection = "projects" | "work" | "user" | "users";

const NAV_ITEMS = [
  { key: "home", label: "主页", symbol: "⌂", href: "", disabled: true },
  { key: "projects", label: "项目", symbol: "▦", href: "/proj", disabled: false },
  { key: "work", label: "工作台", symbol: "◎", href: "/work", disabled: false },
  { key: "about", label: "关于", symbol: "i", href: "", disabled: true },
] as const;

export function AdminShell({
  active,
  children,
}: {
  active: AdminSection;
  children: ReactNode;
}) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentAuth()
      .then((auth) => setUser(auth.user))
      .catch(() => window.location.assign("/login"));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const initials = user?.username.slice(0, 2).toUpperCase() || "··";

  const logout = async () => {
    try {
      await authenticatedFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setCurrentAuth(null);
      window.location.assign("/login");
    }
  };

  const navItems = user?.role === "superadmin"
    ? [...NAV_ITEMS, { key: "users", label: "用户", symbol: "♙", href: "/usradmin", disabled: false } as const]
    : NAV_ITEMS;

  return (
    <div className="admin-shell">
      <aside className="admin-appbar" aria-label="管理后台导航">
        <Link className="admin-logo" href="/proj" aria-label="Adaptive Pannellum 项目">
          AP
        </Link>
        <nav>
          {navItems.map((item) =>
            item.disabled ? (
              <span className="admin-nav-item is-disabled" key={item.key} aria-disabled="true">
                <b aria-hidden="true">{item.symbol}</b>
                <small>{item.label}</small>
                <em>待开放</em>
              </span>
            ) : (
              <Link
                className={`admin-nav-item ${active === item.key ? "is-active" : ""}`}
                href={item.href}
                key={item.key}
              >
                <b aria-hidden="true">{item.symbol}</b>
                <small>{item.label}</small>
              </Link>
            ),
          )}
        </nav>
        <div className="admin-profile-wrap" ref={menuRef}>
          {menuOpen && (
            <div className="admin-profile-menu" role="menu">
              <div>
                <strong>{user?.username ?? "正在读取"}</strong>
                <small>{user?.email ?? ""}</small>
              </div>
              <Link href="/usr" role="menuitem" onClick={() => setMenuOpen(false)}>用户设置</Link>
              <button type="button" role="menuitem" onClick={logout}>登出</button>
            </div>
          )}
          <button
            className="admin-profile"
            type="button"
            title="打开用户菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{initials}</span>}
            <i />
          </button>
        </div>
      </aside>
      <div className="admin-content">{children}</div>
    </div>
  );
}
