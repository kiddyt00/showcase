/** 重试失败的分析任务：POST { id } */
import { retryAnalyzeJob, sweepStaleAnalyzeJobs } from "@showcase/core/analyze-queue";
import { NextRequest } from "next/server";
import { rateLimit, clientKey } from "@showcase/core/auth";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";

export async function POST(request: NextRequest) {
  if (isPublicMode()) return publicNotFound();
  const limited = rateLimit(`analyze-retry:${clientKey(request)}`, 20, 60_000);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return Response.json({ error: "缺少 id 字段" }, { status: 400 });

  sweepStaleAnalyzeJobs();
  const job = retryAnalyzeJob(body.id);
  if (!job) {
    return Response.json(
      { error: "任务不存在或不是失败状态，无法重试" },
      { status: 400 }
    );
  }
  return Response.json({ ok: true, job });
}
