import { listPageSummaries, PageSummary } from "@showcase/core/store";
import Link from "next/link";
import PageCard from "@/components/PageCard";
import { getCollections, groupByCollection, categoryLabel } from "@/lib/collections";

export const instant = false; // 内容站：整页每次请求动态渲染

/** editorial 首页：最新精选 → 栏目分组列表 */
export default function Home() {
  const pages = listPageSummaries(50);
  const collections = getCollections();
  const featured = pages[0];
  const grouped = groupByCollection(pages, collections);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 最新精选：最新一篇大卡片 */}
      {featured ? (
        <FeaturedCard page={featured} />
      ) : (
        <p className="mb-12 rounded-[var(--radius)] border border-dashed border-[var(--border)] p-10 text-center text-sm text-muted">
          还没有内容。通过 Agent 工作台或 <code>POST /api/pages</code> 发布第一篇。
        </p>
      )}

      {/* 栏目分组列表 */}
      {grouped.map(({ collection, pages: items }) => {
        // 精选已单独展示，分组里跳过这一篇
        const shown = items.filter((p) => p.slug !== featured?.slug).slice(0, 4);
        if (!shown.length) return null;
        return (
          <section key={collection.id} className="mb-12">
            <div className="mb-4 flex items-baseline justify-between border-b border-[var(--border)] pb-2">
              <h2 className="font-heading text-xl font-bold tracking-tight">{collection.name}</h2>
              <Link
                href={`/c/${collection.id}`}
                className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
              >
                全部 {items.length} 篇 →
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {shown.map((p) => (
                <PageCard key={p.slug} page={p} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FeaturedCard({ page }: { page: PageSummary }) {
  return (
    <section className="mb-12">
      <h2 className="mb-3 font-heading text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        最新精选
      </h2>
      <Link href={`/show/${page.slug}`} className="group block">
        {/* 元信息行：与页面左缘对齐，不缩进 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="font-medium text-fg">{categoryLabel(page.category)}</span>
          <span aria-hidden className="text-[var(--border)]">·</span>
          <span>{page.createdAt.slice(0, 10)}</span>
          {page.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={page.icon}
              alt=""
              className="ml-1 h-5 w-5 self-center rounded-sm border border-[var(--border)] object-contain"
            />
          ) : null}
        </div>
        {/* 头条标题：顶格大字，与报头形成层级差 */}
        <h3 className="mt-2 font-heading text-3xl font-bold leading-tight tracking-tight group-hover:text-accent sm:text-[2.5rem] sm:leading-[1.15]">
          {page.title}
        </h3>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted">
          {page.summary}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {page.tags.map((t) => (
            <span
              key={t}
              className="rounded-[var(--radius)] border border-[var(--border)] px-1.5 py-0.5 text-xs text-muted"
            >
              #{t}
            </span>
          ))}
        </div>
        <span className="mt-4 inline-block text-sm font-medium text-accent">
          阅读全文 →
        </span>
      </Link>
    </section>
  );
}
