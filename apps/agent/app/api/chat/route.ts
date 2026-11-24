/**
 * 对话接口：POST /api/chat
 * 多轮对话 + 工具调用（页面管理），会话历史持久化在 SQLite。
 */
import { chat, ChatMessage } from "@showcase/core/deepseek";
import { TOOLS, executeTool } from "@showcase/core/agent-tools";
import { addChatMessage, getChatHistory } from "@showcase/core/store";
import { NextRequest } from "next/server";
import { rateLimit, clientKey } from "@showcase/core/auth";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";

const AGENT_SYSTEM = `你是 ShowCase 平台的页面管理 Agent。用户通过对话让你分析内容、创建和管理网页。

你的能力（通过工具调用实现）：
- analyze_source：分析 GitHub 仓库/文章 URL/原始文本，自动生成完整页面
- update_page / update_section / add_section / delete_section / set_metadata：精细调整页面元素
- list_pages / open_page / delete_page：管理已有页面

行为准则：
1. 用户说"分析 xxx"→ 调用 analyze_source（任务在后台异步执行，工具会立即返回），向用户说明分析已在后台进行、通常 2~5 分钟完成，前端会显示实时进度，不要重复提交
2. 用户对页面提出修改（如"部署部分再详细点"、"换个标题"、"加一个常见问题章节"）→ 调用相应工具，基于当前管理页面操作
3. 操作完成后用简洁中文向用户汇报结果，并附上页面链接 /show/{slug}
4. 模糊的请求先确认再操作；删除页面必须让用户明确确认
5. 不需要修改页面时正常对话即可`;

interface ChatBody {
  sessionId: string;
  message: string;
  /** 前端当前管理页 slug（用于跨刷新恢复上下文） */
  currentSlug?: string;
}

export async function POST(request: NextRequest) {
  // public 模式：对话接口不存在，不暴露能力面
  if (isPublicMode()) return publicNotFound();
  const limited = rateLimit(`chat:${clientKey(request)}`, 10, 60_000);
  if (limited) return limited;
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!body.sessionId || !body.message?.trim()) {
    return Response.json({ error: "缺少 sessionId 或 message" }, { status: 400 });
  }

  const sessionId = body.sessionId;
  let currentSlug = body.currentSlug;

  // 持久化用户消息 + 载入历史
  addChatMessage(sessionId, "user", body.message);
  const history = getChatHistory(sessionId);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        AGENT_SYSTEM +
        (currentSlug ? `\n\n当前管理的页面 slug: ${currentSlug}` : ""),
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    // 工具调用循环（最多 6 轮，防失控）
    let finalText = "";
    const toolEvents: { name: string; result: string }[] = [];

    for (let round = 0; round < 6; round++) {
      const reply = await chat(messages, { tools: TOOLS });
      const toolCalls = extractToolCalls(reply);

      if (!toolCalls.length) {
        finalText = reply.content;
        break;
      }

      // 记录 assistant 的工具调用消息
      messages.push({
        role: "assistant",
        content: reply.content,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        let resultText: string;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          const { result, currentSlug: newSlug } = await executeTool(
            call.function.name,
            args,
            { sessionId, currentSlug }
          );
          if (newSlug) currentSlug = newSlug;
          resultText = result;
        } catch (err) {
          resultText = `工具执行出错: ${err instanceof Error ? err.message : String(err)}`;
        }
        toolEvents.push({ name: call.function.name, result: resultText.slice(0, 500) });
        messages.push({
          role: "tool",
          content: resultText,
          tool_call_id: call.id,
        });
      }
    }

    if (!finalText) finalText = "（已完成工具操作，但没有生成回复）";

    // 持久化助手回复
    addChatMessage(sessionId, "assistant", finalText, currentSlug);

    return Response.json({
      ok: true,
      reply: finalText,
      toolEvents,
      currentSlug,
    });
  } catch (err) {
    console.error("[chat] 对话失败:", err);
    const msg = err instanceof Error ? err.message : "";
    // 配置类错误原样告知（用户可自行解决）；其余保持通用文案防内部信息泄露
    if (/DEEPSEEK_API_KEY|未配置/.test(msg)) {
      return Response.json({ error: msg }, { status: 503 });
    }
    return Response.json(
      { error: "服务内部错误，请稍后重试" },
      { status: 500 }
    );
  }
}

/** 从 DeepSeek 响应中提取工具调用（宽松处理） */
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function extractToolCalls(reply: {
  content?: string;
  tool_calls?: ToolCall[];
}): ToolCall[] {
  if (Array.isArray(reply.tool_calls) && reply.tool_calls.length) {
    return reply.tool_calls;
  }
  return [];
}
