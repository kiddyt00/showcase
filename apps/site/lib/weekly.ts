/**
 * 周印（Weekly Issue）数据层。
 *
 * 固定栏目：每周五出刊，一期 = 一个 ISO 周（周一起算）。
 * - isoWeekKey / issueDateFromWeekKey：纯日期函数
 * - buildWeeklyIssue：对一次 listPages(50) 快照派生整期印行数据
 * 全部无 LLM、无写入。
 */
import { getPage, listPages, listQuickVideosBySlugs } from "@showcase/core/store";
import type { PageSummary, QuickVideoRow } from "@showcase/core/store";
import type { PageContent } from "@showcase/core/types";

/** 本期已出快览视频的篇目（封面墙卡片：文章元数据 + 播放地址） */
export interface WeeklyDigest {
  slug: string;
  title: string;
  summary: string;
  category: string;
  /** 播放地址：/videos/{slug}-landscape-quick.mp4 */
  src: string;
  /** video_jobs.created_at（快览渲染完成时间） */
  createdAt: string;
}

/** 一期周印的全部印行数据 */
export interface WeeklyIssue {
  /** 卷号：开站年（快照内最早 created_at 的年份）至今年差 + 1 */
  vol: number;
  /** 期号：ISO 周号（周一起算） */
  issue: number;
  /** 本期 ISO 周键，如 "2026-W48" */
  weekKey: string;
  /** 本期收录篇目（created_at 落在本 ISO 周内） */
  posts: PageSummary[];
  /** 比上周 ±几篇（正=增，负=减） */
  delta: number;
  /** 本期 tags 频次 top3（同频按字典序） */
  topTags: string[];
  /** 升温词：本期出现 ≥2 次且此前（有内容的周）周均 <1 的标签；无则 null */
  risingTag: string | null;
  /** 升温词在本期的出现次数（铅字块上标注「本期 N 处」用） */
  risingTagCount: number;
  /** 本期正文字数最多的篇目（getPage 取 sections 统计）；空则 null */
  longest: PageSummary | null;
  /** 本周快览：本期篇目中已出 quick 视频的封面墙数据（<2 条时前端不渲染该板块） */
  digests: WeeklyDigest[];
  /** 下期印行日：refDate 之后的下一个周五（refDate 为周五则下周五），ISO "YYYY-MM-DD" */
  nextIssueDate: string;
}

/** ISO 周键（ISO 8601：第 1 周为含 1 月 4 日的周，周一起算），如 "2026-W48" */
export function isoWeekKey(d: Date): string {
  const [year, week] = isoWeek(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** ISO 周 [年, 周号]（内部实现）：周四所在年份即 ISO 年 */
function isoWeek(d: Date): [number, number] {
  // 以本地日历零点做纯日期运算，避免 UTC 偏移把日期挪到前一天
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7; // 周一=0 … 周日=6
  t.setDate(t.getDate() - dow + 3); // 移到本 ISO 周的周四（周号锚点）
  const isoYear = t.getFullYear();
  const jan4 = new Date(isoYear, 0, 4); // 1 月 4 日恒在第 1 周
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const week1Thu = new Date(isoYear, 0, 4 - jan4Dow + 3); // 第 1 周的周四
  const week = 1 + Math.round((t.getTime() - week1Thu.getTime()) / 604800000);
  return [isoYear, week];
}

/** 往期周键 → 该周周五（印行日）。格式非法或周号超出该年实际周数返回 null。 */
export function issueDateFromWeekKey(key: string): Date | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const week1Mon = new Date(year, 0, 4 - jan4Dow); // 第 1 周周一
  // 该年最后一周：12 月 28 日恒在最后一个 ISO 周（ISO 8601 保证）
  const lastWeek = isoWeek(new Date(year, 11, 28))[1];
  if (week > lastWeek) return null;
  // 第 1 周周一 + (week−1)×7 到本周周一，再 +4 到周五
  return new Date(week1Mon.getFullYear(), week1Mon.getMonth(), week1Mon.getDate() + (week - 1) * 7 + 4);
}

/** 本地日历加 n 天（保持零点，用于周与周五的推算） */
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** refDate 之后的下一个周五；refDate 恰为周五则取下周五 */
function nextFriday(d: Date): Date {
  const diff = (5 - d.getDay() + 7) % 7;
  return addDays(d, diff === 0 ? 7 : diff);
}

/** 正文字数：与 lib/collections.readMinutes 同口径（body + bullets 字符数） */
function bodyChars(sections: Array<{ body?: string; bullets?: string[] }>): number {
  return sections.reduce(
    (n, s) => n + (s.body?.length ?? 0) + (s.bullets?.join("").length ?? 0),
    0
  );
}

/**
 * 过刊目次数据：快照内出现过的 ISO 周（倒序，最新在前），排除 excludeKey。
 * 过刊 = 印行日（该周周五）已过的期，未来周不入目次；快照外的周不出现。
 * 与 buildWeeklyIssue 同一快照口径（listPages(50)）；count 供目次「共 M 篇」小注用。
 */
export interface ArchiveWeek {
  /** ISO 周键，如 "2026-W47" */
  week: string;
  /** 该周实际收录篇数 */
  count: number;
}

/** 过刊周列表：印行日已过的期，最新在前；供 /weekly 过刊目次导航 */
export function listArchiveWeeks(excludeKey?: string, limit = 12): ArchiveWeek[] {
  const counts = new Map<string, number>();
  const today = new Date();
  for (const p of listPages(50)) {
    const w = isoWeekKey(new Date(p.createdAt));
    if (w !== excludeKey) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([w]) => {
      const d = issueDateFromWeekKey(w);
      return d !== null && d.getTime() <= today.getTime();
    })
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([week, count]) => ({ week, count }));
}

