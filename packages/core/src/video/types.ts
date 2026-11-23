/** 视频管线类型与规格 */
export type Orientation = "landscape" | "portrait";

/** 画布规格：16:9 / 9:16 */
export const DIMENSIONS: Record<Orientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export const FPS = 30;

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
  /** 可选：本场景配图（public 相对路径，指向 diagrams SVG），存在时画面以图为主 */
  imageFile?: string;
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

export type VideoStatus = "pending" | "rendering" | "done" | "failed";

export interface VideoJob {
  slug: string;
  orientation: Orientation;
  status: VideoStatus;
  error?: string;
  videoPath?: string;
  /** 渲染进度 0~100（rendering 状态时有意义） */
  progress?: number;
  createdAt: string;
}
