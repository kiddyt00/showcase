/**
 * 分析任务异步调度器：提交即返回任务 ID，进程内队列串行执行（LLM 重任务，避免并发互相拖慢），
 * 阶段进度写入 analyze_jobs 表，前端轮询展示。失败可重试。
 */
import { runAnalysis } from "./agent";
import {
  insertAnalyzeJob,
  updateAnalyzeJob,
  nextQueuedAnalyzeJob,
  getAnalyzeJob,
  listAnalyzeJobs,
  savePage,
  type AnalyzeJob,
} from "./store";
import { startRender } from "./video/queue";
import { decodeProvenance, encodeProvenance, PROVENANCE_METADATA_KEY } from "./provenance";

/** 同一时刻最多执行的分析任务数 */
const MAX_CONCURRENT = 2;
/** 超过 35 分钟仍处于 queued/running 的任务视为僵死（单次 LLM 调用最长 5 分钟 × 多轮 + 图表渲染） */
const STALE_MS = 35 * 60_000;

let running = 0;

/** 运行中任务的取消控制器（id → controller） */
const controllers = new Map<string, AbortController>();

/**
 * 取消任务：queued 直接置为已取消；running 中断其 LLM 请求后落库。
 * 返回取消后的任务状态（找不到或已终态返回 null）。
 */
export function cancelAnalyzeJob(id: string): AnalyzeJob | null {
  const job = getAnalyzeJob(id);
  if (!job) return null;
  if (job.status === "queued") {
    updateAnalyzeJob(id, {
      status: "failed",
      stage: "已取消",
      error: "用户取消（尚未开始执行）",
      finishedAt: new Date().toISOString(),
    });
    return getAnalyzeJob(id);
  }
  if (job.status === "running") {
    const ctrl = controllers.get(id);
    if (ctrl) {
      ctrl.abort();
      return getAnalyzeJob(id);
    }
    // 进程重启等导致控制器丢失：直接标记取消（executeJob 的完成回调会覆盖保护，见下）
    updateAnalyzeJob(id, {
      status: "failed",
      stage: "已取消",
      error: "用户取消",
      finishedAt: new Date().toISOString(),
    });
    return getAnalyzeJob(id);
  }
  return null;
}

/** 提交分析任务：立即入库返回，由调度器异步执行 */
export function submitAnalyzeJob(
  input: string,
  sourceType?: string,
  sessionId?: string
): AnalyzeJob {
  sweepStaleAnalyzeJobs();
  const job: AnalyzeJob = {
    id: crypto.randomUUID(),
    sessionId,
    input,
    sourceType,
    status: "queued",
    stage: "排队中",
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  insertAnalyzeJob(job);
  tryStart();
  return job;
}

/** 重试失败任务：清空错误状态重新排队 */
export function retryAnalyzeJob(id: string): AnalyzeJob | null {
  const job = getAnalyzeJob(id);
  if (!job || job.status !== "failed") return null;
  updateAnalyzeJob(id, {
    status: "queued",
    stage: "排队中",
    progress: 0,
    error: undefined,
    slug: undefined,
    startedAt: undefined,
    finishedAt: undefined,
  });
  tryStart();
  return getAnalyzeJob(id);
}

/** 调度：有空闲槽位时按创建顺序启动排队任务 */
function tryStart(): void {
  while (running < MAX_CONCURRENT) {
    const job = nextQueuedAnalyzeJob();
    if (!job) break;
    running++;
    void executeJob(job.id).finally(() => {
      running--;
      tryStart();
    });
  }
}

async function executeJob(id: string): Promise<void> {
  const job = getAnalyzeJob(id);
  if (!job || job.status !== "queued") return;
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  updateAnalyzeJob(id, { status: "running", startedAt, stage: "抓取素材" });
  try {
    const { page } = await runAnalysis(
      { input: job.input, sourceType: job.sourceType },
      (stage, progress) => {
        // 进度只前进不回退；阶段实时写库供轮询
        const cur = getAnalyzeJob(id);
        if (cur && progress >= cur.progress) {
          updateAnalyzeJob(id, { stage, progress });
        }
      },
      ctrl.signal
    );
    // 取消后到达的"完成"不覆盖取消状态
    const cur = getAnalyzeJob(id);
    if (cur?.status !== "running") {
      controllers.delete(id);
      return;
    }
    // 诞生记：savePage 前补排队耗时（任务创建→开始执行）/ 全程耗时（任务创建→此刻）/ 任务 ID / 实际开始时刻
    const prov = decodeProvenance(page.metadata[PROVENANCE_METADATA_KEY]);
    if (prov) {
      prov.jobId = id;
      prov.startedAt = startedAt;
      prov.queueMs = startedMs - Date.parse(job.createdAt);
      prov.totalMs = Date.now() - Date.parse(job.createdAt);
      page.metadata[PROVENANCE_METADATA_KEY] = encodeProvenance(prov);
    }
    savePage(page);

    // 自动排队解说视频渲染：新鲜度阶梯 quick(横) → standard(横) → standard(竖)——
    // 发布后先出 30 秒快览（1~2 分钟，HyperFrames 确定性脚本），再补完整预告片（横/竖），与原同步路径行为一致
    void (async () => {
      const queue: { o: "landscape" | "portrait"; m: "quick" | "standard" }[] = [
        { o: "landscape", m: "quick" },
        { o: "landscape", m: "standard" },
        { o: "portrait", m: "standard" },
      ];
      for (const { o, m } of queue) {
        let started = false;
        for (let attempt = 0; attempt < 40 && !started; attempt++) {
          const r = await startRender(page.slug, o, m);
          if (r === "started") started = true;
          else if (r === "busy") await new Promise((r2) => setTimeout(r2, 15_000));
          else break;
        }
      }
    })().catch(() => {});

    updateAnalyzeJob(id, {
      status: "done",
      stage: "完成",
      progress: 100,
      slug: page.slug,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    // 取消后到达的失败也不覆盖取消状态
    const cur = getAnalyzeJob(id);
    if (cur?.status === "running" || aborted) {
      updateAnalyzeJob(id, {
        status: "failed",
        stage: aborted ? "已取消" : "失败",
        error: aborted ? "用户取消" : err instanceof Error ? err.message : String(err),
        finishedAt: new Date().toISOString(),
      });
    }
  } finally {
    controllers.delete(id);
  }
}

/** 惰性清理：把超时僵死任务置为失败（进程重启后 queued/running 的任务也走这里兜底） */
export function sweepStaleAnalyzeJobs(): void {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  for (const j of listAnalyzeJobs(undefined, 100)) {
    if ((j.status === "queued" || j.status === "running") && j.createdAt < cutoff) {
      updateAnalyzeJob(j.id, {
        status: "failed",
        stage: "失败",
        error: "任务超时（超过 20 分钟未完成，可能因服务重启或渲染挂起）",
        finishedAt: new Date().toISOString(),
      });
    }
  }
}