/** 标签频次降序（同频字典序），top3 与升温词共用同一顺序 */
function tagsByCount(count: Map<string, number>): Array<[string, number]> {
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * 汇出一期周印。refDate 决定期次（取其 ISO 周）；往期传该周周五即可整期回放。
 * 只做一次 listPages(50) 快照（created_at 倒序），全部统计基于该快照：
 * 全站超过 50 篇时，更早的文章不参与 vol / delta / 往期周均的口径。
 */
export function buildWeeklyIssue(refDate: Date): WeeklyIssue {
  const pages = listPages(50);
  const weekKey = isoWeekKey(refDate);
  const weekOf = (createdAt: string): string => isoWeekKey(new Date(createdAt));

  const toSummary = (p: PageContent): PageSummary => ({
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    category: p.category,
    icon: p.icon,
    tags: p.tags,
    createdAt: p.createdAt,
  });
  const summaries = pages.map(toSummary);

  // 本期篇目 & 比上周 ±几篇
  const posts = summaries.filter((p) => weekOf(p.createdAt) === weekKey);
  const lastWeekCount = summaries.filter(
    (p) => weekOf(p.createdAt) === isoWeekKey(addDays(refDate, -7))
  ).length;
  const delta = posts.length - lastWeekCount;

  // 本期标签频次（top3 与升温词共用）
  const tagCount = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }
  const topTags = tagsByCount(tagCount)
    .slice(0, 3)
    .map(([tag]) => tag);

  // 升温词：本期 ≥2 次，且此前每个有内容的周平均 <1 次
  const weeksBefore = new Map<string, Map<string, number>>(); // 周键 → 标签频次
  for (const p of summaries) {
    const w = weekOf(p.createdAt);
    if (w >= weekKey) continue; // "YYYY-Wnn" 零填充，字典序即时间序
    let tags = weeksBefore.get(w);
    if (!tags) {
      tags = new Map();
      weeksBefore.set(w, tags);
    }
    for (const t of p.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  let risingTag: string | null = null;
  let risingTagCount = 0;
  if (weeksBefore.size > 0) {
    for (const [tag, n] of tagsByCount(tagCount)) {
      if (n < 2) break; // 已按频次降序，后续必 <2
      let before = 0;
      for (const tags of weeksBefore.values()) before += tags.get(tag) ?? 0;
      if (before / weeksBefore.size < 1) {
        risingTag = tag;
        risingTagCount = n;
        break;
      }
    }
  }

  // 本期长文：getPage 取 sections 数正文字数，最多者当选（同字数取 posts 顺序首个，即发布更晚者）
  let longest: PageSummary | null = null;
  let longestChars = -1;
  for (const p of posts) {
    const full = getPage(p.slug);
    if (!full) continue;
    const chars = bodyChars(full.sections);
    if (chars > longestChars) {
      longestChars = chars;
      longest = p;
    }
  }

  // 本周快览：本期篇目中已渲染完成的 quick 视频目录墙（一张封面 = 一篇 30 秒快览）
  const quickRows = listQuickVideosBySlugs(posts.map((p) => p.slug));
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  const digests: WeeklyDigest[] = quickRows
    .filter((r): r is QuickVideoRow & { slug: string } => bySlug.has(r.slug))
    .map((r) => {
      const p = bySlug.get(r.slug)!;
      return {
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        category: p.category,
        src: `/videos/${p.slug}-landscape-quick.mp4`,
        createdAt: r.created_at,
      };
    });

  // 卷号：开站年（快照内最早一篇）到今年的年差 + 1
  const earliest = pages.reduce<PageContent | null>(
    (acc, p) => (acc === null || p.createdAt < acc.createdAt ? p : acc),
    null
  );
  const vol = earliest
    ? refDate.getFullYear() - new Date(earliest.createdAt).getFullYear() + 1
    : 1;

  // 下期印行日（下周五）
  const next = nextFriday(refDate);
  const nextIssueDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
    next.getDate()
  ).padStart(2, "0")}`;

  return {
    vol,
    issue: isoWeek(refDate)[1],
    weekKey,
    posts,
    delta,
    topTags,
    risingTag,
    risingTagCount,
    longest,
    digests,
    nextIssueDate,
  };
}
