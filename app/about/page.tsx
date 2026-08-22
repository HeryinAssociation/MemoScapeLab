import type { Metadata } from "next";
import { AdminShell } from "../admin-shell";
import { BrandLockup } from "../brand-art";

export const metadata: Metadata = {
  title: "关于｜MemoscapeLab",
  description: "MemoscapeLab（记忆空间实验室）项目介绍。",
};

export default function AboutPage() {
  return (
    <AdminShell active="about">
      <main className="about-page">
        <section className="about-card" aria-labelledby="about-title">
          <span className="about-eyebrow">ABOUT / 关于项目</span>
          <h1 id="about-title" className="about-brand-title" aria-label="MemoscapeLab">
            <BrandLockup />
          </h1>
          <p className="about-subtitle">记忆空间实验室</p>
          <div className="about-divider" aria-hidden="true"><i /></div>
          <p className="about-statement">本项目是第十一届上海图书馆开放数据竞赛作品</p>
          <time dateTime="2026-08-10">2026年8月10日更新</time>
        </section>
      </main>
    </AdminShell>
  );
}
