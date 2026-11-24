/**
 * 视频渲染队列：模块级并发控制 + 惰性超时清理
 * - 全进程同时只允许 1 个渲染任务（Remotion/ffmpeg 资源重）
 * - rendering 状态超过 15 分钟的任务视为僵死，惰性置为 failed 允许重试
 */
import { db, upsertVideoJob, getVideoJob, getPage, setVideoJobProgress } from "../store";
import type { Orientation, VideoMode } from "./types";

export const MAX_CONCURRENT_RENDERS = 1;
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

let activeRenders = 0;

export function renderSlotAvailable(): boolean {
  return activeRenders < MAX_CONCURRENT_RENDERS;
}

/** 占用一个渲染槽；调用方渲染结束后必须调用 releaseRenderSlot */
export function acquireRenderSlot(): boolean {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) return false;
  activeRenders += 1;
  return true;
}

export function releaseRenderSlot(): void {
  activeRenders = Math.max(0, activeRenders - 1);
}

/** 渲染超时的僵死任务自动置 failed，可重试 */
export function sweepStaleRenderingJobs(): void {
  const cutoff = new Date(Date.now() - RENDER_TIMEOUT_MS).toISOString();
  const stale = db
    .prepare(
      `SELECT slug, orientation, created_at FROM video_jobs WHERE status = 'rendering' AND created_at < ?`
    )
    .all(cutoff) as { slug: string; orientation: string; created_at: string }[];
  for (const row of stale) {
    const existing = db
      .prepare(`SELECT status FROM video_jobs WHERE slug = ? AND orientation = ?`)
      .get(row.slug, row.orientation);
    if (!existing) continue;
    upsertVideoJob({
      slug: row.slug,
      orientation: row.orientation as Orientation,
      status: "failed",
      error: "渲染超时，可重试",
      createdAt: row.created_at,
    });
  }
}

/* ---------- 统一入队：内容创建后自动渲染 ---------- */
import { renderVideo } from "./pipeline";

export type StartRenderResult = "started" | "exists" | "busy" | "not-found";

/**
 * 发起渲染（带信号量与幂等）。site/agent/agent 工具三方共用。
 * progress 写入 video_jobs，前端轮询展示。
 */
export async function startRender(
  slug: string,
  orientation: Orientation,
  mode: VideoMode = "standard"
): Promise<StartRenderResult> {
  sweepStaleRenderingJobs();
  const existing = getVideoJob(slug, orientation);
  // 幂等：渲染中或已完成直接返回（slides 模式产物与标准版不同名，done 不拦截以便补产幻灯片版）
  if (existing && (existing.status === "rendering" || (existing.status === "done" && mode !== "slides"))) {
    return "exists";
  }
  if (!getPage(slug)) return "not-found";
  if (!acquireRenderSlot()) return "busy";

  const job = {
    slug,
    orientation,
    status: "rendering" as const,
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  upsertVideoJob(job);
  renderVideo(slug, orientation, (percent) =>
    setVideoJobProgress(slug, orientation, percent), mode
  )
    .then(({ path, scenes }) => {
      upsertVideoJob({ ...job, status: "done", progress: 100, videoPath: path, scenes });
    })
    .catch((err) => {
      upsertVideoJob({
        ...job,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => releaseRenderSlot());
  return "started";
}
