/**
 * 应用运行模式开关
 * - all（默认）：完整版，包含 Agent 控制台 / 分析 / 对话等全部能力（本地私有部署）
 * - public：对外展示的独立部署，隐藏 Agent 能力面（/chat 与相关 API 模拟不存在）
 */
export type AppMode = "all" | "public";

export const APP_MODE: AppMode =
  process.env.APP_MODE === "public" ? "public" : "all";

export function isPublicMode(): boolean {
  return APP_MODE === "public";
}

/** public 模式下统一返回 404（模拟资源不存在，不暴露能力面） */
export function publicNotFound(): Response {
  return new Response(null, { status: 404 });
}
