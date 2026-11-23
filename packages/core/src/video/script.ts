/** 口播脚本生成：PageContent → 分场景视频脚本（LLM 改写，无 key 时降级） */
import { PageContent } from "../types";
import { chat, extractJson } from "../deepseek";
import { Scene } from "./types";

const SCRIPT_PROMPT = `你是视频口播编剧。把一份内容分析文章改写成解说视频脚本。
输出 JSON：{ "scenes": [{ "heading": "场景标题(短)", "bullets": ["画面要点(每条15字内)", "2-4条"], "narration": "口播文案(40-90字，口语化，有节奏感)" }] }
要求：
- 5-8 个场景：开场钩子 → 核心内容（对应文章章节）→ 总结
- 若素材中包含图表（diagrams），为每张图生成一个专门场景，narration 用口语解释这张图讲了什么（如架构分层、数据流向），heading 用图表标题
- narration 是给 TTS 念的，避免符号堆砌和长英文术语（必要术语保留）
- 不要 markdown`;

interface ScriptScene {
  heading: string;
  bullets: string[];
  narration: string;
}

/** 生成场景脚本；LLM 不可用时降级为直接使用文章章节 */
export async function generateScript(page: PageContent): Promise<ScriptScene[]> {
  try {
    const article = [
      `标题: ${page.title}`,
      `摘要: ${page.summary}`,
      ...page.sections.map((s) => `## ${s.heading}\n${s.body}\n${(s.bullets ?? []).join("\n")}`),
    ].join("\n\n");

    const out = (
      await chat(
        [
          { role: "system", content: SCRIPT_PROMPT },
          { role: "user", content: `视频主题：${page.title}\n\n${article.slice(0, 9000)}` },
        ],
        { jsonMode: true, temperature: 0.5 }
      )
    ).content;
    const parsed = extractJson<{ scenes: ScriptScene[] }>(out);
    if (parsed.scenes?.length) return normalize(parsed.scenes);
    throw new Error("空脚本");
  } catch (err) {
    console.warn(
      "[video] 口播脚本 LLM 生成失败，降级为文章章节脚本:",
      err instanceof Error ? err.message : err
    );
    return fallbackScript(page);
  }
}

/** 降级：直接用文章章节拼脚本 */
function fallbackScript(page: PageContent): ScriptScene[] {
  const scenes: ScriptScene[] = [
    {
      heading: page.title,
      bullets: page.tags.slice(0, 3),
      narration: `今天来介绍${page.title}。${page.summary}`,
    },
  ];
  for (const s of page.sections.slice(0, 5)) {
    scenes.push({
      heading: s.heading,
      bullets: (s.bullets ?? []).slice(0, 3).map((b) => b.slice(0, 20)),
      narration: s.body.replace(/[#*`\[\]()]/g, "").slice(0, 150),
    });
  }
  // 每张图表一个专门场景
  for (const d of page.diagrams ?? []) {
    scenes.push({
      heading: d.title,
      bullets: [],
      narration: `这张${d.title}展示了整体的结构与数据流向，可以结合前面的讲解对照理解各个模块之间的关系。`,
    });
  }
  return scenes;
}

function normalize(scenes: ScriptScene[]): ScriptScene[] {
  return scenes.slice(0, 10).map((s) => ({
    heading: String(s.heading || " untitled").slice(0, 30),
    bullets: (s.bullets || []).slice(0, 4).map(String),
    narration: String(s.narration || "").slice(0, 300),
  }));
}
