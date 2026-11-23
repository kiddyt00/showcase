import { listPageSummaries } from "@showcase/core/store";
import Link from "next/link";
import type { Metadata } from "next";
import PageCard from "@/components/PageCard";

export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${decodeURIComponent(tag)} · 标签` };
}

/** 标签页：某标签下的全部内容 */
export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: raw } = await params;
  const tag = /%/.test(raw) ? decodeURIComponent(raw) : raw;
  const pages = listPageSummaries(100).filter((p) => p.tags.includes(tag));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 border-b border-[var(--border)] pb-4">
        <p className="text-xs uppercase tracking-widest text-muted">标签</p>
        <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight text-accent">
          #{tag}
        </h1>
        <p className="mt-2 text-xs text-muted">共 {pages.length} 篇</p>
      </header>

      {pages.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-10 text-center text-sm text-muted">
          该标签下暂无内容。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {pages.map((p) => (
            <PageCard key={p.slug} page={p} />
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        <Link href="/tags" className="underline decoration-dotted underline-offset-2 hover:text-accent">
          ← 全部标签
        </Link>
      </p>
    </div>
  );
}
