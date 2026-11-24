/**
 * 开场语法轮换（r3-open 提案）：
 * 视频开场不再由 LLM 每次祈祷式自选，而是代码定规则（按分类限定的模式池 + 全局轮换台账），
 * LLM 只负责在给定模式的硬约束内"填空"。
 */
import { recordOpeningMode, getOpeningCounts } from "../store";

/** 三种开场语法：悬念解码 / 数字冲击 / 过程切入 */
export type OpeningMode = "suspense" | "number" | "process";

export const OPENING_MODES: OpeningMode[] = ["suspense", "number", "process"];

/**
 * 每个分类允许的开场模式池（按顺序参与轮换，与页面 category 对齐）。
 * 未知 category 回退为全部三种（字典序），保证任何新分类都有开场可轮换。
 */
export const POOLS: Record<string, OpeningMode[]> = {
  opensource: ["number", "suspense"],
  research: ["suspense", "process"],
  news: ["suspense", "process"],
  tutorial: ["process", "number"],
  article: ["suspense", "number", "process"],
};

/** 分类 → 本条视频允许的开场模式池；未知分类回退全部三种（按字典序，保证确定性） */
function poolFor(category: string): OpeningMode[] {
  const pool = POOLS[category];
  return pool && pool.length ? pool : OPENING_MODES;
}

/**
 * 选出本条视频的开场模式并记入台账：
 * 池内取 getOpeningCounts 全局最少者（跨分类均匀消化），平局取字典序（确定性）。
 * 未知 mode（如台账被手改出脏值）不参与最少值比较。
 */
export function pickOpeningMode(category: string, slug: string): OpeningMode {
  const pool = poolFor(category);
  const counts = getOpeningCounts();
  let mode = pool[0]!;
  let min = Infinity;
  for (const m of pool) {
    const c = counts[m] ?? 0;
    if (c < min) {
      min = c;
      mode = m;
    }
  }
  recordOpeningMode(mode, slug);
  return mode;
}

/** 开场硬约束：注入 SCRIPT_PROMPT 的 user 消息（铁律 6 由它取代，LLM 只做填空） */
export function openingDirective(mode: OpeningMode): string {
  switch (mode) {
    case "number":
      return `开场模式（已由系统分配）：number 数字冲击式。
- 分镜签名（场景 1 必须满足）：前 1.5 秒无旁白、纯画面压迫——场景 1 的 storyboard 必须含一个"最大数字"层（metric/stats/ring 三选一，enter.fx 用 spring 或 scale-blur，delaySec ≤ 0.3）；narration 的首句必须含一个真实数字。
- 禁止项：场景 1 禁止 text 层 scramble、禁止 spotlight、禁止以"你有没有想过"这类悬念问句开场。`;
    case "process":
      return `开场模式（已由系统分配）：process 过程切入式。
- 分镜签名（场景 1 必须满足）：直接从过程中间切入——场景 1 的 storyboard 必须含 terminal/flowpath/timeline 之一，且该层 beats ≥ 3（label 从 narration 提炼具体内容）；hookScene 必须为 false（不给悬念钩子，观感是"事件正在发生"）。
- 禁止项：场景 1 禁止 metric/stats/ring 开场砸数字，禁止 scramble/spotlight 悬念特效。`;
    case "suspense":
      return `开场模式（已由系统分配）：suspense 悬念解码式。
- 分镜签名（场景 1 必须满足）：text 层用 scramble 入场制造解码悬念，或 card 层用 spotlight 揭示反直觉断言（二选一必须出现）。
- 禁止项：场景 1 禁止以 metric/stats/ring 砸数字开场，禁止 hookScene=false 之外的平铺直叙陈述句开场。`;
  }
}

/** 各模式分镜签名依赖的视觉原语层（质量门与确定性修补共用） */
export const OPENING_SIGNATURE_LAYERS: Record<OpeningMode, string[]> = {
  number: ["metric", "stats", "ring"],
  process: ["terminal", "flowpath", "timeline"],
  suspense: ["text", "card"],
};
