/** 口播脚本生成：PageContent → 60~90 秒短视频脚本（LLM 改写，无 key 时降级） */
import { PageContent } from "../types";
import { chat, extractJson } from "../deepseek";

const MAX_SCENES = 7;
const MAX_NARRATION_CHARS = 80; // 单场景上限（总量另控 ≤ 360 字）
const TOTAL_NARRATION_BUDGET = 360; // 中文 4 字/秒 → 90 秒上限

const SCRIPT_PROMPT = `你在写一条 60~90 秒的短视频解说脚本。这不是朗读文章——是把内容提炼成让人看完的口播。
输出 JSON：
{ "scenes": [{ "heading": "场景标题(短)", "bullets": ["画面要点(每条15字内)", "2-4条"], "narration": "口播文案(30-60字，口语短句)", "visual": "diagram|code|counter|stepflow|stacklayers|terminal|text", "beats": [{"atWord": "narration中的词", "action": "模板动作", "label": "节点标签", "content": "终端内容"}], "hookScene": true }] }
visual 画面类型声明（素材不满足时会自动降级，放心声明）：
- "diagram"：图表场景，讲图（对应素材中的 diagrams）
- "code"：代码/命令场景（对应素材章节里的代码块，narration 解释它在做什么）
- "counter"：数字冲击场景（如 star 数/下载量/fork 数，narration 抛出这个数字的反差）
- "stepflow"：步骤流场景（语义：流程/步骤/路径）——横向节点卡片逐步点亮，narration 按步骤顺序讲
- "stacklayers"：层次叠加场景（语义：架构/多组件/层次）——3D 盒子逐层弹入堆叠，narration 按层次顺序讲
- "terminal"：终端模拟场景（语义：命令/上手/安装）——模拟终端逐字打命令+出输出，narration 讲怎么上手
- "text"：纯文字要点（默认）
beats 动画节拍（atWord 必须是 narration 中出现过的词或词组；动画在念到该词时触发）：
- stepflow：beats 数量 3-5，每个 beat 是 {"atWord": "触发词", "action": "light", "label": "步骤名(6字内)"}，按步骤顺序排列
- stacklayers：beats 数量 3-5，每个 beat 是 {"atWord": "触发词", "action": "drop", "label": "层名(6字内)"}，从底到顶排列
- terminal：beats 数量 2-4，{"atWord": "触发词", "action": "type", "content": "要打的命令"}；{"atWord": "触发词", "action": "output", "content": "输出行内容", "label": "ok|plain"}（label=ok 时输出行尾加绿色 ✓）
- 其他 visual 类型不需要 beats
结构（scenes 共 5-7 个）：
1. 开场钩子：用疑问、反差或数字抓住注意力（如"90%的人不知道…"），禁止"今天来介绍/大家好"这类开场白，标 hookScene: true
2. 3-4 个精华洞察场景：每个场景只讲一个最有价值的点，不要按文章章节顺序通读
3. 结尾行动卡：引导观众去页面下方链接试用，如"链接就在页面下方，现在去试试"
要求：
- narration 是给 TTS 念的口语：短句为主，结尾用句号/问号/感叹号便于断句，避免符号堆砌和长英文术语（必要术语保留）
- 若素材中包含图表（diagrams），可为图生成场景，narration 口语解释图讲了什么，heading 用图表标题，visual 填 "diagram"
- 素材里有代码块时可为它生成一个场景，heading 用所在章节标题，visual 填 "code"
- 素材 metadata 里有 star/fork 等数字时可为它生成一个场景，visual 填 "counter"，narration 用数字制造反差
- 全部场景 narration 总字数不超过 360 字（60~90 秒口播量）
- 不要 markdown`;

type VisualType = "diagram" | "code" | "counter" | "text" | "stepflow" | "stacklayers" | "terminal" | "slide";

/** LLM 产出的动画节拍 */
export interface ScriptBeat {
  atWord: string;
  action: string;
  content?: string;
  label?: string;
}

interface ScriptScene {
  heading: string;
  bullets: string[];
  narration: string;
  /** 画面类型声明：diagram=图表动画 code=打字机代码 counter=数字滚动 stepflow/stacklayers/terminal=动画模板 text=纯文字 */
  visual?: VisualType;
  /** 动画节拍（模板场景用） */
  beats?: ScriptBeat[];
  hookScene?: boolean;
}

function narrationLen(n: string): number {
  return n.replace(/\s/g, "").length;
}

/** 生成短视频脚本；LLM 不可用时降级为直接使用文章章节 */
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

