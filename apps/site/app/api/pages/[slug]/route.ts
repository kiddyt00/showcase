/** 单页操作：GET 查看 / PATCH 手动微调元素 / DELETE 删除 */
import { PageContent, Section } from "@showcase/core/types";
import { getPage, savePage, deletePage } from "@showcase/core/store";
import { requireAdmin } from "@showcase/core/auth";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  const page = getPage(slug);
  if (!page) return Response.json({ error: "页面不存在" }, { status: 404 });
  return Response.json({ ok: true, page });
}

/** 手动更新页面元素（管理台右侧面板直接编辑时调用） */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { slug } = await ctx.params;
  const page = getPage(slug);
  if (!page) return Response.json({ error: "页面不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | Partial<
        Pick<
          PageContent,
          "title" | "summary" | "category" | "icon" | "tags" | "sections" | "metadata" | "diagrams"
        >
      >
    | null;
  if (!body) return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });

  if (body.title !== undefined) page.title = body.title;
  if (body.summary !== undefined) page.summary = body.summary;
  if (body.category !== undefined) page.category = body.category;
  if (body.icon !== undefined) page.icon = body.icon || undefined;
  if (body.tags !== undefined) page.tags = body.tags;
  if (body.sections !== undefined) page.sections = body.sections as Section[];
  if (body.diagrams !== undefined) page.diagrams = body.diagrams as PageContent["diagrams"];
  if (body.metadata !== undefined) page.metadata = body.metadata;

  savePage(page);
  return Response.json({ ok: true, page });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { slug } = await ctx.params;
  const removed = await deletePage(slug);
  return Response.json({ ok: removed }, { status: removed ? 200 : 404 });
}
