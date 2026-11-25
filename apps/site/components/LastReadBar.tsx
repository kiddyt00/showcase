"use client";

/**
 * 回访钩子（R6）：跨访问的"上次读到哪"。
 * 数据源：ReadingProgress 节流写入的 localStorage["sc:last"] = { slug, pct, t }。
 * - 15 ≤ pct < 85 且 7 天内 → 顶部一条「上次你把《slug》读到 N% → 续读」
 * - pct ≥ 85 且 7 天内      → 「《slug》已读完，本周新来 N 篇」（N 懒加载 /api/pages，失败省略）
 * - 已在目标文章页 / 已过期 / 无记录 → 不渲染
 * 只读本地、不请求个人化接口，挂载后首帧即隐藏（布局不跳动：预留固定高度条）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";

interface LastRead {
  slug: string;
  pct: number;
  t: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** 固定高度条（h-9）：未就绪时也占位，出现/消失都不推挤下方内容 */
const BAR_H = 36;

type State =
  | { kind: "hidden" }
  | { kind: "resume"; slug: string; pct: number }
  | { kind: "done"; slug: string; newCount: number | null };

export default function LastReadBar() {
  const [state, setState] = useState<State>({ kind: "hidden" });

  useEffect(() => {
    try {
      const raw = localStorage.getItem("sc:last");
      if (!raw) return;
      const last = JSON.parse(raw) as Partial<LastRead>;
      const { slug, pct, t } = last;
      if (typeof slug !== "string" || !slug) return;
      if (typeof pct !== "number" || typeof t !== "number") return;
      if (Date.now() - t > SEVEN_DAYS_MS) return; // 7 天过期不显示
      // 已在这篇文章上：不用提醒续读
      if (window.location.pathname === `/show/${slug}`) return;
      if (pct >= 15 && pct < 85) {
        setState({ kind: "resume", slug, pct: Math.round(pct) });
      } else if (pct >= 85) {
        // 读完钩子：「本周新来 N 篇」从公开列表接口算（created_at 落本周），失败省略数字
        setState({ kind: "done", slug, newCount: null });
        fetch("/api/pages")
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { pages?: Array<{ createdAt?: string }> } | null) => {
            if (!data?.pages) return;
            const now = new Date();
            const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
            const n = data.pages.filter((p) => p.createdAt && new Date(p.createdAt) >= monday).length;
            setState((s) => (s.kind === "done" ? { ...s, newCount: n } : s));
          })
          .catch(() => {
            /* N 省略即可，不必提示 */
          });
      }
    } catch {
      /* 损坏数据按无记录处理 */
    }
  }, []);

  if (state.kind === "hidden") return null;

  const close = () => setState({ kind: "hidden" });
  const body =
    state.kind === "resume" ? (
      <>
        上次你把《{state.slug}》读到 <span className="font-semibold text-[var(--fg)]">{state.pct}%</span>
        <Link
          href={`/show/${state.slug}`}
          className="link-editorial ml-1 font-medium text-accent hover:underline"
        >
          → 续读
        </Link>
      </>
    ) : (
      <>
        《{state.slug}》已读完
        {state.newCount !== null ? <>，本周新来 {state.newCount} 篇</> : null}
        <Link href="/" className="link-editorial ml-1 font-medium text-accent hover:underline">
          → 回首页看看
        </Link>
      </>
    );

  return (
    <div
      role="status"
      className="border-b border-[var(--border)] bg-[var(--card)] text-xs text-muted"
      style={{ height: BAR_H }}
    >
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-3 px-4">
        <p className="truncate tracking-[0.04em]">{body}</p>
        <button
          type="button"
          onClick={close}
          aria-label="关闭回访提示"
          className="shrink-0 rounded px-1 text-muted hover:text-accent"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
