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
  type ArchiveWeek,
  type WeeklyDigest,
} from "@/lib/weekly";

export const instant = false; // 周五印行页：内容随发布实时更新，避免构建时空库被预渲染成永久空页

export const metadata: Metadata = {
  title: "周印 Weekly Issue",
  description: "每周五印行的固定栏目：本周收录、升温词与长文选读。",
};

/** 入场编排：与首页同节奏（每级 +60ms） */
const delay = (ms: number): CSSProperties => ({ "--reveal-delay": `${ms}ms` } as CSSProperties);

/** 本地日历日期 → ISO "YYYY-MM-DD"（不用 toISOString：其按 UTC 转换会挪动日期） */
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 付印判定：ISO 周从周一起算，周五（含）及以后视为已印行，周一起为「在印」 */
const isPrinted = (now: Date): boolean => now.getDay() >= 5;

/** "M 月 D 日（周五）" */
const issueLabel = (date: string): string => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : `${d.getMonth() + 1} 月 ${d.getDate()} 日（周五）`;
};

/** 印行日期戳（报纸报头下的 dateline）："2026 年 11 月 20 日 · 星期五印行" */
function dateline(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期五印行`;
}

/** 过刊周键 → "M 月 D 日" 印行日标签（非法周键回退原始键） */
const weekDateLabel = (w: string): string => {
  const d = issueDateFromWeekKey(w);
  return d ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : w;
};

/**
 * 周印：每周五出刊的固定栏目页。
 * /weekly 看本期（周一起在印，周五付印）；/weekly?w=2026-W47 回看过刊（按 created_at 的 ISO 周过滤）。
 */
export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection(); // 请求时渲染（参照首页写法），保证新发布内容实时可见
  const sp = await searchParams;
  const wRaw = typeof sp.w === "string" ? sp.w : undefined;
  const now = new Date();
  // 合法周键且非本周才走往期；非法值一律按本期处理
  const backKey =
    wRaw && wRaw !== isoWeekKey(now) && issueDateFromWeekKey(wRaw) ? wRaw : undefined;
  const refDate = backKey ? issueDateFromWeekKey(backKey)! : now;
  const issue = buildWeeklyIssue(refDate);
  const isArchive = Boolean(backKey);
  const archiveWeeks = listArchiveWeeks(issue.weekKey);
  const emptyIssue = issue.posts.length === 0;
  const inPress = !isArchive && !isPrinted(now);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* 报头：kicker + 期号大字 + 印行日期戳（双细线刊头由全站报头统一供给，本页不再重复） */}
      <header className="reveal" style={delay(0)}>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
          周印 Weekly Issue
        </p>
        <h1 className="mt-3 font-heading text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Vol.{issue.vol} · 第 {issue.issue} 期
        </h1>
        {/* 印行日期戳（dateline）：在印中标注「即付印」，已到周五为「印行」 */}
        <p className="mt-3 text-xs tracking-[0.08em] text-muted">
          {inPress
            ? `${isoDate(issueDateFromWeekKey(issue.weekKey)!)} 即付印 · 周五见报`
            : dateline(isoDate(issueDateFromWeekKey(issue.weekKey)!))}
        </p>
        {/* 印行数据行：收录 / 环比 / 升温词（编辑部门口径）。
            CountUp 是客户端组件：不能传 format 函数 prop（RSC 序列化会 500），单位「篇」放在组件外。 */}
        <p className="mt-2 text-xs tracking-[0.08em] text-muted">
          本周收录 <CountUp value={issue.posts.length} /> 篇 · 比上周{" "}
          {issue.delta > 0 ? `+${issue.delta}` : issue.delta === 0 ? "±0" : `${issue.delta}`} 篇 ·
          升温词：{issue.risingTag ?? "无"}
        </p>
        {isArchive ? (
          /* 过刊眉批：以下非标题，回归正文语义 */
          <p className="mt-2 text-xs text-muted" role="note">
            过刊回看 · {issueLabel(isoDate(issueDateFromWeekKey(issue.weekKey)!))} 印行
            <Link href="/weekly" className="link-editorial ml-2 hover:text-accent">
              回本期 →
            </Link>
          </p>
        ) : null}
      </header>

      {/* 本周休刊：整期无收录时的「休刊启事」，印刷启事版式（不反白，细线上下夹住留白） */}
      {emptyIssue ? (
        <section className="reveal mt-12" style={delay(120)}>
          <div className="border-y border-[var(--border)] py-10 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">Notice 启事</p>
            <p className="mt-4 font-heading text-3xl font-bold tracking-[0.5em] text-[var(--fg)] [text-indent:0.5em]">
              本周休刊
            </p>
            <p className="mx-auto mt-4 max-w-md text-xs leading-loose text-muted">
              本期无新篇目付印，兹将版面保留空白。
              <br />
              <span className="mt-1 inline-block">
                下期定于 {issueLabel(issue.nextIssueDate)}印行。
              </span>
            </p>
            <p className="mt-6 text-[11px] tracking-[0.08em] text-muted">
              ShowCase 编辑部
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* 升温词：铅字块（活字印刷隐喻，全站唯一的整块 accent 面积） */}
          {issue.risingTag ? (
            <section className="reveal mt-12" style={delay(120)}>
              <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">升温词</h2>
                <span className="text-xs text-muted">
                  {inPress ? "在印 · " : ""}本期出现 {issue.risingTagCount} 处 · 此前各周均不足 1 处
                </span>
              </div>
              <div className="mt-6 flex flex-col items-start gap-1">
                {/* 铅字块可点：跳转站内 /tags/{tag} 标签聚合页（印刷字模 → 活字检索） */}
                <Link
                  href={`/tags/${encodeURIComponent(issue.risingTag)}`}
                  className="group rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-heading text-2xl font-bold leading-none tracking-wide text-[var(--bg)] shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)] transition-transform hover:-translate-y-0.5 sm:px-6 sm:py-4 sm:text-4xl"
                >
                  <span className="inline-block">#{issue.risingTag}</span>
                  <span
                    aria-hidden
                    className="ml-2 hidden text-base font-normal opacity-70 transition-opacity group-hover:opacity-100 sm:inline"
                  >
                    ↗
                  </span>
                </Link>
                {/* 排字房小注：铅字块旁的一行批注 */}
                <span className="mt-1 text-[11px] tracking-[0.08em] text-muted">
                  排字房注：此词新近上版，压倒此前各周
                </span>
              </div>
            </section>
          ) : (
            <section className="reveal mt-12" style={delay(120)}>
              <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">升温词</h2>
                <span className="text-xs text-muted">本期空缺</span>
              </div>
              <p className="mt-6 font-heading text-xl font-bold tracking-tight text-muted">
                本周无升温词
              </p>
            </section>
          )}

          {/* 本周快览封面墙：≥2 条才开栏，避免近空板块；每张封面点开新窗口即播（不做自动连播） */}
          {issue.digests.length >= 2 ? (
            <section className="reveal mt-14" style={delay(150)}>
              <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">本周快览</h2>
                <span className="text-xs text-muted">
                  {inPress ? "在印 · " : ""}30 秒快览视频 · 共 {issue.digests.length} 条
                </span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {issue.digests.map((d, i) => (
                  <DigestCover key={d.slug} digest={d} index={i} />
                ))}
              </div>
            </section>
          ) : null}

          {/* 本周长文卡（本期最长的一篇） */}
          {issue.longest ? (
            <section className="reveal mt-14" style={delay(180)}>
              <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
                <h2 className="font-heading text-xl font-bold tracking-tight">本周长文</h2>
                <span className="text-xs text-muted">
                  {inPress ? "在印 · " : ""}本期正文字数最多
                </span>
              </div>
              <LongReadCard post={issue.longest} />
            </section>
          ) : null}

          {/* 全部篇目目录行 */}
          <section className="reveal mt-14" style={delay(240)}>
            <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
              <h2 className="font-heading text-xl font-bold tracking-tight">本期篇目</h2>
              <span className="text-xs text-muted">
                {inPress ? "在印 · " : ""}共 {issue.posts.length} 篇
              </span>
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

      {/* 过刊目次：任何一期都常驻（本期读者见往期，过刊读者见更早往期） */}
      <div className="mt-10">
        <ArchiveNav weeks={archiveWeeks} />
      </div>

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

/** 快览封面卡：印刷目录式——序号大字压角 + 栏目/日期行 + 标题 + 摘要 + 播放入口（新窗口播放） */
function DigestCover({ digest, index }: { digest: WeeklyDigest; index: number }) {
  return (
    <a
      href={digest.src}
      target="_blank"
      rel="noreferrer"
      className="card-lift group relative mt-1 block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 pt-6 hover:border-[var(--accent)]"
    >
      {/* 目录序号：与「本期篇目」同一版式语言——印刷目录式淡色大字压在卡片左上 */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-2 left-3 z-10 rounded-[var(--radius)] bg-[var(--bg)] px-1 font-heading text-2xl font-bold leading-none text-[var(--border)]"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{categoryLabel(digest.category)}</span>
        <span aria-hidden>·</span>
        <span>⚡ 30 秒快览</span>
      </p>
      <h3 className="title-slide mt-2 font-heading text-xl font-bold leading-tight tracking-tight group-hover:text-accent">
        {digest.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{digest.summary}</p>
      <span className="mt-3 inline-block text-xs font-medium text-accent">
        新窗口播放 ▶
        <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">
          ↗
        </span>
      </span>
    </a>
  );
}

/** 长文卡：标题 + 摘要 + 阅读链接（editorial 版式，同首页 FeaturedCard 语言） */
function LongReadCard({ post }: { post: PageSummary }) {  return (
    <Link
      href={`/show/${post.slug}`}
      className="card-lift group mt-4 block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 hover:border-[var(--accent)]"
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

/** 过刊目次：点线引导的目录行「第 N 期 · M 月 D 日 ……… 共 M 篇」（无过刊时不渲染） */
function ArchiveNav({ weeks }: { weeks: ArchiveWeek[] }) {
  if (!weeks.length) return null;
  return (
    <nav aria-label="过刊目次" className="mt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">过刊目次 Back Issues</p>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {weeks.map((w) => (
          <li key={w.week}>
            <Link
              href={`/weekly?w=${w.week}`}
              className="group flex items-baseline gap-3 py-2 text-sm text-[var(--fg)] hover:text-accent"
            >
              <span className="font-heading font-semibold">第 {w.week.slice(6)} 期</span>
              <span className="text-xs text-muted">{weekDateLabel(w.week)}</span>
              {/* 点线引导：目录页码的前导符，flex 填充 */}
              <span
                aria-hidden
                className="min-w-8 flex-1 translate-y-[-3px] border-b border-dotted border-[var(--border)] group-hover:border-accent/60"
              />
              <span className="text-xs text-muted">共 {w.count} 篇</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
