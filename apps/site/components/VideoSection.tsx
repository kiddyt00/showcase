"use client";

/** 解说视频区块：16:9 / 9:16 生成按钮 + 播放器 */
import { useCallback, useEffect, useRef, useState } from "react";

type Orientation = "landscape" | "portrait";
type Status = "pending" | "rendering" | "done" | "failed" | undefined;

const MAX_POLL_FAILURES = 5;

export default function VideoSection({ slug }: { slug: string }) {
  const [jobs, setJobs] = useState<Record<Orientation, { status: Status; error?: string; progress?: number }>>(
    {} as Record<Orientation, { status: Status; error?: string }>
  );
  const [polling, setPolling] = useState<Orientation[]>([]);
  // 每个 orientation 独立的递归 setTimeout 句柄 + in-flight 标志 + 连续失败计数
  const timersRef = useRef<Partial<Record<Orientation, ReturnType<typeof setTimeout>>>>({});
  const inflightRef = useRef<Partial<Record<Orientation, boolean>>>({});
  const failCountRef = useRef<Partial<Record<Orientation, number>>>({});
  const [pollDisabled, setPollDisabled] = useState<Orientation[]>([]);
  const [generating, setGenerating] = useState<Record<Orientation, boolean>>(
    { landscape: false, portrait: false }
  );
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (o: Orientation) => {
    const res = await fetch(`/api/video?slug=${slug}&orientation=${o}`);
    const data = await res.json();
    setJobs((j) => ({ ...j, [o]: data.job ?? { status: undefined } }));
    return data;
  }, [slug]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    (async () => {
      for (const o of ["landscape", "portrait"] as Orientation[]) {
        const data = await refresh(o).catch(() => null);
        // 无任务 → 自动发起渲染（无需手点）；渲染队列信号量会让并发 POST 返回繁忙，稍后补排
        if (data && !data.job) void generate(o);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // 渲染中轮询：每个 orientation 一个递归 setTimeout，避免请求堆叠
  useEffect(() => {
    for (const o of polling) {
      if (timersRef.current[o]) continue; // 已在轮询中，不重复启动
      const tick = async () => {
        if (inflightRef.current[o]) {
          timersRef.current[o] = setTimeout(tick, 3000);
          return;
        }
        inflightRef.current[o] = true;
        try {
          const data = await refresh(o);
          failCountRef.current[o] = 0;
          if (data.job?.status === "done" || data.job?.status === "failed") {
            setPolling((p) => p.filter((x) => x !== o));
            clearTimeout(timersRef.current[o]);
            delete timersRef.current[o];
            return; // 结束，不再排下一次
          }
        } catch {
          failCountRef.current[o] = (failCountRef.current[o] ?? 0) + 1;
          if ((failCountRef.current[o] ?? 0) >= MAX_POLL_FAILURES) {
            setPollDisabled((d) => [...new Set([...d, o])]);
            setPolling((p) => p.filter((x) => x !== o));
            clearTimeout(timersRef.current[o]);
            delete timersRef.current[o];
            return;
          }
        } finally {
          inflightRef.current[o] = false;
        }
        timersRef.current[o] = setTimeout(tick, 3000);
      };
      timersRef.current[o] = setTimeout(tick, 3000);
    }
    // 清理已退出轮询的 orientation 的定时器
    for (const o of Object.keys(timersRef.current) as Orientation[]) {
      if (!polling.includes(o)) {
        clearTimeout(timersRef.current[o]);
        delete timersRef.current[o];
        failCountRef.current[o] = 0;
      }
    }
  }, [polling, refresh]);

  // 卸载时清理所有定时器
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  async function generate(o: Orientation) {
    if (generating[o]) return;
    setGenerating((g) => ({ ...g, [o]: true }));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = localStorage.getItem("showcase-admin-token");
      if (token) headers["x-admin-token"] = token;
      const res = await fetch("/api/video", {
        method: "POST",
        headers,
        body: JSON.stringify({ slug, orientation: o }),
      });
      if (res.status === 404) {
        // 公开站只读：渲染由 Agent 工作台自动触发，完成后此区块自动展示
        setNotice("解说视频由工作台生成中，完成后会自动展示在这里。");
        return;
      }
      setPollDisabled((d) => d.filter((x) => x !== o));
      setPolling((p) => [...new Set([...p, o])]);
      await refresh(o);
    } finally {
      setGenerating((g) => ({ ...g, [o]: false }));
    }
  }

  const configs: { o: Orientation; label: string }[] = [
    { o: "landscape", label: "16:9 横版（B站/YouTube）" },
    { o: "portrait", label: "9:16 竖版（抖音/Shorts）" },
  ];

  return (
    <section className="mx-auto max-w-5xl px-4 pb-8"><div className="max-w-3xl">
      <h2 className="mb-3 text-lg font-semibold">解说视频</h2>
      {notice && (
        <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-muted">
          {notice}
        </p>
      )}
      {pollDisabled.length > 0 && (
        <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[#9a6700]">
          状态查询连续失败，已停止自动刷新；请稍后手动刷新页面重试。
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {configs.map(({ o, label }) => {
          const job = jobs[o];
          return (
            <div key={o} className="rounded-xl border border-[var(--border)] p-3">
              <p className="mb-2 text-xs text-muted">{label}</p>
              {job?.status === "done" ? (
                <video controls className="w-full rounded-lg" src={`/videos/${slug}-${o}.mp4`} />
              ) : job?.status === "rendering" ? (
                <div className="py-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                    {typeof job.progress === "number" && job.progress > 0 ? (
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-500"
                        style={{ width: `${job.progress}%` }}
                      />
                    ) : (
                      <div className="iframe-skeleton h-full w-full" />
                    )}
                  </div>
                  <p className="mt-2 text-center text-xs text-muted">
                    正在生成中 {typeof job.progress === "number" && job.progress > 0 ? `${job.progress}%` : "…"}
                    （首次渲染约 3~8 分钟）
                  </p>
                </div>
              ) : job?.status === "failed" ? (
                <div className="text-sm text-accent">
                  <p>渲染失败：{job.error}</p>
                  <button onClick={() => generate(o)} className="mt-2 text-accent underline">
                    重试
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => generate(o)}
                  disabled={generating[o]}
                  className="w-full rounded-lg border border-[var(--border)] py-3 text-sm text-[var(--fg)] hover:border-accent disabled:opacity-40"
                >
                  {generating[o] ? "提交中…" : "生成解说视频"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div></section>
  );
}
