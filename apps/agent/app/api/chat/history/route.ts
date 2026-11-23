/** 对话历史查询：GET /api/chat/history?sessionId=xxx */
import { getChatHistory } from "@showcase/core/store";
import { NextRequest } from "next/server";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";

export async function GET(request: NextRequest) {
  // public 模式：对话历史接口不存在
  if (isPublicMode()) return publicNotFound();
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "缺少 sessionId" }, { status: 400 });
  }
  const history = getChatHistory(sessionId, 60);
  const currentSlug = [...history].reverse().find((m) => m.pageSlug)?.pageSlug;
  return Response.json({
    ok: true,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    currentSlug,
  });
}
