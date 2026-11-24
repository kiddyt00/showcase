"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalyzeJob } from "@showcase/core/store";

const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  done: "已完成",
  failed: "失败",
};

/** Agent 交互输入框：说一句"分析 xxx"即可（异步任务：提交即返回，轮询进度） */
export default function AnalyzeForm() {
  const [input, setInput] = useState("");
  const [job, setJob] = useState<AnalyzeJob | null>(null);
  const [error, setError] = useState("");
  const jobRef = useRef<AnalyzeJob | null>(null);

  /* 提交后轮询任务状态 */
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/analyze?id=${job.id}`);
        const data = await res.json();
        if (data.job) {
          jobRef.current = data.job;
          setJob(data.job);
        }
      } catch {
        /* 忽略，下轮重试 */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [job]);

  const active = !!job && (job.status === "queued" || job.status === "running");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || active) return;
    setError("");
    setJob(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交失败");
      setJob(data.job);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    }
  }

  async function retry() {
    if (!job) return;
    try {
      const res = await fetch("/api/analyze/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重试失败");
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败");
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='告诉 Agent 分析什么，例如：分析 vercel/next.js，或粘贴一篇文章 URL'
          aria-label="分析内容输入"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          disabled={active}
        />
        <button
          type="submit"
          disabled={active || !input.trim()}
          className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {active ? "后台分析中…" : "开始分析"}
        </button>
      </form>

      {job && (
        <div
          className={`mt-3 rounded-lg border px-4 py-3 text-xs ${
            job.status === "failed"
              ? "border-red-900 bg-red-950/40"
              : job.status === "done"
                ? "border-emerald-800 bg-emerald-950/30"
                : "border-zinc-700 bg-zinc-950"
          }`}
        >
          <div className="flex items-center gap-2 font-mono">
            <span className="text-zinc-500">任务 {job.id.slice(0, 8)}</span>
            <span
              className={`ml-auto ${
                job.status === "failed"
                  ? "text-red-400"
                  : job.status === "done"
                    ? "text-emerald-400"
                    : "text-yellow-400"
              }`}
            >
              {STAGE_LABELS[job.status] ?? job.status}
            </span>
          </div>
          {(job.status === "queued" || job.status === "running") && (
            <>
              <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.max(4, job.progress)}%` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-zinc-400">
                {job.stage} · {job.progress}%（通常 2~5 分钟，可离开此页，任务在服务器继续执行）
              </p>
            </>
          )}
          {job.status === "failed" && (
            <div className="flex items-start gap-3">
              <p className="min-w-0 flex-1 text-red-300">✗ {job.error}</p>
              <button
                onClick={retry}
                className="shrink-0 rounded border border-zinc-600 px-3 py-1 font-mono text-emerald-400 hover:border-emerald-500"
              >
                重试
              </button>
            </div>
          )}
          {job.status === "done" && job.slug && (
            <p className="text-emerald-400">
              分析完成！
              <a href={`/show/${job.slug}`} className="ml-1 underline">
                查看生成的页面 ↗
              </a>
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">出错了：{error}</p>}
    </div>
  );
}
