/**
 * Provenance（诞生记）：把一次页面生成的全过程耗时与重试透明化
 * - agent.ts runAnalysis 用 createTracker() 逐阶段打点，结束时组装 Provenance
 * - 序列化为 JSON 字符串存入 PageContent.metadata（metadata 值类型固定 string|number，故存字符串）
 * - analyze-queue 补排队/全程耗时，video/queue 渲染完成后回写视频耗时
 * - site 端 ProvenancePanel 用 decodeProvenance 还原展示（解析失败一律返回 null，不抛错）
 */

/** 一个生成阶段（阶段起点偏移 + 耗时，供时间轴堆叠条展示） */
export interface ProvenanceStage {
  /** 阶段标识：collect / llm-draft / diagram-render / diagram-fix / images / redact */
  stage: string;
  /** 距开始生成的毫秒偏移（阶段起点） */
  atMs: number;
  /** 阶段耗时毫秒（到下一阶段起点或 finalize 为止） */
  durationMs: number;
}

/** LLM 生成指标 */
export interface ProvenanceLlm {
  /** 起草总调用次数（含修复轮，1~3） */
  draftAttempts: number;
  /** JSON 解析失败后的反馈修复重试次数（0~2） */
  jsonRepairs: number;
  /** 两轮修复均失败、降级为素材兜底文章 */
  fallbackUsed: boolean;
}

/** 图表渲染漏斗指标 */
export interface ProvenanceDiagrams {
  /** LLM 产出且通过校验的图表数（渲染前快照；渲染过程会剔除失败图） */
  requested: number;
  /** 首轮渲染失败数 */
  initialFailures: number;
  /** LLM spec 修正调用次数 */
  fixCalls: number;
  /** spec 修正成功的图表 id */
  fixedIds: string[];
  /** 修正重渲染后仍失败数 */
  finalFailures: number;
  /** 是否触发过修正重渲染轮 */
  retried: boolean;
}

/** 章节配图指标 */
export interface ProvenanceImages {
  /** 实际发起下载的搜索词（LLM 声明的 imageQuery） */
  queries: string[];
  /** 成功下载并回填的图片数 */
  downloaded: number;
}

/** 脱敏记录 */
export interface ProvenanceRedact {
  /** 规则名 → 命中次数（空对象 = 未命中） */
  hits: Record<string, number>;
}

/** 视频渲染指标（渲染完成后由 video/queue 异步回写） */
export interface ProvenanceVideo {
  /** none=未渲染过；done=最近一次成功；failed=最近一次失败 */
  status: string;
  /** 横版渲染耗时毫秒 */
  landscapeMs?: number;
  /** 竖版渲染耗时毫秒 */
  portraitMs?: number;
}

/** 一次页面生成的全过程档案 */
export interface Provenance {
  /** 结构版本（字段演进时递增，站点端按版本容错） */
  schemaVersion: number;
  /** 关联的分析任务 ID（analyze-queue executeJob 回填） */
  jobId?: string;
  /** 使用的 LLM 模型名 */
  model: string;
  /** 开始生成时刻（ISO，executeJob 用任务执行开始时间覆盖） */
  startedAt: string;
  /** 组装完成时刻（ISO） */
  finishedAt?: string;
  /** 排队等待毫秒（任务创建 → 开始执行，executeJob 回填） */
  queueMs?: number;
  /** 全程耗时毫秒（任务创建 → 保存完成，executeJob 回填） */
  totalMs?: number;
  /** 各阶段时间轴 */
  stages: ProvenanceStage[];
  llm: ProvenanceLlm;
  diagrams: ProvenanceDiagrams;
  images: ProvenanceImages;
  redact: ProvenanceRedact;
  video: ProvenanceVideo;
}

export const PROVENANCE_SCHEMA_VERSION = 1;

/** metadata 中的 provenance 键（值为 JSON 字符串） */
export const PROVENANCE_METADATA_KEY = "provenance";

/** 模型名与 deepseek.ts 同源读取（该模块不导出常量，这里保持相同默认值） */
const LLM_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

/** 计时器：各阶段打点 + 指标累加，finalize 产出完整 Provenance */
export interface ProvenanceTracker {
  /** 开启新阶段并闭合上一阶段（与 onStage 进度回调同步调用） */
  stage(name: string): void;
  /** LLM 指标区（管线直接累加） */
  llm: ProvenanceLlm;
  /** 图表指标区 */
  diagrams: ProvenanceDiagrams;
  /** 配图指标区 */
  images: ProvenanceImages;
  /** 脱敏指标区 */
  redact: ProvenanceRedact;
  /** 视频指标区（渲染完成后由 video/queue 回写） */
  video: ProvenanceVideo;
  /** 闭合最后阶段并产出完整 Provenance（queueMs/totalMs/jobId 由 executeJob 回填） */
  finalize(): Provenance;
}

