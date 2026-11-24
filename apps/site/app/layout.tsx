import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Archivo, Geist, Geist_Mono, Noto_Serif_SC, Playfair_Display } from "next/font/google";
import "./globals.css";
import { THEMES } from "@/theme/themes";
import { resolveTheme, themeStyle } from "@/theme/server";
import { ThemeProvider } from "@/theme/ThemeContext";
import ThemeSwitcher from "@/theme/ThemeSwitcher";
import MastheadDate from "@/components/MastheadDate";
import { getCollections } from "@/lib/collections";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

// 中文衬线标题：与 Playfair 混排（拉丁字形由 Playfair 提供，CJK 字形回退到思源宋体）
const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100"),
  title: {
    default: "ShowCase · 知识分享站",
    template: "%s · ShowCase",
  },
  description:
    "AI 驱动的知识分享站：开源项目、文章、教程的深度解析与可视化介绍",
};

/** 服务端读当前主题（theme.json），CSS 变量内联到 <html style> —— SSR 无闪烁 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = resolveTheme(); // 已持久化主题（预览覆盖由客户端 ?theme= 处理）
  const collections = getCollections();

  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${notoSerifSC.variable} h-full antialiased`}
      style={themeStyle(theme)}
    >
      <body className="min-h-full flex flex-col bg-bg text-fg font-sans">
        <ThemeProvider initialName={theme.name} initialTokens={theme.tokens}>
          {/* 报头：站名衬线大字 + 日期 + 栏目导航（杂志刊头风：双细线分隔） */}
          <header className="border-b border-border">
            <div className="mx-auto max-w-5xl px-4 pt-6 pb-0">
              {/* 双细线（刊头 top rule：粗细双线，印刷品式） */}
              <div aria-hidden className="masthead-rule" />
              <div className="reveal flex flex-wrap items-end justify-between gap-2 pb-4 pt-5" style={{ "--reveal-delay": "0ms" } as React.CSSProperties}>
                <div>
                  <Link href="/" className="font-heading text-3xl font-bold tracking-tight hover:text-accent">
                    Show<span className="text-accent">Case</span>
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    AI 驱动的知识分享站
                  </p>
                </div>
                <MastheadDate />
              </div>
              {/* 栏目导航：横向滚动（移动端适配） */}
              <nav
                aria-label="栏目导航"
                className="flex gap-5 overflow-x-auto whitespace-nowrap py-2.5 text-sm text-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <Link href="/" className="link-editorial hover:text-accent">
                  首页
                </Link>
                {collections.map((c) => (
                  <Link key={c.id} href={`/c/${c.id}`} className="link-editorial hover:text-accent">
                    {c.name}
                  </Link>
                ))}
                <Link href="/tags" className="link-editorial hover:text-accent">
                  标签
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="border-t border-border">
            <div className="mx-auto max-w-5xl px-4">
              {/* 版权页（colophon）：杂志末页的印刷信息小字行 */}
              <p className="colophon pt-4 text-center text-[11px] tracking-[0.08em]">
                排版 Playfair Display / Noto Serif SC · 正文 Geist · 由 ShowCase 印制
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-muted">
                <p>ShowCase · AI 驱动的通用内容分析展示平台</p>
                <div className="flex items-center gap-4">
                  <Link href="/search" className="link-editorial hover:text-accent">
                    搜索
                  </Link>
                  <Link href="/tags" className="link-editorial hover:text-accent">
                    标签云
                  </Link>
                  <Suspense fallback={null}>
                    <ThemeSwitcher themes={THEMES.map((t) => ({ name: t.name, label: t.label }))} />
                  </Suspense>
                </div>
              </div>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
