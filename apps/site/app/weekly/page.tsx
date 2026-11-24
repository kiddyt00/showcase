import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import PageCard from "@/components/PageCard";
import { CountUp } from "@/components/Motion";
import { categoryLabel } from "@/lib/collections";
import type { PageSummary } from "@showcase/core/store";
import {
  buildWeeklyIssue,
  issueDateFromWeekKey,
  isoWeekKey,
  listArchiveWeeks,
  type WeeklyIssue,
} from "@/lib/weekly";

export const instant = false; // 周五印行页：内容随发布实时更新，避免构建时空库被预渲染成永久空页

export const metadata: Metadata = {
  title: "周印 Weekly Issue",
  description: "每周五印行的固定栏目：本周收录、升温词与长文选读。",
};

/** 入场编排：与首页同节奏（每级 +60ms） */
const delay = (ms: number): CSSProperties => ({ "--reveal-delay": `${ms}ms` } as CSSProperties);

/** "M 月 D 日（周五）" */
const issueLabel = (date: string): string => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : `${d.getMonth() + 1} 月 ${d.getDate()} 日（周五）`;
};

/**
 * 周印：每周五出刊的固定栏目页。
 * /weekly 看本期；/weekly?w=2026-W47 回看往期（按 created_at 的 ISO 周过滤）。
 */
export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection(); // 请求时渲染（参照首页写法），保证新发布内容实时可见
  const sp = await searchParams;
  const wRaw = typeof sp.w === "string" ? sp.w : undefined;
  // 合法周键且非本周才走往期；非法值一律按本期处理
  const backKey =
    wRaw && wRaw !== isoWeekKey(new Date()) && issueDateFromWeekKey(wRaw) ? wRaw : undefined;
  const refDate = backKey ? issueDateFromWeekKey(backKey)! : new Date();
  const issue = buildWeeklyIssue(refDate);
  const isArchive = Boolean(backKey);
  const archiveWeeks = listArchiveWeeks(issue.weekKey);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 报头：双细线 masthead-rule + 标题 + 期号大字（印刷品封面语言） */}
      <header className="reveal" style={delay(0)}>
        <div aria-hidden className="masthead-rule" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-accent">
          周印 Weekly Issue
        </p>
        <h1 className="mt-3 font-heading text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
          Vol.{issue.vol} · 第 {issue.issue} 期
        </h1>
        {/* 印行数据行：收录 / 环比 / 升温词（编辑部门口径） */}
        <p className="mt-4 text-xs tracking-[0.08em] text-muted">
          本周收录 <CountUp value={issue.posts.length} format={(n) => `${n} 篇`} /> · 比上周{" "}
          {issue.delta > 0 ? `+${issue.delta}` : issue.delta === 0 ? "±0" : `${issue.delta}`} 篇 ·
          升温词：{issue.risingTag ?? "无"}
        </p>
        {isArchive ? (
          <p className="mt-2 text-xs text-muted">往期回看 · {issue.weekKey}</p>
        ) : null}
      </header>

      {/* 本周休刊：深色空态（整期无收录时的唯一内容，反白印刷启事） */}
      {issue.posts.length === 0 ? (
        <section className="reveal mt-12" style={delay(120)}>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--fg)] p-10 text-center text-[var(--bg)]">
            <p className="font-heading text-2xl font-bold tracking-wide">本周休刊</p>
            <p className="mt-2 text-xs opacity-70">
              本周没有新篇目付印 · 下期 {issueLabel(issue.nextIssueDate)}印
            </p>
          </div>
          <ArchiveNav weeks={archiveWeeks} />
        </section>
      ) : (
        <>
          {/* 升温词大字展示（本期唯一亮点位，moment 集中处） */}
          {issue.risingTag ? (
            <section className="reveal mt-12" style={delay(120)}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">升温词</p>
              <p className="mt-2 font-heading text-5xl font-bold leading-none tracking-tight text-accent sm:text-7xl">
                #{issue.risingTag}
              </p>
            </section>
          ) : (
            <section className="reveal mt-12" style={delay(120)}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">升温词</p>
              <p className="mt-2 font-heading text-3xl font-bold tracking-tight text-muted sm:text-4xl">
                本周无升温词
              </p>
            </section>
          )}

          {/* 本周长文卡（本期最长的一篇） */}
          {issue.longest ? (
            <section className="reveal mt-14" style={delay(180)}>
              <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">本周长文</h2>
                <span className="text-xs text-muted">本期正文字数最多</span>
              </div>
              <LongReadCard post={issue.longest} />
            </section>
          ) : null}

          {/* 全部篇目目录行 */}
          <section className="reveal mt-14" style={delay(240)}>
            <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
              <h2 className="font-heading text-xl font-bold tracking-tight">本期篇目</h2>
              <span className="text-xs text-muted">共 {issue.posts.length} 篇</span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {issue.posts.map((p, i) => (
                <div key={p.slug} className="relative">
                  {/* 目录序号：印刷目录式淡色大字，压在卡片左上 */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-2 left-3 z-10 rounded-[var(--radius)] bg-[var(--bg)] px-1 font-heading text-3xl font-bold leading-none text-[var(--border)]"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <PageCard page={p} />
                </div>
              ))}
            </div>
          </section>

          {/* 版权行（colophon，与全站 footer 语言一致） */}
          <p
            className="reveal mt-12 text-center text-[11px] tracking-[0.08em] text-muted"
            style={delay(300)}
          >
            本期由 ShowCase 编辑部每周五印行
          </p>
        </>
      )}

      {/* 往期导航（有内容且存在可回看的周才出现；休刊版式里已含一份） */}
      {issue.posts.length > 0 && archiveWeeks.length ? (
        <div className="mt-10">
          <ArchiveNav weeks={archiveWeeks} />
        </div>
      ) : null}

      {/* 下期预告行 */}
      <p
        className="reveal mt-10 border-t border-[var(--border)] pt-4 text-center text-xs tracking-[0.08em] text-muted"
        style={delay(360)}
      >
        下期 · {issueLabel(issue.nextIssueDate)}印
      </p>
    </div>
  );
}

/** 长文卡：标题 + 摘要 + 阅读链接（editorial 版式，同首页 FeaturedCard 语言） */
function LongReadCard({ post }: { post: PageSummary }) {
  return (
    <Link
      href={`/show/${post.slug}`}
      className="group mt-4 block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 hover:border-[var(--accent)]"
    >
      <p className="text-xs text-muted">
        {categoryLabel(post.category)} · {post.createdAt.slice(0, 10)}
      </p>
      <h3 className="title-slide mt-2 font-heading text-2xl font-bold leading-tight tracking-tight group-hover:text-accent sm:text-3xl">
        {post.title}
      </h3>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">{post.summary}</p>
      <span className="mt-4 inline-block text-sm font-medium text-accent">阅读全文 →</span>
    </Link>
  );
}

/** 往期导航：周键点线链接（无往期时不渲染） */
function ArchiveNav({ weeks }: { weeks: string[] }) {
  if (!weeks.length) return null;
  return (
    <nav aria-label="往期周印" className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">往期</span>
      {weeks.map((w) => (
        <Link
          key={w}
          href={`/weekly?w=${w}`}
          className="link-editorial font-heading text-sm text-muted hover:text-accent"
        >
          {w}
        </Link>
      ))}
    </nav>
  );
}
