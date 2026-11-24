/** 会话列表：GET /api/chat/sessions（以首个用户消息命名，供侧栏切换） */
import { listChatSessions } from "@showcase/core/store";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";
import { NextRequest } from "next/server";

export async function GET(_request: NextRequest) {
  if (isPublicMode()) return publicNotFound();
  const sessions = listChatSessions(20);
  return Response.json({ ok: true, sessions });
}
