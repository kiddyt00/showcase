/** 搜索：内存过滤（数据量小够用），标题/摘要/章节正文命中即返回 */
import type { PageContent } from "@showcase/core/types";

export interface SearchHit {
  slug: string;
  title: string;
  summary: string;
  category: string;
  icon?: string;
  tags: string[];
  createdAt: string;
  /** 命中字段（用于结果提示） */
  matchedIn: string[];
}

export function searchPages(pages: PageContent[], q: string): SearchHit[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const hits: SearchHit[] = [];
  for (const p of pages) {
    const matchedIn: string[] = [];
    if (p.title.toLowerCase().includes(query)) matchedIn.push("标题");
    if (p.summary.toLowerCase().includes(query)) matchedIn.push("摘要");
    if (p.tags.some((t) => t.toLowerCase().includes(query))) matchedIn.push("标签");
    if (
      p.sections.some(
        (s) => s.body.toLowerCase().includes(query) || s.heading.toLowerCase().includes(query)
      )
    )
      matchedIn.push("正文");
    if (matchedIn.length) {
      hits.push({
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        category: p.category,
        icon: p.icon,
        tags: p.tags,
        createdAt: p.createdAt,
        matchedIn,
      });
    }
  }
  return hits;
}

/** 结果片段：命中词前后各取 ~40 字 */
export function snippet(text: string, q: string, radius = 40): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
