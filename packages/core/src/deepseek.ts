/** DeepSeek API 极简客户端（用原生 fetch，不引入 SDK），支持 tool calling */
/* eslint-disable @typescript-eslint/no-explicit-any */

const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const MAX_RETRIES = 2; // 最多重试 2 次（共最多 3 次请求）
const RETRY_DELAYS_MS = [2000, 6000]; // 指数退避
/**
 * 单次请求超时：推理模型（GLM 系列）会产出大量 reasoning_content，
 * 实测生成 3800 字正文 + 13800 字推理约需 72 秒；真实分析任务更大，留足余量。
 * 可用 LLM_TIMEOUT_MS 环境变量覆盖。
 */
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 300_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ChatReply {
  content: string;
  tool_calls?: any[];
}

export async function chat(
  messages: ChatMessage[],
  opts?: { jsonMode?: boolean; temperature?: number; tools?: unknown[]; signal?: AbortSignal }
): Promise<ChatReply> {
  if (!API_KEY) {
    throw new Error(
      "未配置 DEEPSEEK_API_KEY：请在 github-showcase/.env.local 中设置"
    );
  }
  const body = JSON.stringify({
    model: MODEL,
    messages,
    temperature: opts?.temperature ?? 0.3,
    ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(opts?.tools?.length ? { tools: opts.tools } : {}),
  });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body,
        // 外部取消信号与超时信号合并：任一触发即中断
        signal: opts?.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // 外部取消（用户点取消）→ 立即抛出，不重试
      if (opts?.signal?.aborted) {
        throw new Error("请求已被用户取消");
      }
      // 超时 / 网络错误 → 指数退避重试（超时说明模型需要更久，重试通常无益，只重试 1 次）
      const isTimeout = err instanceof Error && /timed? ?out|aborted due to timeout/i.test(err.message);
      const maxAttempts = isTimeout ? 1 : MAX_RETRIES;
      if (attempt < maxAttempts) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(
        `DeepSeek 网络错误（已重试 ${attempt} 次）: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (!res.ok) {
      const text = await res.text();
      // 429 / 5xx → 指数退避重试；其余 4xx 不重试
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(`DeepSeek API 错误 ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    let content: string = msg?.content ?? "";
    // 推理模型（如 GLM 系列）可能把全部输出放进 reasoning_content 而 content 为空，回退取之
    if (!content.trim() && typeof msg?.reasoning_content === "string" && msg.reasoning_content.trim()) {
      content = msg.reasoning_content;
    }
    return { content, tool_calls: msg?.tool_calls };
  }
}

/** 从 LLM 输出中稳健地提取 JSON（容忍代码围栏等杂质） */
export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`LLM 输出中未找到 JSON（raw 前 300 字: ${text.slice(0, 300)}）`);
  }
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch (firstErr) {
    // 常见修复：尾逗号、智能引号、markdown 粗体残留
    const repaired = candidate
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try {
      return JSON.parse(repaired) as T;
    } catch {
      throw new Error(
        `LLM JSON 解析失败: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}（候选前 300 字: ${candidate.slice(0, 300)}）`
      );
    }
  }
}
