"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { authenticatedFetch, getCurrentAuth, setCurrentAuth, type CurrentUser } from "@/src/auth/client";
import { BrandMark } from "./brand-art";
import { OnboardingGuide } from "./onboarding-guide";

type AdminSection = "projects" | "work" | "about" | "user" | "users" | "imagegen";

const NAV_ITEMS = [
  { key: "home", label: "主页", symbol: "⌂", href: "http://localhost:3100/", external: true },
  { key: "projects", label: "项目", symbol: "▦", href: "/proj", external: false },
  { key: "work", label: "工作台", symbol: "◎", href: "/work", external: false },
  { key: "imagegen", label: "生成", symbol: "✧", href: "/imagegen", external: false },
] as const;

const ABOUT_ITEM = {
  key: "about",
  label: "关于",
  symbol: "i",
  href: "/about",
  external: false,
} as const;

export function AdminShell({
  active,
  children,
}: {
  active: AdminSection;
  children: ReactNode;
}) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [navigating, setNavigating] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const autoOpenedGuide = useRef(false);

  useEffect(() => {
    getCurrentAuth()
      .then((auth) => setUser(auth.user))
      .catch(() => window.location.assign("/login"));
  }, []);

  useEffect(() => {
    if (
      active === "projects"
      && user?.emailVerified
      && !user.onboardingCompleted
      && !autoOpenedGuide.current
    ) {
      autoOpenedGuide.current = true;
      setGuideOpen(true);
    }
  }, [active, user]);

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

  const completeGuide = async (startProject = false) => {
    setGuideOpen(false);
    if (user && !user.onboardingCompleted) {
      const nextUser = { ...user, onboardingCompleted: true };
      setUser(nextUser);
      try {
        const response = await authenticatedFetch("/api/users/me/onboarding", { method: "POST" });
        if (response.ok) {
          const auth = await getCurrentAuth();
          setCurrentAuth({ ...auth, user: nextUser });
        }
      } catch {
        // The guide remains dismissed for this visit; the server can retry next session.
      }
    }
    if (startProject) window.location.assign("/work");
  };

  const navItems = user?.role === "superadmin"
    ? [
        ...NAV_ITEMS,
        { key: "users", label: "用户管理", symbol: "♙", href: "/usradmin", external: false } as const,
        ABOUT_ITEM,
      ]
    : [...NAV_ITEMS, ABOUT_ITEM];

  return (
    <div className="admin-shell">
      <aside className="admin-appbar" aria-label="管理后台导航">
        <Link className="admin-logo" href="/proj" aria-label="MemoscapeLab 项目">
          <BrandMark tone="on-dark" />
        </Link>
        <nav>
          {navItems.map((item) => {
            const content = (
              <>
                <b aria-hidden="true">{item.symbol}</b>
                <small>{item.label}</small>
              </>
            );
            const className = [
              "admin-nav-item",
              active === item.key ? "is-active" : "",
              navigating === item.key ? "is-navigating" : "",
            ].filter(Boolean).join(" ");
            return item.external ? (
              <a
                className={className}
                href={item.href}
                key={item.key}
                onClick={() => setNavigating(item.key)}
              >
                {content}
              </a>
            ) : (
              <Link
                className={className}
                href={item.href}
                key={item.key}
                prefetch
                aria-current={active === item.key ? "page" : undefined}
                onClick={() => setNavigating(item.key)}
              >
                {content}
              </Link>
            );
          })}
        </nav>
        {navigating && <span className="admin-navigation-progress" role="status" aria-label="正在切换页面"><i /></span>}
        <div className="admin-profile-wrap" ref={menuRef}>
          {menuOpen && (
            <div className="admin-profile-menu" role="menu">
              <div>
                <strong>{user?.username ?? "正在读取"}</strong>
                <small>{user?.email ?? ""}</small>
              </div>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setGuideOpen(true); }}>重看新手引导</button>
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
      {guideOpen && user && <OnboardingGuide username={user.username} onComplete={completeGuide} />}
    </div>
  );
}
