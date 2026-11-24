"use client";

/** 解说视频区块：16:9 / 9:16 生成按钮 + 播放器（章节时间轴/倍速/键盘快进） */
import { useCallback, useEffect, useRef, useState } from "react";

type Orientation = "landscape" | "portrait";
type Status = "pending" | "rendering" | "done" | "failed" | undefined;
type VideoMode = "standard" | "slides" | "hf";

/** 章节摘要（来自 /api/video 的 scenes 字段） */
interface SceneSummary {
  heading: string;
  seconds: number;
}

const MAX_POLL_FAILURES = 5;
const PLAYBACK_RATES = [1, 1.25, 1.5, 2];

/** done 状态播放器：章节时间轴 + 倍速 + 键盘 ←/→ ±5s；可切换 幻灯片版 / HyperFrames 版 产物 */
function VideoPlayer({ slug, orientation, scenes, slidesAvail, hfAvail, variant, onVariant }: {
  slug: string;
  orientation: Orientation;
  scenes: SceneSummary[];
  slidesAvail: boolean;
  hfAvail: boolean;
  variant: VideoMode;
  onVariant: (v: VideoMode) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0); // 当前播放秒
  const [rateIdx, setRateIdx] = useState(0);

  // 章节起点（秒）：按 seconds 累加
  const chapterStarts: number[] = [];
  let acc = 0;
  for (const s of scenes) {
    chapterStarts.push(acc);
    acc += s.seconds;
  }
  const activeIdx = (() => {
    for (let i = chapterStarts.length - 1; i >= 0; i--) {
      if (current >= chapterStarts[i]) return i;
    }
    return 0;
  })();

  const seekTo = useCallback((sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, sec);
  }, []);

  function cycleRate() {
    const next = (rateIdx + 1) % PLAYBACK_RATES.length;
    setRateIdx(next);
    if (videoRef.current) videoRef.current.playbackRate = PLAYBACK_RATES[next];
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekTo((videoRef.current?.currentTime ?? 0) - 5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seekTo((videoRef.current?.currentTime ?? 0) + 5);
    }
  }

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={onKey} className="outline-none">
      {/* 章节时间轴：宽度按 seconds 比例，点击跳转，当前章节 accent 填充 */}
      {scenes.length > 0 && (
        <div className="mb-2 flex h-7 w-full gap-0.5 overflow-hidden rounded-md">
          {scenes.map((s, i) => {
            const pct = chapterStarts[i + 1] !== undefined
              ? Math.min(100, Math.max(0, ((current - chapterStarts[i]) / s.seconds) * 100))
              : current >= chapterStarts[i] ? 100 : 0;
            return (
              <button
                key={i}
                title={s.heading}
                onClick={() => seekTo(chapterStarts[i])}
                className="relative h-full min-w-[24px] overflow-hidden bg-[var(--border)] transition-colors hover:opacity-80"
                style={{ flex: `${Math.max(s.seconds, 1)} 1 0%` }}
              >
                <span
                  className={`absolute inset-y-0 left-0 ${i === activeIdx ? "bg-accent" : "bg-[var(--fg)] opacity-30"}`}
                  style={{ width: `${pct}%` }}
                />
                <span className="relative z-10 block w-full truncate px-1 text-[10px] leading-7 text-[var(--fg)]">
                  {s.heading}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <video
        ref={videoRef}
        controls
        className="w-full rounded-lg"
        src={variant === "slides"
          ? `/videos/${slug}-${orientation}-slides.mp4`
          : variant === "hf"
            ? `/videos/${slug}-${orientation}-hf.mp4`
            : `/videos/${slug}-${orientation}.mp4`}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
      />
      {(slidesAvail || hfAvail) && (
        <div className="mt-2 flex gap-1">
          {([
            { v: "standard" as VideoMode, label: "标准版", show: true },
            { v: "slides" as VideoMode, label: "🎬 幻灯片版", show: slidesAvail },
            { v: "hf" as VideoMode, label: "⚡ HyperFrames 版", show: hfAvail },
          ]).filter((x) => x.show).map(({ v, label }) => (
            <button
              key={v}
              onClick={() => onVariant(v)}
              className={`rounded px-2 py-0.5 text-xs ${
                variant === v ? "bg-accent text-[var(--bg,#0b0f0e)]" : "border border-[var(--border)] text-muted hover:border-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {PLAYBACK_RATES.map((r, i) => (
            <button
              key={r}
              onClick={() => {
                setRateIdx(i);
                if (videoRef.current) videoRef.current.playbackRate = r;
              }}
              className={`rounded px-2 py-0.5 text-xs ${
                i === rateIdx ? "bg-accent text-[var(--bg,#0b0f0e)]" : "border border-[var(--border)] text-muted hover:border-accent"
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted">←/→ 快退快进 5 秒</span>
      </div>
    </div>
  );
}

export default function VideoSection({ slug }: { slug: string }) {
  const [jobs, setJobs] = useState<Record<Orientation, { status: Status; error?: string; progress?: number }>>(
    {} as Record<Orientation, { status: Status; error?: string }>
  );
  const [scenes, setScenes] = useState<Record<Orientation, SceneSummary[]>>(
    { landscape: [], portrait: [] }
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
  // 图文幻灯片版产物（{slug}-{orientation}-slides.mp4）探测结果 + 播放器当前变体
  const [slidesAvail, setSlidesAvail] = useState<Record<Orientation, boolean>>(
    { landscape: false, portrait: false }
  );
  // HyperFrames 引擎版产物（{slug}-{orientation}-hf.mp4）
  const [hfAvail, setHfAvail] = useState<Record<Orientation, boolean>>(
    { landscape: false, portrait: false }
  );
  const [variant, setVariant] = useState<Record<Orientation, VideoMode>>(
    { landscape: "standard", portrait: "standard" }
  );

  // 探测 slides / hyperframes 产物是否存在（挂载时 + 任务状态变化后）
  useEffect(() => {
    for (const o of ["landscape", "portrait"] as Orientation[]) {
      fetch(`/videos/${slug}-${o}-slides.mp4`, { method: "HEAD" })
        .then((r) => setSlidesAvail((s) => ({ ...s, [o]: r.ok })))
        .catch(() => setSlidesAvail((s) => ({ ...s, [o]: false })));
      fetch(`/videos/${slug}-${o}-hf.mp4`, { method: "HEAD" })
        .then((r) => setHfAvail((s) => ({ ...s, [o]: r.ok })))
        .catch(() => setHfAvail((s) => ({ ...s, [o]: false })));
    }
  }, [slug, jobs]);

  const refresh = useCallback(async (o: Orientation) => {
    const res = await fetch(`/api/video?slug=${slug}&orientation=${o}`);
    const data = await res.json();
    setJobs((j) => ({ ...j, [o]: data.job ?? { status: undefined } }));
    if (Array.isArray(data.scenes)) setScenes((s) => ({ ...s, [o]: data.scenes }));
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

  async function generate(o: Orientation, mode: VideoMode = "standard") {
    if (generating[o]) return;
    setGenerating((g) => ({ ...g, [o]: true }));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = localStorage.getItem("showcase-admin-token");
      if (token) headers["x-admin-token"] = token;
      const res = await fetch("/api/video", {
        method: "POST",
        headers,
        body: JSON.stringify({ slug, orientation: o, ...(mode === "slides" ? { mode } : {}) }),
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
                <VideoPlayer
                  slug={slug}
                  orientation={o}
                  scenes={scenes[o]}
                  variant={variant[o]}
                  onVariant={(v) => setVariant((s) => ({ ...s, [o]: v }))}
                  slidesAvail={slidesAvail[o]}
                  hfAvail={hfAvail[o]}
                />
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
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => generate(o)}
                    disabled={generating[o]}
                    className="w-full rounded-lg border border-[var(--border)] py-3 text-sm text-[var(--fg)] hover:border-accent disabled:opacity-40"
                  >
                    {generating[o] ? "提交中…" : "生成解说视频"}
                  </button>
                  <button
                    onClick={() => generate(o, "slides")}
                    disabled={generating[o]}
                    className="w-full rounded-lg border border-[var(--border)] py-3 text-sm text-[var(--fg)] hover:border-accent disabled:opacity-40"
                  >
                    🎬 图文幻灯片版
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div></section>
  );
}
