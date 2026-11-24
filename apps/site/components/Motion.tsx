"use client";

/**
 * 动效增强组件（全部尊重 prefers-reduced-motion）：
 * - RevealOnScroll: 滚动触发入场（IntersectionObserver，stagger 用 --reveal-delay）
 * - SpotCard: 鼠标位置聚光 + 轻微 3D tilt
 * - CountUp: 数字进视口后从 0 滚到目标值（editorial 数字统一 tabular）
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** 滚动触发入场容器：进入视口加 .in-view，CSS 过渡接手 */
export function RevealOnScroll({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // SSR 已渲染内容（无 JS 前不该隐藏内容），这里保证渐进增强
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`scroll-reveal ${className}`}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/** Spotlight + 轻微 Tilt 卡片：鼠标位置写入 CSS 变量，CSS 完成渲染 */
export function SpotCard({
  children,
  className = "",
  tilt = true,
}: {
  children: ReactNode;
  className?: string;
  tilt?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduced.current) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    if (tilt) {
      // ±5deg 内的轻微倾斜，中心死区避免抖动
      const dx = x / rect.width - 0.5;
      const dy = y / rect.height - 0.5;
      const dead = 0.12;
      const tx = Math.abs(dy) < dead ? 0 : -dy * 8;
      const ty = Math.abs(dx) < dead ? 0 : dx * 10;
      el.style.setProperty("--tilt-x", `${tx.toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${ty.toFixed(2)}deg`);
    }
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  }

  return (
    <div className="tilt-wrap" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div ref={ref} className={`spot-card tilt ${className}`}>
        {children}
      </div>
    </div>
  );
}

/** 数字滚动：进视口后 rAF easeOutQuint 到目标值 */
export function CountUp({
  value,
  duration = 1400,
  format,
  className = "",
}: {
  value: number;
  duration?: number;
  /** 数字格式化（默认千分位） */
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || started.current) continue;
          started.current = true;
          io.disconnect();
          const t0 = performance.now();
          const tick = (t: number) => {
            const p = Math.min(1, (t - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 5); // easeOutQuint
            setDisplay(Math.round(value * eased));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  const fmt = format ?? ((n: number) => n.toLocaleString("en-US"));
  return (
    <span ref={ref} className={`count-up ${className}`}>
      {fmt(display)}
    </span>
  );
}
