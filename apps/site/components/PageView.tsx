/** 通用页面模板（editorial 主题变量）：头部阅读时长 + 右侧悬浮 TOC + 章节锚点 */
import type { PageContent } from "@showcase/core/types";
import Link from "next/link";
import { Markdown } from "./Markdown";
import Toc, { type TocItem } from "./Toc";
import DiagramFrame from "./DiagramFrame";
import FlowDiagram from "@/components/FlowDiagram";
import { readMinutes, categoryLabel, getCollections } from "@/lib/collections";

export default function PageView({ page }: { page: PageContent }) {
  const tocItems: TocItem[] = page.sections.map((s, i) => ({
    id: `sec-${i}`,
    heading: s.heading || `第 ${i + 1} 节`,
  }));
  const minutes = readMinutes(page.sections);
  const collection = getCollections().find((c) => c.id === page.category);

  return (
    <div className="mx-auto flex max-w-5xl gap-10 px-4 py-10">
      <article className="min-w-0 max-w-3xl flex-none basis-full xl:basis-[62%]">
        {/* 面包屑：首页 / 栏目 / 当前文章 */}
        <nav aria-label="面包屑" className="mb-6 text-xs text-muted">
          <Link href="/" className="underline decoration-dotted underline-offset-2 hover:text-accent">
            首页
          </Link>
          <span aria-hidden className="mx-1.5">/</span>
          <Link
            href={`/c/${page.category}`}
            className="underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            {collection?.name ?? categoryLabel(page.category)}
          </Link>
        </nav>
        {/* 头部：图标 + 标题 + 摘要 + 阅读时长 */}
        <header className="mb-8">
          <div className="mb-4 flex items-center gap-4">
            {page.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.icon}
                alt=""
                className="h-14 w-14 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] object-contain p-1"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] text-2xl">
                📦
              </div>
            )}
            <div>
              <span className="inline-block rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium text-muted">
                {categoryLabel(page.category)}
              </span>
              {isSafeHttpUrl(page.source.url) && (
                <a
                  href={page.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-xs text-muted underline hover:text-accent"
                >
                  查看原文
                </a>
              )}
            </div>
          </div>
          <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight">
            {page.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>约 {minutes} 分钟阅读</span>
            <span aria-hidden>·</span>
            <span>{page.createdAt.slice(0, 10)}</span>
          </div>
          {page.summary && (
            <p className="mt-3 text-base leading-relaxed text-muted">{page.summary}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {page.tags.map((tag) => (
              <a
                key={tag}
                href={`/tags/${encodeURIComponent(tag)}`}
                className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
              >
                #{tag}
              </a>
            ))}
          </div>
        </header>

        {/* 元信息 */}
        {Object.keys(page.metadata).length > 0 && (
          <div className="mb-8 grid grid-cols-2 gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-4">
            {Object.entries(page.metadata)
              .filter(([, v]) => v !== undefined && v !== "")
              .slice(0, 8)
              .map(([k, v]) => {
                // 逗号分隔的长列表（如 Topics）转成易读分隔展示，避免长 token 撑破网格
                const raw = String(v);
                const isList = raw.includes(",") && raw.length > 30;
                const display = isList
                  ? raw.split(",").map((x) => x.trim()).filter(Boolean).join(" · ")
                  : raw;
                return (
                  <div key={k} className="min-w-0">
                    <p className="text-xs text-muted">{k}</p>
                    <p className="mt-0.5 text-sm font-medium text-[var(--fg)] [overflow-wrap:anywhere]">
                      {display}
                    </p>
                  </div>
                );
              })}
          </div>
        )}

        {/* 架构与流程图 */}
        {page.diagrams?.length ? (
          <section className="mb-10">
            <h2 className="mb-4 border-l-2 border-accent pl-3 font-heading text-xl font-semibold">
              架构与流程图
            </h2>
            <div className="space-y-8">
              {page.diagrams.map((d) => (
                <div
                  key={d.id}
                  /* 向右突破阅读列边界，直达视口右缘（margin 负值技法）；左侧仍与标题基线对齐 */
                  className="-mr-[max(0px,calc(50%-50vw))] overflow-hidden rounded-l-[var(--radius)] border border-[var(--border)]"
                >
                  <p className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-4 py-2">
                    <span className="text-sm font-medium text-[var(--fg)]">{d.title}</span>
                    <span className="flex items-center gap-3 text-xs">
                      {d.htmlUrl && (
                        <a href={d.htmlUrl} target="_blank" rel="noreferrer" className="text-muted underline hover:text-accent">
                          新窗口打开 ↗
                        </a>
                      )}
                      {d.svgUrl && (
                        <a href={d.svgUrl} target="_blank" rel="noreferrer" className="text-muted underline hover:text-accent">
                          静态图
                        </a>
                      )}
                    </span>
                  </p>
                  {((): boolean => {
                    /* graph 型 spec（nodes+edges）→ 自研交互流程组件（与视频视觉语言统一） */
                    const sp = d.spec as { nodes?: unknown[] } | undefined;
                    return Boolean(sp && Array.isArray(sp.nodes) && sp.nodes.length);
                  })() ? (
                    <>
                      <FlowDiagram spec={d.spec} />
                      <p className="mt-2 flex items-center justify-end gap-4 text-xs">
                        {d.htmlUrl && (
                          <a href={d.htmlUrl} target="_blank" rel="noreferrer" className="text-muted underline hover:text-accent">
                            🔍 SeeCode 交互版 ↗
                          </a>
                        )}
                        {d.svgUrl && (
                          <a href={d.svgUrl} target="_blank" rel="noreferrer" className="text-muted underline hover:text-accent">
                            静态大图
                          </a>
                        )}
                      </p>
                    </>
                  ) : d.htmlUrl ? (
                    /* 非 graph 型：SeeCode 交互式 HTML（骨架屏加载） */
                    <DiagramFrame src={d.htmlUrl} title={d.title} />
                  ) : d.svgUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={d.svgUrl} alt={d.title} className="w-full h-auto bg-white" />
                  ) : (
                    <p className="px-4 py-8 text-center text-xs text-muted">图表生成失败</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 章节正文（锚点供 TOC 使用） */}
        <div className="space-y-10">
          {page.sections.map((section, i) => (
            <section key={i} id={`sec-${i}`} className="scroll-mt-20">
              {/* 章节标题：kicker 行（小号大写 SECTION NN + 章节序号）+ 衬线标题 */}
              <div className="mb-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
                  Section {String(i + 1).padStart(2, "0")}
                </p>
                <h2 className="border-l-2 border-accent pl-3 font-heading text-xl font-semibold">
                  {section.heading}
                </h2>
              </div>
              {section.body && <Markdown text={section.body} />}
              {section.bullets?.length ? (
                <ul className="mt-2 space-y-1">
                  {section.bullets.map((b, j) => (
                    <li key={j} className="ml-5 list-disc text-sm text-[var(--fg)]">
                      <Markdown text={b} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {section.code?.content ? (
                <pre className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--fg)]">
                  <code>{section.code.content}</code>
                </pre>
              ) : null}
            </section>
          ))}
        </div>

        <footer className="mt-12 border-t border-[var(--border)] pt-4 text-xs text-muted">
          由 Agent（{page.generator}）自动分析生成 · {page.createdAt.slice(0, 10)}
        </footer>
      </article>

      {/* 右侧悬浮 TOC（xl 屏幕以上显示） */}
      {tocItems.length > 1 && (
        <aside className="relative z-20 hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)]/95 p-4 shadow-sm backdrop-blur-sm">
            <Toc items={tocItems} />
          </div>
        </aside>
      )}
    </div>
  );
}

/** 仅放行合法的 http/https 链接（XSS 防护） */
function isSafeHttpUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
