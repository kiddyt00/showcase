/** 口播脚本生成：PageContent → 60~90 秒短视频脚本（LLM 改写，无 key 时降级） */
import fs from "node:fs";
import path from "node:path";
import { PageContent } from "../types";
import { PUBLIC_ASSETS_DIR } from "../paths";
import { chat, extractJson } from "../deepseek";
import { pickOpeningMode, openingDirective, OPENING_SIGNATURE_LAYERS, type OpeningMode } from "./openings";
import { FPS } from "./types";

const MAX_SCENES = 7;
const MAX_NARRATION_CHARS = 80; // 单场景上限（总量另控 ≤ 360 字）
const TOTAL_NARRATION_BUDGET = 360; // 中文 4 字/秒 → 90 秒上限

const SCRIPT_PROMPT = `你在为 user 消息里那篇文章制作一条 60~90 秒的短视频。这条视频不是文章的摘要、不是导读，而是文章的"预告片 + 反差版"：
- 视频只做文章做不了的三件事：时间悬念（把最反直觉的事实留到中后段才揭示）、数字冲击（大数字滚动/对比条制造的瞬时压迫感）、行动冲动（看完带着一个没答案的问题去点文章）。
- 文章已经讲透的论证过程、命令细节、类比展开，视频一律不讲——观众点进文章就是要看这些，你讲了反而剥夺了点开的理由。
- 允许从文章拿走的只有：事实、数字、专有名词。叙事顺序、取舍、节奏必须重新设计，禁止沿用文章章节顺序。
画面由视觉原语自由组合而成——每次生成的视频都应当有独特的分镜设计，不要每条视频都用同一种组合。
输出 JSON：
{ "scenes": [{
  "keyword": "场景关键词（≤8 字，如 自动切换 / 187k Star）",
  "note": "一行小注（≤20 字，补充关键词说明）",
  "narration": "口播文案（30-60 字，口语短句）",
  "beats": [{"atWord": "口播中的词", "label": "该节拍的关键词"}],
  "hookScene": true,
  "storyboard": {
    "background": { "type": "solid" | "gradient", "from": "#0b0f0e", "to": "#10161f", "angle": 160 },
    "layers": [ 见下方原语 ],
    "transitions": { "in": "slide-left|slide-right|fade|zoom", "out": "fade" }
  }
}] }

分镜视觉原语（layers 数组，按叠加顺序；每层可带 enter: {"fx": 入场动效, "delaySec": 延迟秒数}）：
- {"type":"text","content":"文字","size":"giant|large|medium|small","align":"left|center","color":"fg|accent|sub","enter":{"fx":"fade-up|spring|scramble|scale-blur","delaySec":0.5}}
- {"type":"card","title":"卡片标题","body":"卡片正文","accent":true,"enter":{"fx":"border-beam|spotlight|spring|fade-up","delaySec":0.8}}
- {"type":"metric","label":"指标名","value":"143,630","enter":{"fx":"spring","delaySec":0.6}}  —— 单个大数字弹性滚动
- {"type":"stats","stats":[{"label":"营收","value":"$57.0B","delta":"+62% YoY"},{"label":"净利润","value":"$31.9B","delta":"+65%"}],"enter":{"fx":"fade-up"}}  —— 2~4 个并列数据网格（多指标场景首选，比多个 metric 更有面板感）
- {"type":"ring","ratio":0.9,"label":"数据中心占营收比例","centerText":"89%","enter":{"fx":"scale-blur"}}  —— 进度环（占比/毛利率/完成度）
- {"type":"timeline","steps":["间距","颜色","文案","字体","布局"],"enter":{"fx":"fade-up"}}  —— 横向步骤时间轴（工序/阶段/流程 2~5 步）
- {"type":"quote","quote":"业绩最好的公司，恰是争论最激烈的地方","author":"黄仁勋","enter":{"fx":"fade-up"}}  —— 金句卡（观点/结论/人物引语）
- {"type":"photo","query":"nvidia gpu chip","caption":"图注（可选）","enter":{"fx":"scale-blur"}}  —— 实拍图片层：query 写英文搜索词（具体、可搜的实物/场景），管线自动从免费图库下载；适合讲产品/芯片/服务器/城市等实物
- {"type":"clip","query":"data center servers","caption":"图注（可选）","enter":{"fx":"fade-up"}}  —— 实拍视频空镜内嵌：同 photo，但素材是短视频片段；一场景最多 1 层
- {"type":"flowpath","beats":[{"atWord":"词","label":"节点名"}...]}  —— 流程路径；beats 必填 3~5 个且 label 是具体内容（从 narration 提炼，如"修间距""调颜色"），禁止空 beats
- {"type":"stackboxes","beats":[...3~4 个具体层名]}  —— 架构堆叠
- {"type":"terminal","beats":[{"atWord":"词","action":"type","content":"真实命令"},{"atWord":"词","action":"output","content":"真实输出","label":"ok"}]}  —— 终端
- {"type":"compare","beats":[{"atWord":"词","label":"对比项","content":"数值权重"}...2~4 个]}  —— 对比条

分镜设计铁律（违反任何一条 = 不合格）：
0. 文章-视频分工铁律：文章是你的素材库，不是你的大纲。出现以下任何一种情况即不合格：
   - 场景 keyword 与文章章节 heading 重合超过 6 个字
   - 场景按文章章节顺序推进
   - 把文章的结论完整复述给观众（视频给"结果的一半"+情绪，完整结论留给文章）
   - 出现"完整拆解/完整分析见下方链接"这类台词，除非视频确实留了没讲的问题在文章里
1. 画面文字必须具体：直接用素材里的真实名词/数字/术语（如 "Blackwell 售罄"、"毛利率 73.4%"、"九道工序"），禁止"元素一/示例/待补充"这类占位词
2. narration 里的每个关键数字/名词都应该出现在该场景的某一层里（文字、卡片标题、metric、stats、timeline step）——画面与口播同步推进
3. 复合原语（flowpath/stackboxes/terminal/compare）必须内联 beats，label/content 从 narration 和素材中提炼具体内容
4. 每场景 layers 1~3 层；数据密集场景优先 stats 网格而非多个 metric；流程顺序优先 timeline；占比优先 ring；人物观点优先 quote
5. 同一视频内至少 4 种不同的原语类型、4 种不同的 enter fx；background 在 2~3 种组合间变化
6. 开场模式已由系统分配（见 user 消息里的"开场模式"指令块）：场景 1 必须严格符合该模式的分镜签名，禁止项一律不得出现；结尾 CTA 用 spring + border-beam

入场动效 fx 语义：fade-up 通用默认 / spring 数字成就反差 / scramble 开场解码 / border-beam 卡片点亮 / spotlight 聚焦揭示 / scale-blur 转场聚焦

开场模式已由编辑部分配，必须严格遵守该模式的分镜签名与禁止项（指令块在 user 消息末尾，其优先级高于你对开场的一切自由发挥）。

其余规则（narration/beats/结构）：
- 先做取舍（内部完成，不输出）：从文章挑 1 个"钩子事实"（最反直觉/最震撼的单点）和 2~3 个"文章没展开的角落"（一笔带过的细节、反方观点、代价与边界）；文章的主体论证章节整章跳过，不进视频。
- 结构三选一，禁止默认总用第一式：
  A 悬念式：抛反常识断言 → 给一半证据 → 留一个"答案在文章里"的缺口 → CTA
  B 冲击式：2~3 个递进数字场景（metric/stats/compare）→ 一个反转（反方数字/代价/边界）→ CTA
  C 显微式：只取文章里一个最精彩的微观过程（一条命令从输入到输出、一次转换的内部流水），放大 5 倍讲透，其余全部不提 → CTA
- 场景数 4~6；相邻场景的信息关系禁止全是并列补充（文章已经在做并列），至少一处转折/对抗/留白
- 结尾行动卡：narration 必须抛出一个视频里没给答案的问题（如"8000 亿缺口到底怎么算出来的？"），答案在文章里；禁止总结式 CTA（"以上就是……"）
- keyword ≤8 字；note ≤20 字；beats 的 atWord 必须是 narration 中出现过的词
- narration 口语短句 30-60 字，结尾用句号/问号/感叹号；全部场景 narration 总字数 ≤360 字
- 素材里的图表（diagrams）可以出现在分镜（用复合原语或 metric 讲图）
- 不要 markdown；颜色只用 #0b0f0e/#10161f/#161d28/#f4f4f5/#10b981/#a1a1aa`;

