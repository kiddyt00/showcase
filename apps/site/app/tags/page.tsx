import type { Metadata } from "next";
import { connection } from "next/server";
import { listPageSummaries } from "@showcase/core/store";
import Link from "next/link";

export const instant = false;

export const metadata: Metadata = { title: "标签云" };

/** 标签云：按出现次数定字号（editorial 浅色，低调） */
export default async function TagsPage() {
  await connection(); // 请求时渲染，避免构建时空库被预渲染成永久空页
  const counts = new Map<string, number>();
  for (const p of listPageSummaries(500)) {
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = tags[0]?.[1] ?? 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight">标签云</h1>
      <p className="mt-1 text-sm text-muted">共 {tags.length} 个标签</p>
      <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-3">
        {tags.map(([tag, n]) => {
          // 次数越多字号越大（0.875rem ~ 1.75rem）
          const scale = 0.875 + ((n / max) * 0.875);
          return (
            <Link
              key={tag}
              href={`/tags/${encodeURIComponent(tag)}`}
              className="text-[var(--fg)] underline decoration-[var(--border)] decoration-2 underline-offset-4 hover:text-[var(--accent)] hover:decoration-[var(--accent)]"
              style={{ fontSize: `${scale.toFixed(3)}rem`, lineHeight: 1.4 }}
            >
              {tag}
              <sup className="ml-0.5 text-[10px] text-muted">{n}</sup>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
