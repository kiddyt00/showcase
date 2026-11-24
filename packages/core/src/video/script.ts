/** 口播脚本生成：PageContent → 60~90 秒短视频脚本（LLM 改写，无 key 时降级） */
import { PageContent } from "../types";
import { chat, extractJson } from "../deepseek";

const MAX_SCENES = 7;
const MAX_NARRATION_CHARS = 80; // 单场景上限（总量另控 ≤ 360 字）
const TOTAL_NARRATION_BUDGET = 360; // 中文 4 字/秒 → 90 秒上限

const SCRIPT_PROMPT = `你在写一条 60~90 秒的"动效图解"短视频解说脚本。画面由视觉元素动画构成，文字只留关键词，信息全靠口播（narration）传递。
输出 JSON：
{ "scenes": [{
  "keyword": "场景关键词（≤8 字，如 自动切换 / 187k Star）",
  "note": "一行小注（≤20 字，补充关键词说明）",
  "visual": "flowpath|stackboxes|terminal|counter|compare|text|diagram",
  "narration": "口播文案（30-60 字，口语短句）",
  "beats": [{"atWord": "口播中的词", "label": "该节拍的关键词"}],
  "hookScene": true
}] }
visual 视觉元素类型：
- "flowpath"：流程路径（语义：流程/步骤/路径）——透视路径上节点依次落下点亮，beats 3-5 个按流程顺序
- "stackboxes"：盒子堆叠（语义：架构/多组件/层次）——盒子从上方依次落下堆叠，beats 3-4 个从底到顶
- "terminal"：终端模拟（语义：命令/上手/安装）——beats 用 {"atWord":"触发词","action":"type","content":"命令"} 和 {"atWord":"触发词","action":"output","content":"输出","label":"ok"}，2-4 个
- "counter"：大数字滚动——beats 至少 1 个，label 里放数字（如 "187k Star" / "1.2万"）
- "compare"：对比条形图——beats 2-4 个按对比项排列，label=项名，content=数值（可选，用于条长权重）
- "diagram"：图表场景，讲图（对应素材中的 diagrams）
- "text"：纯关键词（默认，开场/过场用）
结构（scenes 共 5-7 个）：
1. 开场钩子：用疑问、反差或数字抓住注意力，禁止"今天来介绍/大家好"这类开场白，标 hookScene: true
2. 3-5 个精华洞察场景：每个场景只讲一个最有价值的点，visual 优先用 flowpath/stackboxes/counter/compare 让画面动起来
3. 结尾行动卡：visual 用 "text"，keyword 为行动文案（如 去试试），narration 引导观众去页面下方链接试用
要求：
- keyword ≤8 字、note ≤20 字；keyword 是画面上唯一的文字主角，其余信息全部放进 narration
- beats 的 atWord 必须是 narration 中出现过的词或词组（动画在念到该词时触发）；label ≤6 字
- narration 是给 TTS 念的口语：短句为主，结尾用句号/问号/感叹号便于断句，避免符号堆砌和长英文术语（必要术语保留）
- 素材里有图表（diagrams）可为图生成场景，visual 填 "diagram"，narration 口语解释图讲了什么
- 素材 metadata 里有 star/fork/下载量等数字时，生成 counter 场景，beats label 放数字制造反差
- 全部场景 narration 总字数不超过 360 字（60~90 秒口播量）
- 不要 markdown`;

type VisualType =
  | "diagram" | "code" | "counter" | "text" | "slide"
  | "flowpath" | "stackboxes" | "terminal" | "compare"
  | "stepflow" | "stacklayers"; // 后两个为 v3 兼容别名

/** LLM 产出的动画节拍 */
export interface ScriptBeat {
  atWord: string;
  action?: string;
  content?: string;
  label?: string;
}

