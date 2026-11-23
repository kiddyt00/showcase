/** DeepSeek API 极简客户端（用原生 fetch，不引入 SDK），支持 tool calling */
/* eslint-disable @typescript-eslint/no-explicit-any */

const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const MAX_RETRIES = 3; // 最多重试 3 次（共最多 4 次请求）
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // 指数退避
const REQUEST_TIMEOUT_MS = 120_000;

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
  opts?: { jsonMode?: boolean; temperature?: number; tools?: unknown[] }
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // 网络错误 / 超时 → 指数退避重试
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(
        `DeepSeek 网络错误（已重试 ${MAX_RETRIES} 次）: ${
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
    return { content: msg?.content ?? "", tool_calls: msg?.tool_calls };
  }
}

/** 从 LLM 输出中稳健地提取 JSON（容忍代码围栏等杂质） */
export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("LLM 输出中未找到 JSON");
  return JSON.parse(text.slice(start, end + 1)) as T;
}
