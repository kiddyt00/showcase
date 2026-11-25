"use client";

/** 阅读进度条：按 <article> 元素折算（视频区/页脚不计入），固定在视口顶部随滚动填充 */
import { useEffect, useState } from "react";

/** 回访钩子（R6）：进度每前进 ≥5 且路径为 /show/* 时，节流落一笔 localStorage，供 LastReadBar 续读 */
const lastReadRef = { slug: "", pct: 0 };

function saveLastRead(pct: number): void {
  const m = /^\/show\/([^/?#]+)/.exec(window.location.pathname);
  if (!m) return;
  const slug = decodeURIComponent(m[1]!);
  if (slug === lastReadRef.slug && pct - lastReadRef.pct < 5) return; // 节流：不足 5 个百分点不写
  lastReadRef.slug = slug;
  lastReadRef.pct = pct;
  try {
    localStorage.setItem("sc:last", JSON.stringify({ slug, pct: Math.round(pct), t: Date.now() }));
  } catch {
    /* 隐私模式等存不进就算了 */
  }
}

export default function ReadingProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const article = document.querySelector("article");
    let raf = 0;

    const measure = () => {
      raf = 0;
      if (!article) return;
      const rect = article.getBoundingClientRect();
      // 总滚动距离：article 顶部触视口顶 → article 底部触视口底
      const total = article.offsetHeight - window.innerHeight;
      if (total <= 0) {
        // 文章不足一屏：底边滚入视口即视为读完
        const p = rect.bottom <= window.innerHeight ? 100 : 0;
        setPct(p);
        saveLastRead(p);
        return;
      }
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      const p = Math.min(100, Math.max(0, (scrolled / total) * 100));
      setPct(p);
      saveLastRead(p);
    };
    // rAF 合并同一帧内的 scroll/resize/RO 触发
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 文章内图片加载、CountUp 等会改变 article 高度，尺寸变化时重新折算
    let ro: ResizeObserver | null = null;
    if (article) {
      ro = new ResizeObserver(schedule);
      ro.observe(article);
    }
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent">
      <div
        className="h-full bg-[var(--accent)] transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