export function createTracker(): ProvenanceTracker {
  const startedMs = Date.now();
  const stages: ProvenanceStage[] = [];
  let open: { stage: string; atMs: number } | null = null;

  const closeOpen = (): void => {
    if (!open) return;
    stages.push({
      stage: open.stage,
      atMs: open.atMs,
      durationMs: Math.max(0, Date.now() - startedMs - open.atMs),
    });
    open = null;
  };

  const llm: ProvenanceLlm = { draftAttempts: 0, jsonRepairs: 0, fallbackUsed: false };
  const diagrams: ProvenanceDiagrams = {
    requested: 0,
    initialFailures: 0,
    fixCalls: 0,
    fixedIds: [],
    finalFailures: 0,
    retried: false,
  };
  const images: ProvenanceImages = { queries: [], downloaded: 0 };
  const redact: ProvenanceRedact = { hits: {} };
  const video: ProvenanceVideo = { status: "none" };

  return {
    stage(name: string): void {
      closeOpen();
      open = { stage: name, atMs: Date.now() - startedMs };
    },
    llm,
    diagrams,
    images,
    redact,
    video,
    finalize(): Provenance {
      closeOpen();
      return {
        schemaVersion: PROVENANCE_SCHEMA_VERSION,
        model: LLM_MODEL,
        startedAt: new Date(startedMs).toISOString(),
        finishedAt: new Date().toISOString(),
        stages,
        llm: { ...llm },
        diagrams: { ...diagrams, fixedIds: [...diagrams.fixedIds] },
        images: { ...images, queries: [...images.queries] },
        redact: { hits: { ...redact.hits } },
        video: { ...video },
      };
    },
  };
}

/** 序列化进 metadata（值类型固定 string|number，故存 JSON 字符串） */
export function encodeProvenance(p: Provenance): string {
  return JSON.stringify(p);
}

/* ---------- decodeProvenance 的防御性窄化工具（站点端渲染外部数据，绝不抛错） ---------- */

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asNumberRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const rec = asRecord(v);
  if (rec) {
    for (const [k, n] of Object.entries(rec)) {
      const num = asNumber(n);
      if (num !== undefined) out[k] = num;
    }
  }
  return out;
}

/** 从 metadata 值还原 Provenance（非字符串/损坏/缺关键字段时返回 null） */
export function decodeProvenance(raw: unknown): Provenance | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = asRecord(parsed);
  if (!o) return null;
  const schemaVersion = asNumber(o.schemaVersion);
  if (schemaVersion === undefined) return null;

  const llm = asRecord(o.llm);
  const diagrams = asRecord(o.diagrams);
  const images = asRecord(o.images);
  const redact = asRecord(o.redact);
  const video = asRecord(o.video);

  const stages: ProvenanceStage[] = Array.isArray(o.stages)
    ? o.stages.flatMap((s) => {
        const r = asRecord(s);
        const stage = r ? asString(r.stage) : undefined;
        const atMs = r ? asNumber(r.atMs) : undefined;
        const durationMs = r ? asNumber(r.durationMs) : undefined;
        return stage !== undefined && atMs !== undefined && durationMs !== undefined
          ? [{ stage, atMs, durationMs }]
          : [];
      })
    : [];

  return {
    schemaVersion,
    jobId: asString(o.jobId),
    model: asString(o.model) ?? "",
    startedAt: asString(o.startedAt) ?? "",
    finishedAt: asString(o.finishedAt),
    queueMs: asNumber(o.queueMs),
    totalMs: asNumber(o.totalMs),
    stages,
    llm: {
      draftAttempts: asNumber(llm?.draftAttempts) ?? 0,
      jsonRepairs: asNumber(llm?.jsonRepairs) ?? 0,
      fallbackUsed: llm?.fallbackUsed === true,
    },
    diagrams: {
      requested: asNumber(diagrams?.requested) ?? 0,
      initialFailures: asNumber(diagrams?.initialFailures) ?? 0,
      fixCalls: asNumber(diagrams?.fixCalls) ?? 0,
      fixedIds: asStringArray(diagrams?.fixedIds),
      finalFailures: asNumber(diagrams?.finalFailures) ?? 0,
      retried: diagrams?.retried === true,
    },
    images: {
      queries: asStringArray(images?.queries),
      downloaded: asNumber(images?.downloaded) ?? 0,
    },
    redact: { hits: asNumberRecord(redact?.hits) },
    video: {
      status: asString(video?.status) ?? "none",
      landscapeMs: asNumber(video?.landscapeMs),
      portraitMs: asNumber(video?.portraitMs),
    },
  };
}
