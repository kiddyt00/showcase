/** Agent 分析接口：POST /api/analyze */
import { runAnalysis } from "@showcase/core/agent";
import { savePage } from "@showcase/core/store";
import { AnalyzeRequest } from "@showcase/core/types";
import { NextRequest } from "next/server";
import { rateLimit, clientKey } from "@showcase/core/auth";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";

export async function POST(request: NextRequest) {
  // public 模式：分析接口不存在
  if (isPublicMode()) return publicNotFound();
  const limited = rateLimit(`analyze:${clientKey(request)}`, 10, 60_000);
  if (limited) return limited;
  let body: AnalyzeRequest;
  try {
    body = (await request.json()) as AnalyzeRequest;
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!body.input?.trim()) {
    return Response.json({ error: "缺少 input 字段" }, { status: 400 });
  }
  try {
    const { page } = await runAnalysis(body);
    await savePage(page);
    return Response.json({
      ok: true,
      slug: page.slug,
      url: `/show/${page.slug}`,
      page,
    });
  } catch (err) {
    console.error("[analyze] 分析失败:", err);
    return Response.json(
      { error: "分析失败，请稍后重试或更换输入内容" },
      { status: 500 }
    );
  }
}