type VisualType =
  | "diagram" | "code" | "counter" | "text" | "slide" | "storyboard"
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
  /** v5 分镜：LLM 自由组合的视觉原语（校验后落入 Scene.storyboard） */
  storyboard?: unknown;
  /** quick 快览模式：确定性帧数（旁白字数/4 字每秒 × FPS + 缓冲），pipeline 直接采用不按 TTS 覆盖 */
  durationFrames?: number;
}

function narrationLen(n: string): number {
  return n.replace(/\s/g, "").length;
}

/** 跨视频多样性：读最近一份分镜产物，提取开场 fx/结构供本条回避（失败静默跳过） */
function recentFxBrief(): string {
  try {
    const fsSync = require("node:fs") as typeof import("node:fs");
    const pathSync = require("node:path") as typeof import("node:path");
    const root = pathSync.join(PUBLIC_ASSETS_DIR, "videos");
    if (!fsSync.existsSync(root)) return "";
    const dirs = fsSync
      .readdirSync(root)
      .filter((d) => d.endsWith("-assets"))
      .map((d) => {
        const p = pathSync.join(root, d, "script.json");
        try {
          return { p, m: fsSync.statSync(p).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b!.m - a!.m)
      .slice(0, 1);
    if (!dirs.length) return "";
    const data = JSON.parse(fsSync.readFileSync(dirs[0]!.p, "utf8"));
    const scenes = Array.isArray(data) ? data : data.scenes ?? [];
    if (!scenes.length) return "";
    const first = scenes[0].storyboard;
    const fxs: string[] = [];
    for (const l of first?.layers ?? []) {
      if (l.enter?.fx) fxs.push(l.enter.fx);
    }
    const kws = scenes.map((s: { keyword?: string }) => s.keyword).slice(0, 6);
    return `\n\n=== 站内最近一条视频的分镜概况（你的开场 fx、首个场景类型、场景推进逻辑必须与它明显不同） ===\n开场 fx: ${fxs.join(", ") || "无"}\n场景序列: ${kws.join(" → ")}`;
  } catch {
    return "";
  }
}

/** 生成短视频脚本；LLM 不可用时降级为直接使用文章章节 */
export async function generateScript(page: PageContent): Promise<ScriptScene[]> {
  try {
    // 开场语法轮换（r3-open）：代码按分类池 + 全局台账定模式，LLM 只在该模式内填空
    const opening = pickOpeningMode(page.category, page.slug);
    const directive = openingDirective(opening);
    const article = [
      `标题: ${page.title}`,
      `摘要: ${page.summary}`,
      ...page.sections.map((s) => `## ${s.heading}\n${s.body}\n${(s.bullets ?? []).join("\n")}`),
    ].join("\n\n");

    const out = (
      await chat(
        [
          { role: "system", content: SCRIPT_PROMPT },
          { role: "user", content: `视频主题：${page.title}\n\n${article.slice(0, 9000)}${recentFxBrief()}\n\n=== 开场模式指令块（必须严格遵守） ===\n${directive}` },
        ],
        { jsonMode: true, temperature: 0.5 }
      )
    ).content;
    const parsed = extractJson<{ scenes: ScriptScene[] }>(out);
    if (parsed.scenes?.length) {
      const norm = normalize(parsed.scenes);
      // storyboard 质量门：违规清单回喂 LLM 重试 1 次（对照 agent.ts 的 diagrams 修正循环）
      const headings = page.sections.map((x) => x.heading);
      let issues = checkStoryboardQuality(norm, headings, opening);
      if (issues.length) {
        console.warn(
          "[video] storyboard 质量门违规，回喂重试:",
          issues.map((it) => `场景${it.scene}(${it.keyword}): ${it.violations.join("；")}`).join(" | ")
        );
        try {
          await retryStoryboards(page, norm, issues, opening);
        } catch (fixErr) {
          console.warn("[video] storyboard 修正失败:", fixErr instanceof Error ? fixErr.message : fixErr);
        }
        issues = checkStoryboardQuality(norm, headings, opening);
        for (const it of issues) {
          console.warn(`[video] storyboard 重试仍违规（已确定性修补）: 场景${it.scene} ${it.violations.join("；")}`);
          patchStoryboardOpening(norm[it.scene], opening, page);
        }
      }
      // 分镜产物落盘：便于离线检查 LLM 分镜质量（失败不阻塞）；opening 仅观测用，渲染端不读
      try {
        const dir = path.join(PUBLIC_ASSETS_DIR, "videos", `${page.slug}-assets`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify({ opening, scenes: norm }, null, 2));
      } catch (dumpErr) {
        console.warn("[video] script.json 落盘失败:", dumpErr instanceof Error ? dumpErr.message : dumpErr);
      }
      return norm;
    }
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
    v === "stepflow" || v === "stacklayers" || v === "storyboard"
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

/* ---------- storyboard 校验：LLM 幻觉容错，非法原语丢弃 ---------- */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ENTER_FX = new Set(["fade-up", "spring", "scramble", "border-beam", "spotlight", "scale-blur"]);
const TRANSITIONS = new Set(["slide-left", "slide-right", "fade", "zoom"]);
const COMPLEX_TYPES = new Set(["flowpath", "stackboxes", "terminal", "compare", "counter-diagram"]);
const TEXT_SIZES = new Set(["giant", "large", "medium", "small"]);
const TEXT_COLORS = new Set(["fg", "accent", "sub"]);

function normalizeEnter(v: unknown): { fx: import("./types").EnterFx; delaySec?: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const e = v as Record<string, unknown>;
  if (typeof e.fx !== "string" || !ENTER_FX.has(e.fx)) return undefined;
  const delay = typeof e.delaySec === "number" && e.delaySec > 0 && e.delaySec < 8 ? Math.round(e.delaySec * 10) / 10 : undefined;
  return { fx: e.fx as import("./types").EnterFx, ...(delay ? { delaySec: delay } : {}) };
}

function normalizeBackground(v: unknown): import("./types").StoryboardBackground | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  if (typeof b.from !== "string" || !HEX_COLOR.test(b.from)) return undefined;
  const to = typeof b.to === "string" && HEX_COLOR.test(b.to) ? b.to : undefined;
  const angle = typeof b.angle === "number" && b.angle >= 0 && b.angle <= 360 ? Math.round(b.angle) : undefined;
  if (b.type === "gradient" && to) return { type: "gradient", from: b.from, to, angle };
  return { type: "solid", from: b.from };
}

function normalizeLayer(v: unknown): import("./types").StoryboardLayer | undefined {
  if (!v || typeof v !== "object") return undefined;
  const l = v as Record<string, unknown>;
  const enter = normalizeEnter(l.enter);
  switch (l.type) {
    case "text": {
      if (typeof l.content !== "string" || !l.content.trim()) return undefined;
      const size = typeof l.size === "string" && TEXT_SIZES.has(l.size) ? l.size : undefined;
      const color = typeof l.color === "string" && TEXT_COLORS.has(l.color) ? l.color : undefined;
      const align = l.align === "center" ? "center" : "left";
      return { type: "text", content: l.content.slice(0, 30), ...(size ? { size } : {}), align, ...(color ? { color } : {}), ...(enter ? { enter } : {}) } as import("./types").StoryboardLayer;
    }
    case "card": {
      const title = typeof l.title === "string" ? l.title.slice(0, 30) : undefined;
      const body = typeof l.body === "string" ? l.body.slice(0, 80) : undefined;
      if (!title && !body) return undefined;
      return { type: "card", ...(title ? { title } : {}), ...(body ? { body } : {}), accent: !!l.accent, ...(enter ? { enter } : {}) } as import("./types").StoryboardLayer;
    }
    case "metric": {
      if (typeof l.label !== "string" || typeof l.value !== "string") return undefined;
      if (!l.label.trim() || !l.value.trim()) return undefined;
      return { type: "metric", label: l.label.slice(0, 24), value: l.value.slice(0, 16), ...(enter ? { enter } : {}) };
    }
    case "ring": {
      const ratio = typeof l.ratio === "number" && l.ratio > 0 && l.ratio <= 1 ? l.ratio : undefined;
      if (ratio === undefined || typeof l.label !== "string" || !l.label.trim()) return undefined;
      const centerText = typeof l.centerText === "string" ? l.centerText.slice(0, 8) : undefined;
      return { type: "ring", ratio, label: l.label.slice(0, 30), ...(centerText ? { centerText } : {}), ...(enter ? { enter } : {}) };
    }
    case "timeline": {
      if (!Array.isArray(l.steps)) return undefined;
      const steps = l.steps
        .filter((x): x is string => typeof x === "string")
        .filter((x) => x.trim().length > 0)
        // 显示宽度截断：CJK 记 2、ASCII 记 1，避免 "Content Un" 式半截英文
        .map((x) => truncateByWidth(x.trim(), 18))
        .slice(0, 5);
      if (steps.length < 2) return undefined;
      return { type: "timeline", steps, ...(enter ? { enter } : {}) };
    }
    case "stats": {
      if (!Array.isArray(l.stats)) return undefined;
      const stats = l.stats
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .filter((x) => typeof x.label === "string" && typeof x.value === "string" && x.label.trim() && x.value.trim())
        .slice(0, 4)
        .map((x) => ({
          label: truncateByWidth(String(x.label), 20),
          value: truncateByWidth(String(x.value), 16),
          ...(typeof x.delta === "string" && x.delta.trim() ? { delta: truncateByWidth(String(x.delta), 20) } : {}),
        }));
      if (stats.length < 2) return undefined;
      return { type: "stats", stats, ...(enter ? { enter } : {}) };
    }
    case "quote": {
      if (typeof l.quote !== "string" || l.quote.trim().length < 4) return undefined;
      const author = typeof l.author === "string" && l.author.trim() ? l.author.trim().slice(0, 20) : undefined;
      return { type: "quote", quote: truncateByWidth(l.quote.trim(), 52), ...(author ? { author } : {}), ...(enter ? { enter } : {}) };
    }
    case "photo":
    case "clip": {
      if (typeof l.query !== "string" || l.query.trim().length < 3) return undefined;
      const caption = typeof l.caption === "string" && l.caption.trim() ? l.caption.trim().slice(0, 40) : undefined;
      return { type: l.type, query: l.query.trim().slice(0, 60), ...(caption ? { caption } : {}), ...(enter ? { enter } : {}) };
    }
    case "image":
    case "video": {
      if (typeof l.src !== "string" || !/^[\w\-./]+/.test(l.src)) return undefined;
      return { type: l.type, src: l.src, ...(enter ? { enter } : {}) } as import("./types").StoryboardLayer;
    }
    default: {
      if (typeof l.type === "string" && COMPLEX_TYPES.has(l.type)) {
        const beats = normalizeBeats(l.beats as ScriptBeat[]);
        return { type: l.type as "flowpath", ...(beats ? { beats } : {}), ...(enter ? { enter } : {}) } as import("./types").StoryboardLayer;
      }
      return undefined;
    }
  }
}

/** 分镜校验：背景/层/转场全部白名单过滤；任何不合法内容静默丢弃，空 storyboard 返回 undefined */
function normalizeStoryboard(v: unknown): import("./types").Scene["storyboard"] {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Record<string, unknown>;
  const background = normalizeBackground(s.background);
  const layers = Array.isArray(s.layers)
    ? s.layers.map(normalizeLayer).filter((x): x is import("./types").StoryboardLayer => !!x).slice(0, 4)
    : [];
  if (!layers.length && !background) return undefined; // 空分镜 → 回退 v4 模板
  let transitions: NonNullable<import("./types").Scene["storyboard"]>["transitions"];
  if (s.transitions && typeof s.transitions === "object") {
    const t = s.transitions as Record<string, unknown>;
    const inFx = typeof t.in === "string" && TRANSITIONS.has(t.in) ? (t.in as import("./types").TransitionFx) : undefined;
    const outFx = typeof t.out === "string" && TRANSITIONS.has(t.out) ? (t.out as import("./types").TransitionFx) : undefined;
    if (inFx || outFx) transitions = { ...(inFx ? { in: inFx } : {}), ...(outFx ? { out: outFx } : {}) };
  }
  return {
    ...(background ? { background } : {}),
    ...(layers.length ? { layers } : {}),
    ...(transitions ? { transitions } : {}),
  };
}

/** 显示宽度截断：CJK 字符记 2、ASCII 记 1，超宽截断加省略号（避免半截英文词） */
function truncateByWidth(s: string, maxWidth: number): string {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    w += code > 0x2e80 ? 2 : 1;
    if (w > maxWidth) {
      return `${s.slice(0, i)}…`;
    }
  }
  return s;
}

/** storyboard 质量门：复合原语 beats / 场景层数 / keyword 撞 heading；返回空数组 = 通过 */
type StoryIssue = { scene: number; keyword: string; violations: string[] };

/** 最长连续公共子串长度（keyword↔heading 撞车检测） */
function overlapAt(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

function checkStoryboardQuality(scenes: ScriptScene[], headings: string[], opening?: OpeningMode): StoryIssue[] {
  const issues: StoryIssue[] = [];
  scenes.forEach((s, i) => {
    const kw = String(s.keyword || s.heading || "").trim().slice(0, 8);
    const vs: string[] = [];
    const sb = (s.storyboard ?? null) as Record<string, unknown> | null;
    if (sb && typeof sb === "object") {
      const rawLayers = Array.isArray(sb.layers) ? sb.layers : [];
      const normLayers = rawLayers
        .map((l) => normalizeLayer(l))
        .filter((x): x is import("./types").StoryboardLayer => !!x);
      if (!normLayers.length) vs.push("storyboard.layers 全部非法或为空（至少 1 个合法视觉原语层）");
      for (const l of normLayers) {
        if ("beats" in l && !(l.beats?.length)) {
          vs.push(`复合原语层 "${l.type}" 的 beats 为空——必须给 ${l.type === "compare" ? "2~4" : "3~5"} 个 beats，label 从 narration 提炼具体内容`);
        }
      }
      // 开场签名断言（r3-open）：场景 1 必须呈现已分配模式的分镜签名
      if (i === 0 && opening) {
        if (opening === "number") {
          const hit = normLayers.some((l) => (OPENING_SIGNATURE_LAYERS.number as string[]).includes(l.type));
          if (!hit) vs.push("开场模式为 number：场景 1 必须有 metric/stats/ring 之一的最大数字层（enter.fx 用 spring 或 scale-blur），narration 首句含真实数字");
        } else if (opening === "process") {
          const proc = normLayers.find((l) => (OPENING_SIGNATURE_LAYERS.process as string[]).includes(l.type));
          if (!proc) {
            vs.push("开场模式为 process：场景 1 必须有 terminal/flowpath/timeline 之一的过程层（beats ≥ 3，从过程中间切入）");
          } else {
            const pb = (proc as { beats?: ScriptBeat[] }).beats;
            if (!pb?.length || pb.length < 3) {
              vs.push("开场模式为 process：场景 1 的过程层 beats 必须 ≥ 3（label 从 narration 提炼具体内容）");
            }
          }
        }
      }
    } else if (i === 0 && opening && opening !== "suspense") {
      vs.push(`开场模式为 ${opening}：场景 1 缺 storyboard，无法呈现该模式的分镜签名（${opening === "number" ? "metric/stats/ring 最大数字层" : "terminal/flowpath/timeline 过程层"}）`);
    }
    if (i === 0 && opening === "process" && s.hookScene) {
      // hookScene 断言放在 storyboard 检查之外：即使无 storyboard 也要拦（渲染端按它降级钩子版式）
      vs.push("开场模式为 process：hookScene 必须为 false（不给悬念钩子，观感是事件正在发生）");
    }
    if (kw) {
      for (const h of headings) {
        if (!h) continue;
        if (overlapAt(kw, h) > 6) {
          vs.push(`keyword "${kw}" 与文章章节 heading "${h}" 重合超过 6 字——keyword 必须改写为口播钩子词`);
          break;
        }
      }
    }
    if (vs.length) issues.push({ scene: i, keyword: kw || "(无 keyword)", violations: vs });
  });
  return issues;
}

/** 重试后仍违规的确定性自愈：剔空 beats 复合层、0 层场景补 narration 提炼的 text 层 */
function patchStoryboardScene(s: ScriptScene): void {
  const sb = (s.storyboard ?? null) as Record<string, unknown> | null;
  if (!sb || typeof sb !== "object") return;
  const layers = (Array.isArray(sb.layers) ? sb.layers : [])
    .map((l) => normalizeLayer(l))
    .filter((x): x is import("./types").StoryboardLayer => !!x)
    .filter((l) => !("beats" in l) || (Array.isArray((l as { beats?: unknown[] }).beats) && (l as { beats: unknown[] }).beats.length > 0))
    .slice(0, 4);
  if (!layers.length) {
    const content = String(s.narration || "").trim().slice(0, 24);
    if (!content) {
      s.storyboard = undefined;
      return;
    }
    layers.push({ type: "text", content, align: "left", enter: { fx: "fade-up" } });
  }
  s.storyboard = { ...(sb.background ? { background: sb.background as import("./types").StoryboardBackground } : {}), layers };
}

/**
 * 开场签名确定性修补（r3-open：质量门重试仍违规时的最后一道自愈）：
 * 先跑通用 patchStoryboardScene，再按模式补齐分镜签名——
 * number → metadata 最大数补 metric 层；process → 首章节 bullets 生成 timeline 层并关 hookScene；suspense → text 层补 scramble fx。
 */
function patchStoryboardOpening(s: ScriptScene, mode: OpeningMode, page: PageContent): void {
  patchStoryboardScene(s); // 通用自愈（剔空 beats 复合层、0 层补 narration text 层）打底
  if (mode === "process") s.hookScene = false; // 过程切入式不给悬念钩子
  const sb = (s.storyboard ?? null) as Record<string, unknown> | null;
  if (!sb || typeof sb !== "object") return;
  const layers = ((Array.isArray(sb.layers) ? sb.layers : []) ?? []) as import("./types").StoryboardLayer[];
  if (mode === "suspense") {
    // 悬念签名：text 层 scramble（已有 text 层则改 fx，没有则用 narration 提炼补一个）
    const idx = layers.findIndex((l) => l.type === "text");
    if (idx >= 0) {
      const t = layers[idx] as { type: "text"; enter?: { fx?: import("./types").EnterFx; delaySec?: number } };
      if (t.enter?.fx !== "scramble") {
        layers[idx] = { ...t, enter: { ...(t.enter ?? {}), fx: "scramble" } } as import("./types").StoryboardLayer;
      }
    } else {
      const content = String(s.narration || "").trim().slice(0, 24);
      if (content) layers.push({ type: "text", content, align: "left", enter: { fx: "scramble" } });
    }
    s.storyboard = { ...(sb.background ? { background: sb.background as import("./types").StoryboardBackground } : {}), layers: layers.slice(0, 4) };
    return;
  }
  if (mode === "number") {
    // 数字冲击签名：metadata 里最大数值 → metric 层（spring 弹入）
    if (layers.some((l) => OPENING_SIGNATURE_LAYERS.number.includes(l.type))) return;
    const entries = Object.entries(page.metadata ?? {}).filter(
      ([, v]) => typeof v === "number" && Number.isFinite(v) && (v as number) > 0
    ) as [string, number][];
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    if (!top) return;
    layers.push({ type: "metric", label: truncateByWidth(String(top[0]), 24), value: String(top[1]), enter: { fx: "spring" } });
    if (layers.length > 4) {
      // 层数超限：从后往前剔除一个非签名层，保住刚补的签名层
      let drop = -1;
      for (let i = layers.length - 2; i >= 0; i--) {
        if (!OPENING_SIGNATURE_LAYERS.number.includes(layers[i]!.type)) { drop = i; break; }
      }
      if (drop >= 0) layers.splice(drop, 1);
      layers.splice(4);
    }
  } else {
    // 过程切入签名：首章节 bullets → timeline 层（beats 概念在 timeline 上体现为 steps，≥3 步）
    const hasSig = layers.some(
      (l) => OPENING_SIGNATURE_LAYERS.process.includes(l.type) && (!("beats" in l) || (l.beats?.length ?? 0) >= 3)
    );
    if (hasSig) return;
    const steps = (page.sections[0]?.bullets ?? [])
      .map((b) => truncateByWidth(String(b).trim(), 18))
      .filter(Boolean)
      .slice(0, 4);
    const fallback = ["起点", "关键动作", "结果", "下一步"];
    while (steps.length < 3) steps.push(fallback[steps.length]!);
    const layer: import("./types").StoryboardLayer = { type: "timeline", steps, enter: { fx: "fade-up" } };
    const sig = layers.findIndex((l) => OPENING_SIGNATURE_LAYERS.process.includes(l.type));
    if (sig >= 0) layers[sig] = layer; // 有过程层但 beats 不足 → 整层替换
    else layers.push(layer);
  }
  s.storyboard = { ...(sb.background ? { background: sb.background as import("./types").StoryboardBackground } : {}), layers: layers.slice(0, 4) };
}

/** 门禁未过 → 违规清单回喂 LLM 重出 storyboard（仅重试 1 次） */
async function retryStoryboards(page: PageContent, scenes: ScriptScene[], issues: StoryIssue[], opening?: OpeningMode): Promise<void> {
  const headings = page.sections.map((x) => x.heading);
  const perScene = issues
    .map((it) => `【场景 ${it.scene}】keyword=${it.keyword}\n原 storyboard：${JSON.stringify(scenes[it.scene]?.storyboard ?? {}, null, 2)}\n违规：\n- ${it.violations.join("\n- ")}`)
    .join("\n\n");
  const openingRule = opening === "number"
    ? `- 场景 1（开场模式 number）：必须有 metric/stats/ring 之一的最大数字层（enter.fx 用 spring 或 scale-blur），narration 首句含真实数字`
    : opening === "process"
      ? `- 场景 1（开场模式 process）：必须有 terminal/flowpath/timeline 之一且该层 beats ≥ 3，hookScene 保持 false`
      : opening === "suspense"
        ? `- 场景 1（开场模式 suspense）：text 层用 scramble 或 card 层用 spotlight（二选一必须出现）`
        : "";
  const prompt = `以下分镜 storyboard 未通过质量检查。逐条修复违规项，只输出修复后的 JSON：
{"scenes":[{"storyboard":{...}}]}（scenes 数组与下面列出的场景一一对应、顺序一致；每项只含 storyboard 字段，不要输出其他内容）

质量规则：
- 复合原语（flowpath/stackboxes/terminal/compare）必须内联 beats，label/content 从对应场景的口播和素材中提炼具体内容，禁止空 beats
- 每个场景 layers 至少 1 个合法视觉原语层${openingRule ? `\n${openingRule}` : ""}
- 场景 keyword 与这些文章章节 heading 重合不得超过 6 个字：${headings.join(" / ") || "（无）"}——keyword 改写为 ≤8 字的口播钩子词（如 反直觉结论/关键数字），不要照抄章节标题

=== 违规场景清单 ===
${perScene}`;
  const fixed = (
    await chat(
      [
        { role: "system", content: "你是短视频分镜修正器。根据违规清单修复 storyboard JSON，只输出修正后的完整 JSON 对象，不要解释、不要 markdown 围栏。" },
        { role: "user", content: prompt },
      ],
      { temperature: 0.5 }
    )
  ).content.replace(/^```(?:json)?\s*|\s*```$/g, "");
  const reparsed = extractJson<{ scenes?: { storyboard?: unknown }[] }>(fixed);
  const fixedList = reparsed.scenes ?? [];
  issues.forEach((it, k) => {
    const s = scenes[it.scene];
    const fb = fixedList[k]?.storyboard ?? fixedList[it.scene]?.storyboard;
    if (!s || !fb) return;
    s.storyboard = fb;
    patchStoryboardScene(s);
  });
}

function normalize(scenes: ScriptScene[]): ScriptScene[] {
  const kept = scenes
    .filter((s) => typeof s.narration === "string" && s.narration.trim().length > 0) // narration 必填
    .slice(0, MAX_SCENES)
    .map((s) => {
      const keyword = String(s.keyword || s.heading || "untitled")
        .trim()
        .slice(0, 8); // ≤8 字超长截断
      const storyboard = normalizeStoryboard(s.storyboard);
      return {
        keyword,
        note: String(s.note || "").trim().slice(0, 20), // ≤20 字
        heading: keyword, // heading 与关键词统一（图表匹配 + 播放器章节显示）
        bullets: (s.bullets || []).slice(0, 4).map(String),
        narration: String(s.narration || "").slice(0, MAX_NARRATION_CHARS),
        visual: storyboard ? ("storyboard" as VisualType) : normalizeVisual(s.visual),
        beats: normalizeBeats(s.beats),
        storyboard,
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

/* ---------- 30 秒快览版脚本（HyperFrames 引擎专属）：确定性零 LLM ---------- */

/** 快览版旁白总预算（中文 4 字/秒 × 30 秒 ≈ 120 字） */
const QUICK_TOTAL_NARRATION = 120;
/** 快览版单场景旁白字数上限（宣判场景给足数字空间） */
const QUICK_SCENE_NARRATION = 60;
/** 快览版一句话反差字数上限 */
const QUICK_CONTRAST_CHARS = 40;

/** scene durationFrames = 旁白字数/4 字每秒 × FPS + 1 秒缓冲，并限制在 3~12 秒 */
function quickDurationFrames(narration: string): number {
  const len = narration.replace(/\s/g, "").length;
  const sec = Math.ceil(len / 4) + 1; // +1s 呼吸缓冲
  return Math.min(12 * FPS, Math.max(3 * FPS, Math.round(sec * FPS)));
}

/** metadata 数值格式化：万级缩写（如 187000 → 18.7万），保证大数字宣判冲击力 */
function quickFormatMetric(n: number): string {
  if (n >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return n >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10);
}

/**
 * 30 秒快览版脚本：宣判式（给结论给数字），确定性生成零 LLM。
 * 三场景：① 大数字宣判（metadata 最大数值，metric 层 spring）② 一句话反差（summary 首句 ≤40 字，text 层 fade-up）
 * ③ CTA（"全文约 N 分钟，悬念留给完整版"，text 层 spring）。总旁白 ≤120 字，storyboard 由代码直接构造（三场景背景各异）。
 */
export function generateDigestScript(page: PageContent): ScriptScene[] {
  // ① 最大数值：优先 stars/forks 命中（可读性），否则取最大有限正数
  const numEntries = (Object.entries(page.metadata ?? {}).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v) && (v as number) > 0
  ) as [string, number][]).sort((a, b) => b[1] - a[1]);
  const preferred = numEntries.find(([k]) => /star/i.test(k)) ?? numEntries.find(([k]) => /fork/i.test(k));
  const metric = preferred ?? numEntries[0];
  const metricValue = metric ? quickFormatMetric(metric[1]) : "";

  // 旁白按字数预算逐场景裁剪，总口播 ≤120 字（约 30 秒）
  const narr1 = metric
    ? `${metricValue} ${metric[0]}——这是它的答案，一眼见分晓。`
    : `${page.title.slice(0, 12)}，一条快览讲清楚它凭什么值得关注。`;
  const firstSentence = (page.summary || "").split(/(?<=[。！？!?])/)[0]?.trim() ?? "";
  const contrast = firstSentence ? truncateByWidth(firstSentence, QUICK_CONTRAST_CHARS).replace(/…$/, "") : "";
  const narr2 = contrast || "它的真正看点，藏在第一句话里。";
  const bodyChars = page.sections.reduce(
    (sum, s) => sum + s.body.replace(/\s/g, "").length + (s.bullets ?? []).join("").length,
    0
  );
  const minutes = Math.max(1, Math.ceil(bodyChars / 400));
  const narr3 = `全文约 ${minutes} 分钟，悬念留给完整版。`;
  let budget = QUICK_TOTAL_NARRATION;
  const cut = (n: string) => {
    const kept = n.slice(0, Math.max(8, QUICK_SCENE_NARRATION, Math.min(n.length, budget)));
    budget -= Math.min(budget, kept.replace(/\s/g, "").length);
    return kept;
  };

  const scenes: ScriptScene[] = [
    // 场景 1：大数字宣判——深底绿光，metric 层 spring 数字滚动
    {
      keyword: metric ? `${metricValue} ${metric[0]}`.slice(0, 8) : "快览开始",
      note: metric ? "先给结论，再给数字" : "一眼见分晓",
      heading: "宣判",
      bullets: [],
      narration: cut(narr1),
      visual: "storyboard",
      hookScene: true,
      storyboard: {
        background: { type: "gradient", from: "#0b0f0e", to: "#161d28", angle: 160 },
        layers: metric
          ? [{ type: "metric", label: `${metric[0]} · 给结论`, value: metricValue, enter: { fx: "spring" } }]
          : [{ type: "text", content: page.title.slice(0, 16), size: "giant", align: "center", color: "fg", enter: { fx: "spring" } }],
        transitions: { in: "zoom", out: "fade" },
      },
    },
    // 场景 2：一句话反差——纯色深底，text 层 fade-up
    {
      keyword: "一句话反差",
      note: "摘要第一句，原样奉上",
      heading: "反差",
      bullets: [],
      narration: cut(narr2),
      visual: "storyboard",
      storyboard: {
        background: { type: "solid", from: "#10161f" },
        layers: [{ type: "text", content: contrast || narr2, size: "large", align: "left", color: "fg", enter: { fx: "fade-up" } }],
        transitions: { in: "slide-left", out: "fade" },
      },
    },
    // 场景 3：CTA——绿调渐变收尾，text 层 spring
    {
      keyword: "悬念留给完整版",
      note: "全文链接就在下方",
      heading: "去读全文",
      bullets: [],
      narration: cut(narr3),
      visual: "storyboard",
      storyboard: {
        background: { type: "gradient", from: "#0b0f0e", to: "#022c22", angle: 200 },
        layers: [
          { type: "text", content: `全文约 ${minutes} 分钟`, size: "large", align: "center", color: "accent", enter: { fx: "spring" } },
          { type: "text", content: "悬念留给完整版 →", size: "medium", align: "center", color: "sub", enter: { fx: "fade-up", delaySec: 0.6 } },
        ],
        transitions: { in: "fade", out: "fade" },
      },
    },
  ];
  for (const s of scenes) s.durationFrames = quickDurationFrames(s.narration);
  return scenes;
}
