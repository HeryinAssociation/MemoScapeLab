import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "MemoscapeLab｜影像项目管理工作台",
    description:
      "保存历史照片、全景素材、元数据与投影视角参数的本地项目管理工作台。",
    openGraph: {
      title: "MemoscapeLab",
      description: "历史影像项目管理与投影调参工作台",
      type: "website",
      images: [{ url: "/og-editor.png", width: 1732, height: 908 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "MemoscapeLab",
      description: "历史影像项目管理与投影调参工作台",
      images: ["/og-editor.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="stylesheet"
          href="/vendor/pannellum/pannellum.css"
        />
        <script src="/vendor/pannellum/pannellum.js" defer />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
