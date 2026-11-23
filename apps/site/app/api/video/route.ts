/** 视频状态查询（site 只读）：GET 查询渲染状态；POST 不存在（渲染在 agent 端） */
import { sweepStaleRenderingJobs } from "@showcase/core/video/queue";
import { getVideoJob } from "@showcase/core/store";
import { DIMENSIONS, Orientation } from "@showcase/core/video/types";
import { NextRequest } from "next/server";

const ORIENTATIONS = ["landscape", "portrait"] as const;

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
