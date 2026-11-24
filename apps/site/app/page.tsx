import type { CSSProperties } from "react";
import { connection } from "next/server";
import { listPageSummaries, PageSummary } from "@showcase/core/store";
import Link from "next/link";
import PageCard from "@/components/PageCard";
import { RevealOnScroll, SpotCard, CountUp } from "@/components/Motion";
import { getCollections, groupByCollection, categoryLabel } from "@/lib/collections";

export const instant = false; // 内容站：整页每次请求动态渲染

/** 入场编排：报头(0ms) → 精选标题 → 精选正文 → 列表卡，每级 +60ms（CSS 类 .reveal） */
const delay = (ms: number): CSSProperties => ({ "--reveal-delay": `${ms}ms` } as CSSProperties);

/** editorial 首页：最新精选（非对称版式）→ 栏目分组列表（印刷感章节编号） */
export default async function Home() {
  // 标记请求时渲染：DB 内容随发布实时更新，避免构建时空库被预渲染成永久空页
  await connection();
  const pages = listPageSummaries(50);
  const collections = getCollections();
  const featured = pages[0];
  const grouped = groupByCollection(pages, collections);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 最新精选：左 7 列大标题 + 竖排元信息栏 5 列，非对称 */}
      {featured ? (
        <FeaturedCard page={featured} totalCount={pages.length} />
      ) : (
        <p className="reveal mb-12 rounded-[var(--radius)] border border-dashed border-[var(--border)] p-10 text-center text-sm text-muted">
          还没有内容。通过 Agent 工作台或 <code>POST /api/pages</code> 发布第一篇。
        </p>
      )}

      {/* 栏目分组列表 */}
      {grouped.map(({ collection, pages: items }, gi) => {
        // 精选已单独展示，分组里跳过这一篇
        const shown = items.filter((p) => p.slug !== featured?.slug).slice(0, 4);
        if (!shown.length) return null;
        return (
          <section key={collection.id} className="mb-12">
            {/* 章节编号：超大淡色衬线数字，负 margin 与标题轻微重叠（印刷感） */}
            <div className="relative mb-4 border-b border-[var(--border)] pb-2">
              <div className="relative flex items-baseline justify-between">
                <h2 className="font-heading text-xl font-bold tracking-tight">{collection.name}</h2>
                <Link
                  href={`/c/${collection.id}`}
                  className="link-editorial text-xs text-muted hover:text-accent"
                >
                  全部 {items.length} 篇 →
                </Link>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {shown.map((p, i) => (
                <RevealOnScroll key={p.slug} delay={(gi * 4 + i) * 60}>
                  <PageCard page={p} />
                </RevealOnScroll>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 精选区：7/5 列非对称构成，Spotlight 头条卡 + Beam 元信息栏 */
function FeaturedCard({ page, totalCount }: { page: PageSummary; totalCount: number }) {
  return (
    <section className="mb-14">
      <h2
        className="reveal font-heading text-xs font-semibold uppercase tracking-[0.18em] text-accent"
        style={delay(0)}
      >
        最新精选
      </h2>
      <div className="mt-3 grid gap-8 md:grid-cols-12">
        {/* 左：头条主体（7 列）——Spotlight 聚光 + Border Beam 唯一亮点 */}
        <div className="md:col-span-7">
          <SpotCard className="h-full rounded-xl">
            <Link href={`/show/${page.slug}`} className="reveal group block rounded-xl border border-[var(--border)] bg-[var(--card)] p-6" style={delay(60)}>
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
              {/* 头条标题：顶格大字 + hover 下划线滑入 */}
              <h3 className="title-slide mt-2 font-heading text-3xl font-bold leading-tight tracking-tight group-hover:text-accent sm:text-[2.5rem] sm:leading-[1.15]">
                {page.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-muted">{page.summary}</p>
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
          </SpotCard>
        </div>
        {/* 中缝细分隔线 + 右：竖排元信息栏（5 列）——beam 微光点缀 */}
        <div
          className="reveal hidden md:col-span-5 md:block"
          style={delay(120)}
        >
          <div className="beam-card ml-6 flex h-full flex-col gap-3 rounded-xl border border-[var(--border)] p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted">
              In this issue
            </p>
            {/* 竖排日期：杂志版权页式 */}
            <p
              className="font-heading text-sm text-muted [writing-mode:vertical-rl] tracking-[0.3em]"
              lang="zh-CN"
            >
              {page.createdAt.slice(0, 10).replace(/-/g, " / ")}
            </p>
            <div className="mt-auto space-y-1 text-xs text-muted">
              <p>栏目 · {categoryLabel(page.category)}</p>
              <p>标签 · {page.tags.slice(0, 3).join(" / ") || "—"}</p>
              <p className="text-[var(--accent)]">
                已收录 <CountUp value={totalCount} /> 篇
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
