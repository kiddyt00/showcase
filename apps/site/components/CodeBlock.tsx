"use client";

/**
 * 代码块（Listing 题注 + 复制按钮）：
 * - 题注 "Listing N · language"（N 为全页流水号，由 PageView 预扫传入，SSR/CSR 一致）
 * - navigator.clipboard 复制，编辑风小字 "复制" → 成功 "已复制 ✓" / 失败 "复制失败"（2s 还原）
 * - xl 屏 clear-right：代码块永不压在浮动配图之下（题注/边框完整）
 */
import { useEffect, useRef, useState } from "react";

export default function CodeBlock({
  code,
  lang,
  n,
}: {
  code: string;
  /** 已知语言标注（仅命中语言表时传入） */
  lang?: string;
  /** 全页流水号；缺省时题注只显示 Listing（无编号场景，如列表项内嵌代码） */
  n?: number;
}) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清掉还原定时器，避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("ok");
    } catch {
      setState("err");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <figure className="my-3 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] xl:clear-right">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-muted">
        <span>
          Listing {typeof n === "number" ? String(n).padStart(2, "0") : ""}
          {lang ? ` · ${lang}` : ""}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          className="shrink-0 cursor-pointer font-sans normal-case tracking-normal underline decoration-dotted underline-offset-2 hover:text-accent"
        >
          {state === "ok" ? "已复制 ✓" : state === "err" ? "复制失败" : "复制"}
        </button>
      </figcaption>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-[var(--fg)]">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
