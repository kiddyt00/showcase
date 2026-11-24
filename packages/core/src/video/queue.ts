/**
 * 视频渲染队列：模块级并发控制 + 惰性超时清理
 * - 全进程同时只允许 1 个渲染任务（Remotion/ffmpeg 资源重）
 * - rendering 状态超过 15 分钟的任务视为僵死，惰性置为 failed 允许重试
 */
import { db, upsertVideoJob, getVideoJob, getPage, setVideoJobProgress, updatePageMetadata } from "../store";
import { decodeProvenance, encodeProvenance, PROVENANCE_METADATA_KEY } from "../provenance";
import type { Orientation, VideoMode } from "./types";

export const MAX_CONCURRENT_RENDERS = 1;
/** 渲染超时阈值：必须 ≥ 渲染器自身超时（HyperFrames 20 分钟），否则活任务会被 sweep 误杀 */
const RENDER_TIMEOUT_MS = 25 * 60 * 1000;

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

/** 渲染超时的僵死任务自动置 failed，可重试。
 *  修复 R5-BUG1：查询与回写都带 mode——不同 mode 共用一行 (slug,orientation)，
 *  不带 mode 的清理会把另一引擎仍在跑的任务误标失败并互相覆盖状态 */
export function sweepStaleRenderingJobs(): void {
  const cutoff = new Date(Date.now() - RENDER_TIMEOUT_MS).toISOString();
  const stale = db
    .prepare(
      `SELECT slug, orientation, mode, created_at FROM video_jobs WHERE status = 'rendering' AND created_at < ?`
    )
    .all(cutoff) as { slug: string; orientation: string; mode: string | null; created_at: string }[];
  for (const row of stale) {
    upsertVideoJob({
      slug: row.slug,
      orientation: row.orientation as Orientation,
      status: "failed",
      error: "渲染超时，可重试",
      createdAt: row.created_at,
      mode: (row.mode as import("./types").VideoMode) ?? "standard",
    });
  }
}

/* ---------- 统一入队：内容创建后自动渲染 ---------- */
import { renderVideo } from "./pipeline";
import { renderVideoHyperframes } from "./hyperframes";

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
  // 幂等按 (slug, orientation, mode) 判断：quick/slides/hyperframes 产物与标准版不同名，
  // 行内记录最近一次任务的 mode——done 且 mode 相同才拦截，否则允许补产其他版本
  if (existing && (existing.status === "rendering" || (existing.status === "done" && (existing.mode ?? "standard") === mode))) {
    return "exists";
  }
  if (!getPage(slug)) return "not-found";
  if (!acquireRenderSlot()) return "busy";

  const job = {
    slug,
    orientation,
    status: "rendering" as const,
    progress: 0,
    mode,
    createdAt: new Date().toISOString(),
  };
  upsertVideoJob(job);
  const renderStartedMs = Date.now(); // 渲染耗时起点（两种引擎路径共用）
  // quick（30 秒快览）是 HyperFrames 引擎专属：确定性脚本自带分镜，走 buildSpec(page, orientation, "quick")
  const pipeline =
    mode === "hyperframes" || mode === "quick"
      ? renderVideoHyperframes(slug, orientation, (p) => setVideoJobProgress(slug, orientation, p), mode)
      : renderVideo(slug, orientation, (percent) => setVideoJobProgress(slug, orientation, percent), mode);
  pipeline
    .then(({ path, scenes }) => {
      upsertVideoJob({ ...job, status: "done", progress: 100, videoPath: path, scenes });
      writeProvenanceVideoMs(slug, orientation, Date.now() - renderStartedMs, "done");
    })
    .catch((err) => {
      upsertVideoJob({
        ...job,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      writeProvenanceVideoMs(slug, orientation, Date.now() - renderStartedMs, "failed");
    })
    .finally(() => releaseRenderSlot());
  return "started";
}

/** 渲染结束（成功或失败）后回写诞生记的视频耗时与状态：读改 metadata.provenance 单键，页面不存在时静默跳过 */
function writeProvenanceVideoMs(
  slug: string,
  orientation: Orientation,
  elapsedMs: number,
  status: "done" | "failed"
): void {
  try {
    const page = getPage(slug);
    if (!page) return;
    const prov = decodeProvenance(page.metadata[PROVENANCE_METADATA_KEY]);
    if (!prov) return; // 旧页面无 provenance：不补造，保持静默
    if (orientation === "portrait") {
      prov.video.portraitMs = elapsedMs;
    } else {
      prov.video.landscapeMs = elapsedMs;
    }
    prov.video.status = status; // 最近一次渲染结果（横竖版各自回写，后写覆盖）
    updatePageMetadata(slug, PROVENANCE_METADATA_KEY, encodeProvenance(prov));
  } catch {
    /* 回写失败只影响诞生记展示，不碰渲染结果 */
  }
}
