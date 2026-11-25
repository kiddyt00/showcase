/**
 * 诞生记面板（服务端组件）：<details> 折叠展示一次页面生成的全过程档案
 * - 折叠态：一行摘要（总耗时 / 模型 / 关键重试）
 * - 展开态：时间轴堆叠条 / 图表修正漏斗 / LLM 重试 / 脱敏记录 / 视频耗时
 * 数据来自 metadata.provenance（JSON 字符串），经 decodeProvenance 还原；缺失或损坏时整块不渲染。
 */
import type { Provenance } from "@showcase/core/provenance";
import { decodeProvenance } from "@showcase/core/provenance";

/** 各阶段标识 → 展示名 */
const STAGE_LABELS: Record<string, string> = {
  collect: "抓取素材",
  "llm-draft": "AI 分析",
  "diagram-render": "图表渲染",
  "diagram-fix": "图表修正",
  images: "抓取配图",
  redact: "脱敏",
  finalize: "组装",
};

/** 各阶段的堆叠条配色（editorial 主题的克制色阶） */
const STAGE_COLORS: Record<string, string> = {
  collect: "#a8a29e",
  "llm-draft": "#b3452e",
  "diagram-render": "#57534e",
  "diagram-fix": "#9a3412",
  images: "#78716c",
  redact: "#44403c",
  finalize: "#d6d3d1",
};

const MS_PER_S = 1000;

/** 毫秒 → 可读时长（<1s 显示毫秒，否则秒，一小时以上进分钟） */
function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < MS_PER_S) return `${Math.round(ms)} ms`;
  if (ms < 60 * MS_PER_S) return `${(ms / MS_PER_S).toFixed(1)} 秒`;
  return `${Math.round(ms / MS_PER_S / 60)} 分钟`;
}

