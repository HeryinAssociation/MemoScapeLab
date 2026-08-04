import type { Metadata } from "next";
import { AdminShell } from "../admin-shell";

export const metadata: Metadata = {
  title: "关于｜MemoscapeLab",
  description: "MemoscapeLab（记忆空间实验室）项目与团队介绍。",
};

export default function AboutPage() {
  return (
    <AdminShell active="about">
      <main className="about-page">
        <section className="about-card" aria-labelledby="about-title">
          <span className="about-eyebrow">ABOUT / 关于项目</span>
          <div className="about-mark" aria-hidden="true">ML</div>
          <h1 id="about-title">MemoscapeLab</h1>
          <p className="about-subtitle">记忆空间实验室</p>
          <div className="about-divider" aria-hidden="true"><i /></div>
          <p className="about-statement">本项目是第十一届上海图书馆开放数据竞赛作品</p>
          <div className="about-credits">
            <p><span>指导教师</span><strong>付雅明、王凤羽</strong></p>
            <p><span>团队领队</span><strong>郑晓优</strong><i /> <span>技术研发</span><strong>赵朔辰、曾泽川</strong></p>
            <p><span>艺术设计</span><strong>王宝笛</strong><i /> <span>UI设计</span><strong>徐蒙</strong></p>
            <p><span>测试调优</span><strong>张妍、孟俊树</strong></p>
          </div>
          <time dateTime="2026-08-10">2026年8月10日更新</time>
        </section>
      </main>
    </AdminShell>
  );
}