interface ScriptScene {
  keyword?: string;
  note?: string;
  heading?: string;
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

/** 降级：开场钩子 + 每张图表一场景 + 首章节亮点 + 结尾 CTA（v4 动效图解 schema） */
function fallbackScript(page: PageContent): ScriptScene[] {
  const scenes: ScriptScene[] = [
    {
      keyword: page.title.slice(0, 8),
      note: "这条视频讲清楚它",
      heading: page.title,
      bullets: page.tags.slice(0, 3),
      narration: `${page.title}，凭什么值得关注？看完这条 60 秒，你就知道答案。`,
      visual: "text",
      hookScene: true,
    },
  ];
  // 素材数字 → counter 场景
  const entries = Object.entries(page.metadata ?? {}).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v) && (v as number) > 0
  ) as [string, number][];
  const num = entries.sort((a, b) => b[1] - a[1])[0];
  if (num) {
    scenes.push({
      keyword: `${num[1]} ${num[0]}`.slice(0, 8),
      note: "数据不会说谎",
      heading: "数据",
      bullets: [],
      narration: `先看一个数字：${num[1]} ${num[0]}。这个量级说明它不是玩具项目，是真正被大量使用的基础设施。`,
      visual: "counter",
      beats: [{ atWord: "数字", label: `${num[1]} ${num[0]}`.slice(0, 12) }],
    });
  }
  for (const d of page.diagrams ?? []) {
    scenes.push({
      keyword: (d.title || "架构总览").slice(0, 8),
      note: "一图看清整体结构",
      heading: d.title,
      bullets: [],
      narration: `这张${d.title}一眼看清整体结构与数据流向，值得停下来对照看。`,
      visual: "diagram",
    });
  }
  const first = page.sections[0];
  if (first) {
    const body = first.body.replace(/[#*`\[\]()*]/g, "").trim();
    const bullets = (first.bullets ?? []).slice(0, 3).map((b) => b.slice(0, 6));
    scenes.push({
      keyword: first.heading.slice(0, 8),
      note: body.slice(0, 20),
      heading: first.heading,
      bullets: bullets.map((b) => b.slice(0, 20)),
      narration: body.slice(0, MAX_NARRATION_CHARS),
      visual: "flowpath",
      beats: (bullets.length >= 3 ? bullets : ["更简单", "更快", "更稳"]).slice(0, 4).map((b, i) => ({
        atWord: body.slice(0, 8) || "结构",
        label: b.slice(0, 6),
      })),
    });
  }
  scenes.push({
    keyword: "去试试",
    note: "链接就在页面下方",
    heading: "去试试",
    bullets: [],
    narration: `链接就在页面下方，点开${page.title}，现在就去试一试！`,
    visual: "text",
  });
  return scenes;
}

function normalizeVisual(v: unknown): VisualType {
  return v === "diagram" || v === "code" || v === "counter" || v === "flowpath" ||
    v === "stackboxes" || v === "terminal" || v === "compare" ||
    v === "stepflow" || v === "stacklayers"
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
  const kept = scenes
    .filter((s) => typeof s.narration === "string" && s.narration.trim().length > 0) // narration 必填
    .slice(0, MAX_SCENES)
    .map((s) => {
      const keyword = String(s.keyword || s.heading || "untitled")
        .trim()
        .slice(0, 8); // ≤8 字超长截断
      return {
        keyword,
        note: String(s.note || "").trim().slice(0, 20), // ≤20 字
        heading: keyword, // heading 与关键词统一（图表匹配 + 播放器章节显示）
        bullets: (s.bullets || []).slice(0, 4).map(String),
        narration: String(s.narration || "").slice(0, MAX_NARRATION_CHARS),
        visual: normalizeVisual(s.visual),
        beats: normalizeBeats(s.beats),
        hookScene: !!s.hookScene,
      };
    });
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
      keyword: page.title.slice(0, 8),
      note: "这条视频讲清楚它",
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
      keyword: (s.heading || page.title).slice(0, 8),
      note: body.slice(0, 20),
      heading: s.heading || page.title,
      bullets: (s.bullets ?? []).slice(0, 3).map((b) => b.slice(0, 20)),
      narration: body.slice(0, MAX_NARRATION_CHARS),
      visual: "slide",
    });
  }
  scenes.push({
    keyword: "去看看",
    note: "链接就在页面下方",
    heading: "去看看",
    bullets: [],
    narration: `链接就在页面下方，点开${page.title}，现在就去试一试！`,
    visual: "slide",
  });
  return scenes;
}