/** 降级：开场钩子 + 每张图表一场景 + 首章节亮点 + 结尾 CTA */
function fallbackScript(page: PageContent): ScriptScene[] {
  const scenes: ScriptScene[] = [
    {
      heading: page.title,
      bullets: page.tags.slice(0, 3),
      narration: `${page.title}，凭什么值得关注？看完这条 60 秒，你就知道答案。`,
      hookScene: true,
    },
  ];
  for (const d of page.diagrams ?? []) {
    scenes.push({
      heading: d.title,
      bullets: [],
      narration: `这张${d.title}一眼看清整体结构与数据流向，值得停下来对照看。`,
      visual: "diagram",
    });
  }
  const first = page.sections[0];
  if (first) {
    const body = first.body.replace(/[#*`\[\]()]/g, "").trim();
    scenes.push({
      heading: first.heading,
      bullets: (first.bullets ?? []).slice(0, 3).map((b) => b.slice(0, 20)),
      narration: body.slice(0, MAX_NARRATION_CHARS),
    });
  }
  scenes.push({
    heading: "去试试",
    bullets: [],
    narration: `链接就在页面下方，点开${page.title}，现在就去试一试！`,
  });
  return scenes;
}

function normalizeVisual(v: unknown): VisualType {
  return v === "diagram" || v === "code" || v === "counter" || v === "stepflow" || v === "stacklayers" || v === "terminal"
    ? v
    : "text";
}

/** beats 校验：数组 + 每项 atWord 是字符串，非法项丢弃；全非法 → undefined（模板端均分降级） */
function normalizeBeats(v: unknown): ScriptBeat[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const beats = v
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .filter((b) => typeof b.atWord === "string" && b.atWord.trim().length > 0)
    .slice(0, 6)
    .map((b) => ({
      atWord: String(b.atWord).slice(0, 30),
      action: String(b.action ?? "light").slice(0, 20),
      ...(typeof b.content === "string" && b.content ? { content: String(b.content).slice(0, 120) } : {}),
      ...(typeof b.label === "string" && b.label ? { label: String(b.label).slice(0, 20) } : {}),
    }));
  return beats.length ? beats : undefined;
}

function normalize(scenes: ScriptScene[]): ScriptScene[] {
  const kept = scenes.slice(0, MAX_SCENES).map((s) => ({
    heading: String(s.heading || "untitled").slice(0, 30),
    bullets: (s.bullets || []).slice(0, 4).map(String),
    narration: String(s.narration || "").slice(0, MAX_NARRATION_CHARS),
    visual: normalizeVisual(s.visual),
    beats: normalizeBeats(s.beats),
    hookScene: !!s.hookScene,
  }));
  // 总量控制：超预算时从后往前丢非钩子场景，再逐场景截短
  let total = kept.reduce((sum, s) => sum + narrationLen(s.narration), 0);
  while (total > TOTAL_NARRATION_BUDGET && kept.length > 4) {
    const removed = kept.pop()!;
    total -= narrationLen(removed.narration);
  }
  return kept.map((s) => {
    while (total > TOTAL_NARRATION_BUDGET && narrationLen(s.narration) > 20) {
      s.narration = s.narration.slice(0, Math.ceil(narrationLen(s.narration) * 0.8));
      total = kept.reduce((sum, x) => sum + narrationLen(x.narration), 0);
    }
    return s;
  });
}

/** LLM 输出的单场景结构 */
export type { ScriptScene, VisualType };

/* ---------- 幻灯片模式脚本：场景结构与幻灯页一一对应 ---------- */

const SLIDES_MAX_SECTIONS = 5; // 与 slides.ts 封面 + ≤5 + 尾页对齐

/**
 * 幻灯片模式脚本（确定性，不走 LLM）：封面页（钩子）→ 每个 key section（洞察）→ 尾页（CTA）。
 * narration 仍按 P0 短视频脚本规范（钩子→洞察→CTA），每场景 visual = "slide"。
 */
export function generateSlidesScript(page: PageContent): ScriptScene[] {
  const scenes: ScriptScene[] = [
    {
      heading: page.title,
      bullets: page.tags.slice(0, 3),
      narration: `${page.title}，凭什么值得关注？看完这条 60 秒，你就知道答案。`,
      visual: "slide",
      hookScene: true,
    },
  ];
  const sections = page.sections.filter((s) => s.heading || s.body).slice(0, SLIDES_MAX_SECTIONS);
  for (const s of sections) {
    const body = s.body.replace(/[#*`\[\]()|>]/g, "").trim();
    scenes.push({
      heading: s.heading || page.title,
      bullets: (s.bullets ?? []).slice(0, 3).map((b) => b.slice(0, 20)),
      narration: body.slice(0, MAX_NARRATION_CHARS),
      visual: "slide",
    });
  }
  scenes.push({
    heading: "去看看",
    bullets: [],
    narration: `链接就在页面下方，点开${page.title}，现在就去试一试！`,
    visual: "slide",
  });
  return scenes;
}
