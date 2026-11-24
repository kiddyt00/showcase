"use client";

/**
 * 章节配图（印刷图录惯例）：
 * - 固定 aspect-[16/9] 裁切，杜绝图片加载前后的布局跳动
 * - 点击缩略图打开全屏灯箱（纯 overlay + 点击/Esc 关闭，无外部依赖），打开时锁定页面滚动
 * - 图注 "图 N · caption"（N=章节号）左对齐
 * - xl 屏右浮动 38% 实现文绕排（编辑风混排）；后续章节由 xl:clear-both 兜底，不受浮动影响
 */
import { useEffect, useState } from "react";

export default function FigureImage({
  src,
  alt,
  caption,
  n,
  float = true,
}: {
  src: string;
  alt: string;
  caption?: string;
  /** 图号（印刷惯例：图 N · 图注），取章节号 */
  n: number;
  /** xl 屏是否右浮动文绕排（默认开；下一章节已有 xl:clear-both 兜底） */
  float?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // 灯箱：Esc 关闭 + 打开期间锁定 body 滚动（关闭时还原）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <figure
      className={`my-5 w-full ${
        float ? "xl:float-right xl:mb-3 xl:ml-6 xl:mt-1 xl:w-[38%]" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="点击放大图片"
        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)]"
      >
        {/* 固定 16/9 + object-cover：图未加载时也占定高，防布局跳动 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="aspect-[16/9] w-full object-cover"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-2 right-2 rounded-[var(--radius)] bg-black/45 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          放大 ⤢
        </span>
      </button>
      {/* 图注：印刷惯例 "图 N · caption"，左对齐 */}
      <figcaption className="mt-1.5 text-left text-xs leading-relaxed tracking-wide text-muted">
        图 {n}
        {caption ? ` · ${caption}` : ""}
      </figcaption>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={caption || alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 sm:p-10"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-full max-w-full rounded-[var(--radius)] object-contain"
          />
          <button
            type="button"
            aria-label="关闭大图"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-lg text-white hover:bg-white/25"
          >
            ✕
          </button>
        </div>
      )}
    </figure>
  );
}
