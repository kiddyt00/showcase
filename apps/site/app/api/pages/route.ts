/** 网页创建接口：POST /api/pages 创建，GET /api/pages 列表 */
import { PageContent } from "@showcase/core/types";
import { savePage, listPages, uniqueSlugify, slugExists } from "@showcase/core/store";
import { redactPageContent } from "@showcase/core/redact";
import { NextRequest } from "next/server";
import { requireAdmin, rateLimit, clientKey } from "@showcase/core/auth";

/** 创建页面 —— Agent 或任何外部系统调用此接口发布内容 */
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const limited = rateLimit(`pages:${clientKey(request)}`, 10, 60_000);
  if (limited) return limited;
  let body: Partial<PageContent>;
  try {
    body = (await request.json()) as Partial<PageContent>;
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!body.title || !Array.isArray(body.sections) || !body.sections.length) {
    return Response.json(
      { error: "至少需要 title 和 sections 字段" },
      { status: 400 }
    );
  }
  // slug 覆盖防护：显式传入且已存在 → 409
  if (body.slug && slugExists(body.slug)) {
    return Response.json(
      { error: `slug "${body.slug}" 已存在，请更换 slug 或省略该字段自动生成` },
      { status: 409 }
    );
  }
  const page: PageContent = {
    slug: body.slug || uniqueSlugify(body.title),
    title: body.title,
    summary: body.summary || "",
    category: body.category || "article",
    source: body.source || { type: "manual" },
    icon: body.icon,
    tags: body.tags || [],
    sections: body.sections,
    metadata: body.metadata || {},
    createdAt: new Date().toISOString(),
    generator: body.generator || "api@1",
  };
  // 脱敏：直接使用返回的新对象（redactPageContent 不修改入参）
  const { page: redacted, hits } = redactPageContent(page);
  await savePage(redacted);
  return Response.json(
    { ok: true, slug: redacted.slug, url: `/show/${redacted.slug}`, redactHits: hits },
    { status: 201 }
  );
}

/** 页面列表 */
export async function GET() {
  const pages = await listPages();
  return Response.json({ ok: true, count: pages.length, pages });
}
