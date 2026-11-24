/** 视频管线类型与规格 */
export type Orientation = "landscape" | "portrait";

import type { ScriptBeat } from "./script";

/** 画布规格：16:9 / 9:16 */
export const DIMENSIONS: Record<Orientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export const FPS = 30;

/** 视频模式：standard=Remotion 动画模板；slides=HTML 幻灯片截图；hyperframes=HTML+GSAP 组合（同分镜，另一引擎） */
export type VideoMode = "standard" | "slides" | "hyperframes";

/** 一个视频场景 = 一张幻灯片 + 一段配音 */
export interface Scene {
  heading: string;
  bullets: string[];
  /** 口播文稿 */
  narration: string;
  /** 音频文件名（位于视频资产目录内） */
  audioFile: string;
  /** 该场景帧数（由音频时长决定） */
  durationFrames: number;
  /** 可选：幻灯片模式截图（public 相对路径），存在时全屏铺满替代默认布局 */
  slideFile?: string;
  /** 可选：本场景配图（public 相对路径，指向 diagrams SVG），存在时画面以图为主 */
  imageFile?: string;
  /** 可选：图表动画视频（public 相对路径，指向 diagrams MP4），存在时替代静态 imageFile */
  videoFile?: string;
  /** 可选：代码场景——终端窗口 + 打字机动画 */
  code?: { language: string; content: string };
  /** 可选：数字滚动场景——大号数字 0→value 滚动 + label */
  counter?: { label: string; value: number; suffix?: string };
  /** 词级时间戳（TTS 产出，音画同步用），空/缺失时字幕与动画退回均分驱动 */
  timeline?: { word: string; startMs: number; endMs: number }[];
  /** 动画模板：v4 动效图解元素（flowpath/stackboxes/terminal/counter/compare/text），diagram 走 SeeCode 动画，slide 走幻灯片截图；stepflow/stacklayers 为 v3 兼容别名；storyboard 存在时优先 */
  visual?: "text" | "diagram" | "code" | "counter" | "flowpath" | "stackboxes" | "terminal" | "compare" | "stepflow" | "stacklayers" | "slide" | "storyboard";
  /** 超大关键词（≤8 字）：替代旧 heading 大标题 */
  keyword?: string;
  /** 关键词下的一行小注（≤20 字） */
  note?: string;
  /** 模板节拍：atWord 匹配 timeline 中的词 → 动画触发时刻 */
  beats?: { atWord: string; action?: string; content?: string; label?: string }[];
  /** 开场钩子场景标记（来自脚本层） */
  hookScene?: boolean;
  /* ---------- v5 分镜 storyboard：LLM 自由组合视觉原语，存在时优先于 visual 模板 ---------- */
  /** 完整分镜声明（背景 + 层栈 + 转场），由脚本层校验产出 */
  storyboard?: {
    /** 背景层声明 */
    background?: StoryboardBackground;
    /** 视觉层栈（按声明顺序叠加渲染） */
    layers?: StoryboardLayer[];
    /** 入场/出场转场（缺省 slide + fade） */
    transitions?: { in?: TransitionFx; out?: TransitionFx };
  };
}

/** 分镜背景：纯色/渐变，克制不抢内容 */
export interface StoryboardBackground {
  type: "solid" | "gradient";
  /** solid 色值或 gradient 起色 */
  from: string;
  /** gradient 止色（type=gradient 时必填） */
  to?: string;
  /** gradient 角度 */
  angle?: number;
}

/** 入场动效枚举：渲染端原语注册表（fx.ts）决定可用集合 */
export type EnterFx =
  | "fade-up"        // 淡入上移（默认）
  | "spring"         // 弹簧过冲
  | "scramble"       // 字符解码（仅文字层）
  | "border-beam"    // 光束沿边框扫一圈（仅卡片层）
  | "spotlight"      // 聚光扫过（仅卡片层）
  | "scale-blur";    // 缩放+模糊聚焦

export type TransitionFx = "slide-left" | "slide-right" | "fade" | "zoom";

export type StoryboardLayer =
  | { type: "text"; content: string; size?: "giant" | "large" | "medium" | "small"; align?: "left" | "center"; enter?: { fx: EnterFx; delaySec?: number }; color?: "fg" | "accent" | "sub" }
  | { type: "card"; title?: string; body?: string; enter?: { fx: EnterFx; delaySec?: number }; accent?: boolean }
  | { type: "metric"; label: string; value: string; enter?: { fx: EnterFx; delaySec?: number } }
  | { type: "image"; src: string; enter?: { fx: EnterFx; delaySec?: number } }
  | { type: "video"; src: string; enter?: { fx: EnterFx; delaySec?: number } }
  /** 进度环：ratio 0~1，讲占比/完成度/增长幅度 */
  | { type: "ring"; ratio: number; label: string; centerText?: string; enter?: { fx: EnterFx; delaySec?: number } }
  /** 横向步骤时间轴：讲顺序/阶段/工序，steps 2~5 个 */
  | { type: "timeline"; steps: string[]; enter?: { fx: EnterFx; delaySec?: number } }
  /** 多数字网格：讲一组并列数据（财报/指标面板），2~4 项 */
  | { type: "stats"; stats: { label: string; value: string; delta?: string }[]; enter?: { fx: EnterFx; delaySec?: number } }
  /** 金句卡：讲观点/结论/引用，quote ≤44 字 */
  | { type: "quote"; quote: string; author?: string; enter?: { fx: EnterFx; delaySec?: number } }
  /** 实拍图片层：query 为英文搜索词，管线用 Pexels 下载后回填 src */
  | { type: "photo"; query: string; src?: string; caption?: string; enter?: { fx: EnterFx; delaySec?: number } }
  /** 实拍视频片段层（短空镜内嵌）：query 为英文搜索词，管线下载后回填 src */
  | { type: "clip"; query: string; src?: string; caption?: string; enter?: { fx: EnterFx; delaySec?: number } }
  /** 复合原语：v4 模板作为可嵌入层继续可用；beats 必须内联（label 从 narration 提炼） */
  | { type: "flowpath" | "stackboxes" | "terminal" | "compare" | "counter-diagram"; beats?: ScriptBeat[]; enter?: { fx: EnterFx; delaySec?: number } };

/** 一次视频任务 */
export interface VideoJobSpec {
  slug: string;
  orientation: Orientation;
  title: string;
  icon?: string;
  tags: string[];
  scenes: Scene[];
  /** 可选：背景音乐（public 相对路径，public/videos/bgm.mp3 存在时自动混入，低音量循环） */
  bgmFile?: string;
}

/** 章节摘要：给播放器时间轴用 */
export interface SceneSummary {
  heading: string;
  /** 超大关键词（≤8 字，v4 动效图解） */
  keyword?: string;
  /** 一行小注（≤20 字） */
  note?: string;
  /** 口播字数（去空白） */
  narrationChars?: number;
  /** 该场景时长（秒） */
  seconds: number;
  /** 动画模板类型（缺省 text；验证/观测用） */
  visual?: Scene["visual"];
  /** 词级时间戳词条数（0 = 未产出，渲染端均分降级） */
  timelineWords?: number;
}

export type VideoStatus = "pending" | "rendering" | "done" | "failed";

export interface VideoJob {
  slug: string;
  orientation: Orientation;
  status: VideoStatus;
  error?: string;
  videoPath?: string;
  /** 渲染进度 0~100（rendering 状态时有意义） */
  progress?: number;
  /** 渲染完成后的场景摘要（章节时间轴） */
  scenes?: SceneSummary[];
  createdAt: string;
}
