import { connection } from "next/server";
import { listPageSummaries } from "@showcase/core/store";
import Link from "next/link";
import type { Metadata } from "next";
import PageCard from "@/components/PageCard";
import { getCollections, categoryLabel } from "@/lib/collections";

export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  return { title: `${categoryLabel(decodeURIComponent(category))} · 栏目` };
}

/** 栏目页：某分类下的全部内容 */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: raw } = await params;
  const category = /%/.test(raw) ? decodeURIComponent(raw) : raw;
  await connection(); // 请求时渲染，保证新发布内容实时可见
  const collections = getCollections();
  const collection = collections.find((c) => c.id === category);
  const pages = listPageSummaries(100).filter((p) => p.category === category);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 border-b border-[var(--border)] pb-4">
        <p className="text-xs uppercase tracking-widest text-muted">栏目</p>
        <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight">
          {collection?.name ?? categoryLabel(category)}
        </h1>
        {collection?.description && (
          <p className="mt-2 text-sm text-muted">{collection.description}</p>
        )}
        <p className="mt-2 text-xs text-muted">共 {pages.length} 篇</p>
      </header>

      {pages.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-10 text-center text-sm text-muted">
          该栏目暂无内容。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {pages.map((p) => (
            <PageCard key={p.slug} page={p} />
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        <Link href="/" className="underline decoration-dotted underline-offset-2 hover:text-accent">
          ← 回到首页
        </Link>
      </p>
    </div>
  );
}
