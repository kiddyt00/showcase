import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100"),
  title: {
    default: "ShowCase · Agent 工作台",
    template: "%s · ShowCase Agent",
  },
  description:
    "输入任意内容源（GitHub 项目、文章、行业资料），AI 自动分析并生成可视化介绍网页",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="border-b border-[#21283a] bg-[#0d1117]">
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold tracking-tight">
                show<span className="text-emerald-400">case</span>
                <span className="ml-2 rounded border border-[#2a3347] px-1.5 py-0.5 text-[10px] text-[#8b96a8]">
                  agent
                </span>
              </span>
            </div>
            <nav className="flex items-center gap-3 font-mono text-xs text-[#8b96a8]">
              <Link href="/" className="hover:text-emerald-400">
                最新内容 ↗
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
