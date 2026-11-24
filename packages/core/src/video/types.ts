/** 视频管线类型与规格 */
export type Orientation = "landscape" | "portrait";

/** 画布规格：16:9 / 9:16 */
export const DIMENSIONS: Record<Orientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export const FPS = 30;

/** 视频模式：standard=动画模板；slides=HTML 幻灯片截图画面 */
export type VideoMode = "standard" | "slides";

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
  /** 动画模板：v4 动效图解元素（flowpath/stackboxes/terminal/counter/compare/text），diagram 走 SeeCode 动画，slide 走幻灯片截图；stepflow/stacklayers 为 v3 兼容别名 */
  visual?: "text" | "diagram" | "code" | "counter" | "flowpath" | "stackboxes" | "terminal" | "compare" | "stepflow" | "stacklayers" | "slide";
  /** 超大关键词（≤8 字）：替代旧 heading 大标题 */
  keyword?: string;
  /** 关键词下的一行小注（≤20 字） */
  note?: string;
  /** 模板节拍：atWord 匹配 timeline 中的词 → 动画触发时刻 */
  beats?: { atWord: string; action?: string; content?: string; label?: string }[];
  /** 开场钩子场景标记（来自脚本层） */
  hookScene?: boolean;
}

/** 一次视频任务 */
export interface VideoJobSpec {
  slug: string;
  orientation: Orientation;
  title: string;
  icon?: string;
  tags: string[];
  scenes: Scene[];
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