export default function ProvenancePanel({
  provenance,
  slug,
  seal,
}: {
  /** metadata.provenance 的原始值（JSON 字符串），由本组件负责解析 */
  provenance: unknown;
  /** 页面 slug（展示用） */
  slug: string;
  /** 印次章 GenSeal（ReactNode，由 PageView 传入）：渲染在折叠行最右侧（与"诞生记"文字同行） */
  seal?: React.ReactNode;
}) {
  const prov = decodeProvenance(provenance);
  if (!prov) return null;

  const stages = prov.stages.filter((s) => s.durationMs > 0);
  const stagesTotal = stages.reduce((n, s) => n + s.durationMs, 0);
  const hasVideoMs = prov.video.landscapeMs !== undefined || prov.video.portraitMs !== undefined;

  // 折叠态一行摘要：全程耗时 + 模型 + 值得一提的重试事件
  const retryBits: string[] = [];
  if (prov.llm.fallbackUsed) retryBits.push("LLM 降级兜底");
  else if (prov.llm.jsonRepairs > 0) retryBits.push(`JSON 修复 ${prov.llm.jsonRepairs} 次`);
  if (prov.diagrams.fixCalls > 0) retryBits.push(`图表修正 ${prov.diagrams.fixCalls} 次`);
  if (Object.keys(prov.redact.hits).length) retryBits.push("触发脱敏");
  if (hasVideoMs) retryBits.push("含视频渲染");

  return (
    <details className="mb-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] text-xs text-muted">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 marker:content-none hover:text-[var(--fg)]">
        <span className="min-w-0">
          <span className="font-medium text-[var(--fg)]">诞生记</span>
          {" · "}全程 {fmtMs(prov.totalMs)}
          {" · "}{prov.model || "未知模型"}
          {retryBits.length ? ` · ${retryBits.join(" / ")}` : ""}
        </span>
        {/* 印次章：与"诞生记"文字同行，折叠行最右（点击印章不切换折叠态） */}
        {seal ? (
          <span
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center"
          >
            {seal}
          </span>
        ) : null}
      </summary>

      <div className="space-y-5 border-t border-[var(--border)] px-4 pb-4 pt-4">
        {/* 时间轴：阶段耗时按占比堆叠成一条横条 */}
        {stages.length > 0 && (
          <section>
            <p className="mb-2 font-semibold text-[var(--fg)]">生成时间轴</p>
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--border)]"
              role="img"
              aria-label={`各阶段耗时占比，共 ${stages.length} 个阶段`}
            >
              {stages.map((s, i) => (
                <div
                  key={`${s.stage}-${i}`}
                  title={`${STAGE_LABELS[s.stage] ?? s.stage} ${fmtMs(s.durationMs)}`}
                  style={{
                    width: `${Math.max(1, (s.durationMs / Math.max(stagesTotal, 1)) * 100)}%`,
                    background: STAGE_COLORS[s.stage] ?? "#a8a29e",
                  }}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {stages.map((s, i) => (
                <li key={`${s.stage}-${i}`} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: STAGE_COLORS[s.stage] ?? "#a8a29e" }}
                  />
                  {STAGE_LABELS[s.stage] ?? s.stage}
                  <span className="tabular-nums">{fmtMs(s.durationMs)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5">
              排队 {fmtMs(prov.queueMs)} · 任务 {prov.jobId ? prov.jobId.slice(0, 8) : "—"} ·
              开始 {prov.startedAt ? prov.startedAt.slice(0, 19).replace("T", " ") : "—"}
            </p>
          </section>
        )}

        {/* 图表修正漏斗：请求 → 首轮失败 → LLM 修正 → 终态 */}
        {prov.diagrams.requested > 0 && (
          <section>
            <p className="mb-2 font-semibold text-[var(--fg)]">图表修正漏斗</p>
            <p className="tabular-nums">
              请求渲染 {prov.diagrams.requested} 张 → 首轮失败 {prov.diagrams.initialFailures} 张
              {prov.diagrams.retried ? (
                <>
                  {" "}→ LLM 修正 {prov.diagrams.fixCalls} 次（
                  {prov.diagrams.fixedIds.length ? `修正成功 ${prov.diagrams.fixedIds.join("、")}` : "全部修正失败"}
                  ）→ 仍失败 {prov.diagrams.finalFailures} 张
                </>
              ) : (
                " → 一次通过"
              )}
            </p>
          </section>
        )}

        {/* LLM 生成过程：起草轮次 / JSON 修复 / 降级兜底 */}
        <section>
          <p className="mb-2 font-semibold text-[var(--fg)]">LLM 生成过程</p>
          <p className="tabular-nums">
            起草 {prov.llm.draftAttempts} 轮（{prov.model || "未知模型"}）
            {prov.llm.jsonRepairs > 0 ? ` · JSON 修复重试 ${prov.llm.jsonRepairs} 次` : " · 一次通过"}
            {prov.llm.fallbackUsed ? " · 两轮修复失败，已降级为素材兜底文章" : ""}
          </p>
        </section>

        {/* 章节配图 + 脱敏记录 */}
        {(prov.images.queries.length > 0 || Object.keys(prov.redact.hits).length > 0) && (
          <section>
            <p className="mb-2 font-semibold text-[var(--fg)]">素材与脱敏</p>
            {prov.images.queries.length > 0 && (
              <p className="tabular-nums">
                配图检索 {prov.images.queries.length} 次（{prov.images.queries.join("、")}），成功下载{" "}
                {prov.images.downloaded} 张
              </p>
            )}
            {Object.keys(prov.redact.hits).length > 0 ? (
              <p className="tabular-nums">
                脱敏命中：
                {Object.entries(prov.redact.hits)
                  .map(([rule, n]) => `${rule} × ${n}`)
                  .join("；")}
              </p>
            ) : (
              <p>脱敏扫描未命中敏感信息。</p>
            )}
          </section>
        )}

        {/* 视频耗时（video/queue 渲染完成后异步回写，可能晚于页面首次发布） */}
        {hasVideoMs && (
          <section>
            <p className="mb-2 font-semibold text-[var(--fg)]">视频渲染耗时</p>
            <p className="tabular-nums">
              横版 {fmtMs(prov.video.landscapeMs)} · 竖版 {fmtMs(prov.video.portraitMs)} · 最近一次渲染
              {prov.video.status === "done" ? "成功" : prov.video.status === "failed" ? "失败" : prov.video.status}
            </p>
          </section>
        )}

        <p className="text-[10px] opacity-70">
          档案 v{prov.schemaVersion} · /show/{slug} · 生成于{" "}
          {prov.finishedAt ? prov.finishedAt.slice(0, 19).replace("T", " ") : "—"}
        </p>
      </div>
    </details>
  );
}
