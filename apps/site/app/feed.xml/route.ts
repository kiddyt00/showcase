/** RSS 2.0 订阅源：GET /feed.xml —— 最新 20 篇（listPageSummaries），请求时生成保证新发布即收录 */
import { connection } from "next/server";
import { listPageSummaries } from "@showcase/core/store";

const SITE_URL = process.env.SITE_URL || "http://localhost:3100";

/** XML 特殊字符转义（元素文本节点用） */
const esc = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;"
  );

export async function GET() {
  // 与周印/首页同口径：请求时渲染（connection 前置，避免 better-sqlite3 同步查询被预渲染成构建期快照）
  await connection();
  const base = SITE_URL.replace(/\/$/, "");
  const pages = listPageSummaries(20);
  const items = pages
    .map(
      (p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${base}/show/${encodeURIComponent(p.slug)}</link>
    <guid isPermaLink="true">${base}/show/${encodeURIComponent(p.slug)}</guid>
    <pubDate>${new Date(p.createdAt).toUTCString()}</pubDate>
    <description>${esc(p.summary)}</description>
  </item>`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>ShowCase · 知识分享站</title>
  <link>${base}</link>
  <description>AI 驱动的知识分享站：开源项目、文章、教程的深度解析与可视化介绍</description>
  <language>zh-CN</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
