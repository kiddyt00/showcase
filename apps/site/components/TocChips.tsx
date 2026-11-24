"use client";

/** 中屏（lg–xl）水平章节锚点条：横向滚动 chip，点击滚动到章节，当前章节高亮；xl 起由右侧 TOC 侧栏接管 */
import { useEffect, useRef, useState } from "react";
import type { TocItem } from "./Toc";

export default function TocChips({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const clickLockRef = useRef(0);
  const stripRef = useRef<HTMLDivElement>(null);

  // 与右侧 TOC 同款观察逻辑：取视口上部最近可见章节
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < clickLockRef.current) return; // 点击后短暂停用跟随
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  // active 变化时把当前 chip 滚进视野（block:nearest 不牵动页面纵向滚动）
  useEffect(() => {
    const chip = stripRef.current?.querySelector<HTMLAnchorElement>(`a[data-id="${active}"]`);
    if (chip) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      chip.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }
  }, [active]);

  if (items.length < 2) return null;

  return (
    <nav aria-label="章节锚点" className="mb-8 hidden lg:block xl:hidden">
      <div
        ref={stripRef}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            data-id={item.id}
            onClick={() => {
              clickLockRef.current = Date.now() + 800;
              setActive(item.id);
            }}
            aria-current={active === item.id ? "true" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs leading-none transition ${
              active === item.id
                ? "border-[var(--accent)] font-medium text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--card)] text-muted hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
          >
            <span className="mr-1.5 font-semibold opacity-60">{String(i + 1).padStart(2, "0")}</span>
            {item.heading}
          </a>
        ))}
      </div>
    </nav>
  );
}
