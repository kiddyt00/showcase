"use client";

/** 右侧悬浮 TOC：由章节 heading 生成锚点，IntersectionObserver 高亮当前章节 */
import { useEffect, useRef, useState } from "react";

export interface TocItem {
  id: string;
  heading: string;
}

export default function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const clickLockRef = useRef(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < clickLockRef.current) return; // 点击锚点后短暂停用高亮跟随
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

  if (!items.length) return null;

  return (
    <nav aria-label="目录" className="sticky top-24">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
        目录
      </p>
      <ul className="space-y-1 border-l border-[var(--border)]">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={() => {
                clickLockRef.current = Date.now() + 800;
                setActive(item.id);
              }}
              className={`-ml-px block border-l-2 py-1 pl-3 text-xs leading-snug transition ${
                active === item.id
                  ? "border-[var(--accent)] font-medium text-[var(--accent)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {item.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
