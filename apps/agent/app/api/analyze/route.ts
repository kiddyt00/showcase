/** 分析任务接口：POST 提交（异步，立即返回任务 ID），GET 查询状态 */
import { submitAnalyzeJob, sweepStaleAnalyzeJobs } from "@showcase/core/analyze-queue";
import { getAnalyzeJob, listAnalyzeJobs } from "@showcase/core/store";
import { AnalyzeRequest } from "@showcase/core/types";
import { NextRequest } from "next/server";
import { rateLimit, clientKey } from "@showcase/core/auth";
import { isPublicMode, publicNotFound } from "@showcase/core/mode";

export async function POST(request: NextRequest) {
  // public 模式：分析接口不存在
  if (isPublicMode()) return publicNotFound();
  const limited = rateLimit(`analyze:${clientKey(request)}`, 10, 60_000);
  if (limited) return limited;
  let body: AnalyzeRequest & { sessionId?: string };
  try {
    body = (await request.json()) as AnalyzeRequest & { sessionId?: string };
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!body.input?.trim()) {
    return Response.json({ error: "缺少 input 字段" }, { status: 400 });
  }

  const job = submitAnalyzeJob(body.input.trim(), body.sourceType, body.sessionId);
  return Response.json({ ok: true, jobId: job.id, job });
}

export async function GET(request: NextRequest) {
  // public 模式：状态查询也属于能力面
  if (isPublicMode()) return publicNotFound();
  sweepStaleAnalyzeJobs();

  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const job = getAnalyzeJob(id);
    if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
    return Response.json({
      ok: true,
      job,
      url: job.slug ? `/show/${job.slug}` : null,
    });
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const jobs = listAnalyzeJobs(sessionId ?? undefined, 20);
  return Response.json({ ok: true, jobs });
}
