/** 搜索 API：GET /api/search?q= —— 内存过滤（listPages + includes），小数据量够用 */
import { listPages } from "@showcase/core/store";
import { searchPages, snippet } from "@/lib/search";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const query = q.trim();
  if (!query) return Response.json({ ok: true, q: query, count: 0, hits: [] });

  const pages = listPages(500);
  const hits = searchPages(pages, query).map((h) => {
    const page = pages.find((p) => p.slug === h.slug);
    // 摘要无命中时给正文命中片段
    const excerpt =
      h.matchedIn.includes("摘要") || !page
        ? h.summary
        : snippet(h.matchedIn.includes("正文") ? page.sections.map((s) => s.body).join("\n") : h.summary, query);
    return { ...h, excerpt };
  });
  return Response.json(
    { ok: true, q: query, count: hits.length, hits },
    { headers: { "Cache-Control": "no-store" } }
  );
}
