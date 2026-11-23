/** 视频任务：POST 发起渲染（异步），GET 查询状态 */
import { renderVideo } from "@showcase/core/video/pipeline";
import {
  acquireRenderSlot,
  releaseRenderSlot,
  sweepStaleRenderingJobs,
} from "@showcase/core/video/queue";
import { upsertVideoJob, getVideoJob, getPage, setVideoJobProgress } from "@showcase/core/store";
import { DIMENSIONS, Orientation } from "@showcase/core/video/types";
import { NextRequest } from "next/server";
import { requireAdmin, rateLimit, clientKey } from "@showcase/core/auth";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";

const ORIENTATIONS = ["landscape", "portrait"] as const;

export async function POST(request: NextRequest) {
  // public 模式：不支持发起渲染（GET 保留用于查询已有视频状态）
  if (isPublicMode()) return publicNotFound();
  const denied = requireAdmin(request);
  if (denied) return denied;
  const limited = rateLimit(`video:${clientKey(request)}`, 10, 60_000);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as
    | { slug?: string; orientation?: Orientation }
    | null;
  const slug = body?.slug;
  if (body?.orientation && !(ORIENTATIONS as readonly string[]).includes(body.orientation)) {
    return Response.json(
      { error: "orientation 必须是 landscape 或 portrait" },
      { status: 400 }
    );
  }
  const orientation: Orientation =
    body?.orientation === "portrait" ? "portrait" : "landscape";
  if (!slug) return Response.json({ error: "缺少 slug" }, { status: 400 });
  if (!getPage(slug)) {
    return Response.json({ error: "页面不存在" }, { status: 404 });
  }

  // 惰性清理：把超过 15 分钟仍处于 rendering 的僵死任务置为 failed
  sweepStaleRenderingJobs();

  // 幂等：渲染中或已完成直接返回
  const existing = getVideoJob(slug, orientation);
  if (existing && (existing.status === "rendering" || existing.status === "done")) {
    return Response.json({ ok: true, job: existing });
  }

  // 并发控制：同一时刻只允许 1 个渲染任务
  if (!acquireRenderSlot()) {
    return Response.json(
      { error: "渲染队列繁忙，请稍后重试" },
      { status: 429 }
    );
  }

  const job = {
    slug,
    orientation,
    status: "rendering" as const,
    createdAt: new Date().toISOString(),
  };
  upsertVideoJob(job);

  // 后台执行（进程内异步任务）
  renderVideo(slug, orientation, (percent) =>
    setVideoJobProgress(slug, orientation, percent)
  )
    .then((videoPath) => {
      upsertVideoJob({ ...job, status: "done", progress: 100, videoPath });
    })
    .catch((err) => {
      upsertVideoJob({
        ...job,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      releaseRenderSlot();
    });

  return Response.json({ ok: true, job });
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  const orientationParam = request.nextUrl.searchParams.get("orientation") ?? "landscape";
  if (!(ORIENTATIONS as readonly string[]).includes(orientationParam)) {
    return Response.json(
      { error: "orientation 必须是 landscape 或 portrait" },
      { status: 400 }
    );
  }
  const orientation = orientationParam as Orientation;
  if (!slug) return Response.json({ error: "缺少 slug" }, { status: 400 });

  // 惰性清理：查询前把超时的 rendering 任务置为 failed
  sweepStaleRenderingJobs();

  const job = getVideoJob(slug, orientation);
  return Response.json({
    ok: true,
    job,
    url: job?.status === "done" ? `/videos/${slug}-${orientation}.mp4` : null,
    dimensions: DIMENSIONS[orientation],
  });
}
