"use client";

/**
 * 表格滚动容器：内容溢出时在左/右缘显示向主题背景渐隐的遮罩，暗示可横向滚动；
 * 滚到底后遮罩自动消失（onScroll + ResizeObserver 驱动，SSR 初始无遮罩，无水合警告）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export default function TableScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setFades({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    // 字体加载、窗口缩放等引起宽度变化后重算是否溢出
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  return (
    <div className="relative my-3 rounded-[var(--radius)] border border-[var(--border)]">
      <div ref={ref} onScroll={update} className="overflow-x-auto rounded-[inherit]">
        {children}
      </div>
      {fades.left && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-[var(--radius)] [background-image:linear-gradient(to_right,var(--bg),transparent)]"
        />
      )}
      {fades.right && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-[var(--radius)] [background-image:linear-gradient(to_left,var(--bg),transparent)]"
        />
      )}
    </div>
  );
}
