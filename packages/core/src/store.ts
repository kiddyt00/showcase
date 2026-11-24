/** SQLite 存储层（better-sqlite3，单文件零运维） */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Diagram, PageContent, Section } from "./types";
import { DATA_DIR } from "./paths";

// 数据目录：monorepo 下两个 app cwd 不同，由 paths.ts 统一解析（DATA_DIR env 优先，默认仓库根 data/）
const DB_PATH = path.join(DATA_DIR, "showcase.db");
fs.mkdirSync(DATA_DIR, { recursive: true });

// Next.js dev 模式下模块可能被多次加载，复用连接
declare global {
  // eslint-disable-next-line no-var
  var __showcaseDb: Database.Database | undefined;
}

const db =
  globalThis.__showcaseDb ??
  (() => {
    const d = new Database(DB_PATH);
    d.pragma("journal_mode = WAL");
    d.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'article',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_url TEXT,
        source_name TEXT,
        icon TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        sections TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        generator TEXT NOT NULL DEFAULT 'api@1'
      );
      CREATE INDEX IF NOT EXISTS idx_pages_created ON pages(created_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        page_slug TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, id);
      CREATE TABLE IF NOT EXISTS video_jobs (
        slug TEXT NOT NULL,
        orientation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        video_path TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (slug, orientation)
      );
      CREATE TABLE IF NOT EXISTS analyze_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        input TEXT NOT NULL,
        source_type TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        slug TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_analyze_session ON analyze_jobs(session_id, created_at DESC);
    `);
    return d;
  })();
globalThis.__showcaseDb = db;

// 轻量迁移：pages 表补 diagrams 列（旧库已存在时 CREATE TABLE 不生效）
try {
  db.exec(`ALTER TABLE pages ADD COLUMN diagrams TEXT NOT NULL DEFAULT '[]'`);
} catch {
  /* 列已存在，忽略 */
}
try {
  db.exec(`ALTER TABLE pages ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'`);
} catch {
  /* 列已存在，忽略 */
}
// 轻量迁移：video_jobs 补 progress 列（渲染进度 0~100）
try {
  db.exec(`ALTER TABLE video_jobs ADD COLUMN progress REAL DEFAULT 0`);
} catch {
  /* 列已存在，忽略 */
}
// 轻量迁移：video_jobs 补 scenes 列（场景摘要 JSON，播放器章节时间轴）
try {
  db.exec(`ALTER TABLE video_jobs ADD COLUMN scenes TEXT DEFAULT '[]'`);
} catch {
  /* 列已存在，忽略 */
}

/** 行 → PageContent */
type PageRow = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  source_type: string;
  source_url: string | null;
  source_name: string | null;
  icon: string | null;
  tags: string;
  sections: string;
  metadata: string;
  created_at: string;
  generator: string;
  diagrams?: string;
  aliases?: string;
};

function rowToPage(row: PageRow): PageContent {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    source: { type: row.source_type, url: row.source_url ?? undefined, name: row.source_name ?? undefined },
    icon: row.icon ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    sections: JSON.parse(row.sections) as Section[],
    metadata: JSON.parse(row.metadata) as Record<string, string | number | undefined>,
    createdAt: row.created_at,
    generator: row.generator,
    diagrams: row.diagrams ? (JSON.parse(row.diagrams) as Diagram[]) : [],
    aliases: row.aliases ? (JSON.parse(row.aliases) as string[]) : [],
  };
}

export function savePage(page: PageContent): void {
  db.prepare(
    `INSERT INTO pages (slug,title,summary,category,source_type,source_url,source_name,icon,tags,sections,metadata,diagrams,aliases,created_at,generator)
     VALUES (@slug,@title,@summary,@category,@sourceType,@sourceUrl,@sourceName,@icon,@tags,@sections,@metadata,@diagrams,@aliases,@createdAt,@generator)
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title, summary=excluded.summary, category=excluded.category,
       icon=excluded.icon, tags=excluded.tags, sections=excluded.sections,
       metadata=excluded.metadata, diagrams=excluded.diagrams, aliases=excluded.aliases, generator=excluded.generator`
  ).run({
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    category: page.category,
    sourceType: page.source.type,
    sourceUrl: page.source.url ?? null,
    sourceName: page.source.name ?? null,
    icon: page.icon ?? null,
    tags: JSON.stringify(page.tags),
    sections: JSON.stringify(page.sections),
    metadata: JSON.stringify(page.metadata),
    diagrams: JSON.stringify(page.diagrams ?? []),
    aliases: JSON.stringify(page.aliases ?? []),
    createdAt: page.createdAt,
    generator: page.generator,
  });
}

export function listPages(limit = 100): PageContent[] {
  return (db.prepare(`SELECT * FROM pages ORDER BY created_at DESC LIMIT ?`).all(limit) as PageRow[]).map(rowToPage);
}

/** 列表卡片摘要：不取 sections/metadata 大字段 */
export interface PageSummary {
  slug: string;
  title: string;
  summary: string;
  category: string;
  icon?: string;
  tags: string[];
  createdAt: string;
}

type SummaryRow = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  icon: string | null;
  tags: string;
  created_at: string;
};

export function listPageSummaries(limit = 100): PageSummary[] {
  return (
    db
      .prepare(
        `SELECT slug, title, summary, category, icon, tags, created_at
         FROM pages ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as SummaryRow[]
  ).map((r) => ({
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    category: r.category,
    icon: r.icon ?? undefined,
    tags: JSON.parse(r.tags) as string[],
    createdAt: r.created_at,
  }));
}

export function getPage(slug: string): PageContent | null {
  const row = db.prepare(`SELECT * FROM pages WHERE slug = ?`).get(slug) as PageRow | undefined;
  return row ? rowToPage(row) : null;
}

export function deletePage(slug: string): boolean {
  const r = db.prepare(`DELETE FROM pages WHERE slug = ?`).run(slug);
  return r.changes > 0;
}

export function slugExists(slug: string): boolean {
  return !!db.prepare(`SELECT 1 FROM pages WHERE slug = ?`).get(slug);
}

/** 按 slug 别名查找页面（旧中文 slug → 新英文 slug 的 308 重定向用） */
export function findPageByAlias(slug: string): PageContent | null {
  const row = db
    .prepare(`SELECT * FROM pages WHERE aliases LIKE ? ESCAPE '\\' ORDER BY created_at DESC`)
    .all(`%${slug.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as PageRow[];
  for (const r of row) {
    const aliases = r.aliases ? (JSON.parse(r.aliases) as string[]) : [];
    if (aliases.includes(slug)) return rowToPage(r);
  }
  return null;
}

/** 生成唯一 slug（旧版行为：中文可保留 + 时间戳后缀） */
export function uniqueSlugify(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "page";
  let slug = `${base}-${Date.now().toString(36)}`;
  return slug;
}

/**
 * 清洗 LLM 提供的英文 slug：
 * - 只保留 [a-z0-9-]（其余字符折叠为 -），截断 60，去首尾 -
 * - 为空（或全是中文等被清空）时 fallback 用 title 的 timestamp-only slug，绝不产生中文
 */
export function normalizeSlug(raw: string | undefined | null, title: string): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return cleaned || `p-${Date.now().toString(36)}`;
}

/**
 * 生成唯一英文 slug：清洗 raw（LLM 提供的 slug），冲突时追加 -2/-3/-4…
 * 为异步以便未来接入远程查重；当前同步查 slugExists。
 */
export async function uniqueSlugFrom(raw: string | undefined | null, title: string): Promise<string> {
  const base = normalizeSlug(raw, title);
  if (!slugExists(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!slugExists(candidate)) return candidate;
  }
  // 兜底：几乎不可能走到（100 个连续冲突），退回时间戳 slug
  return `p-${Date.now().toString(36)}`;
}

/* ---------- 视频任务 ---------- */

import type { SceneSummary, VideoJob, VideoStatus, Orientation } from "./video/types";

export function upsertVideoJob(job: VideoJob): void {
  db.prepare(
    `INSERT INTO video_jobs (slug,orientation,status,error,video_path,created_at,progress,scenes)
     VALUES (@slug,@orientation,@status,@error,@videoPath,@createdAt,@progress,@scenes)
     ON CONFLICT(slug,orientation) DO UPDATE SET
       status=excluded.status, error=excluded.error, video_path=excluded.video_path,
       progress=excluded.progress, scenes=excluded.scenes`
  ).run({
    slug: job.slug,
    orientation: job.orientation,
    status: job.status,
    error: job.error ?? null,
    videoPath: job.videoPath ?? null,
    createdAt: job.createdAt,
    progress: job.progress ?? 0,
    scenes: JSON.stringify(job.scenes ?? []),
  });
}

/** 更新渲染进度（0~100，节流由调用方负责） */
export function setVideoJobProgress(
  slug: string,
  orientation: Orientation,
  progress: number
): void {
  db.prepare(
    `UPDATE video_jobs SET progress = ? WHERE slug = ? AND orientation = ?`
  ).run(Math.min(99, Math.max(0, Math.round(progress))), slug, orientation);
}

export function getVideoJob(slug: string, orientation: Orientation): VideoJob | null {
  const row = db
    .prepare(`SELECT * FROM video_jobs WHERE slug = ? AND orientation = ?`)
    .get(slug, orientation) as
    | { slug: string; orientation: string; status: string; error: string | null; video_path: string | null; created_at: string; progress: number | null; scenes: string | null }
    | undefined;
  if (!row) return null;
  let scenes: SceneSummary[] = [];
  try {
    scenes = row.scenes ? (JSON.parse(row.scenes) as SceneSummary[]) : [];
  } catch {
    /* 损坏数据按空处理 */
  }
  return {
    slug: row.slug,
    orientation: row.orientation as Orientation,
    status: row.status as VideoStatus,
    error: row.error ?? undefined,
    scenes,
    videoPath: row.video_path ?? undefined,
    progress: row.progress ?? undefined,
    createdAt: row.created_at,
  };
}

/* ---------- 分析任务 ---------- */

export type AnalyzeStatus = "queued" | "running" | "done" | "failed";

export interface AnalyzeJob {
  id: string;
  sessionId?: string;
  input: string;
  sourceType?: string;
  status: AnalyzeStatus;
  /** 当前阶段描述：排队中 / 抓取素材 / AI 分析生成中 / 渲染图表 / 发布 */
  stage?: string;
  /** 0~100 */
  progress: number;
  error?: string;
  /** 成功时生成的页面 slug */
  slug?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

type AnalyzeJobRow = {
  id: string;
  session_id: string | null;
  input: string;
  source_type: string | null;
  status: string;
  stage: string | null;
  progress: number | null;
  error: string | null;
  slug: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function rowToAnalyzeJob(row: AnalyzeJobRow): AnalyzeJob {
  return {
    id: row.id,
    sessionId: row.session_id ?? undefined,
    input: row.input,
    sourceType: row.source_type ?? undefined,
    status: row.status as AnalyzeStatus,
    stage: row.stage ?? undefined,
    progress: row.progress ?? 0,
    error: row.error ?? undefined,
    slug: row.slug ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  };
}

export function insertAnalyzeJob(job: AnalyzeJob): void {
  db.prepare(
    `INSERT INTO analyze_jobs (id,session_id,input,source_type,status,stage,progress,error,slug,created_at,started_at,finished_at)
     VALUES (@id,@sessionId,@input,@sourceType,@status,@stage,@progress,@error,@slug,@createdAt,@startedAt,@finishedAt)`
  ).run({
    id: job.id,
    sessionId: job.sessionId ?? null,
    input: job.input,
    sourceType: job.sourceType ?? null,
    status: job.status,
    stage: job.stage ?? null,
    progress: job.progress,
    error: job.error ?? null,
    slug: job.slug ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  });
}

/** 部分字段更新（只写传入的字段） */
export function updateAnalyzeJob(
  id: string,
  patch: Partial<Pick<AnalyzeJob, "status" | "stage" | "progress" | "error" | "slug" | "startedAt" | "finishedAt">>
): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) { sets.push("status=@status"); params.status = patch.status; }
  if (patch.stage !== undefined) { sets.push("stage=@stage"); params.stage = patch.stage; }
  if (patch.progress !== undefined) { sets.push("progress=@progress"); params.progress = patch.progress; }
  if (patch.error !== undefined) { sets.push("error=@error"); params.error = patch.error ?? null; }
  if (patch.slug !== undefined) { sets.push("slug=@slug"); params.slug = patch.slug ?? null; }
  if (patch.startedAt !== undefined) { sets.push("started_at=@startedAt"); params.startedAt = patch.startedAt ?? null; }
  if (patch.finishedAt !== undefined) { sets.push("finished_at=@finishedAt"); params.finishedAt = patch.finishedAt ?? null; }
  if (!sets.length) return;
  db.prepare(`UPDATE analyze_jobs SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function getAnalyzeJob(id: string): AnalyzeJob | null {
  const row = db.prepare(`SELECT * FROM analyze_jobs WHERE id = ?`).get(id) as AnalyzeJobRow | undefined;
  return row ? rowToAnalyzeJob(row) : null;
}

export function listAnalyzeJobs(sessionId?: string, limit = 20): AnalyzeJob[] {
  const rows = (
    sessionId
      ? db.prepare(`SELECT * FROM analyze_jobs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`).all(sessionId, limit)
      : db.prepare(`SELECT * FROM analyze_jobs ORDER BY created_at DESC LIMIT ?`).all(limit)
  ) as AnalyzeJobRow[];
  return rows.map(rowToAnalyzeJob);
}

/** 取最早的排队中任务（用于进程内调度器取活） */
export function nextQueuedAnalyzeJob(): AnalyzeJob | null {
  const row = db
    .prepare(`SELECT * FROM analyze_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
    .get() as AnalyzeJobRow | undefined;
  return row ? rowToAnalyzeJob(row) : null;
}

/* ---------- 对话会话 ---------- */

export interface ChatMessageRow {
  role: "user" | "assistant" | "system";
  content: string;
  pageSlug?: string;
}

export function addChatMessage(
  sessionId: string,
  role: ChatMessageRow["role"],
  content: string,
  pageSlug?: string
): void {
  db.prepare(
    `INSERT INTO chat_messages (session_id, role, content, page_slug, created_at) VALUES (?,?,?,?,?)`
  ).run(sessionId, role, content, pageSlug ?? null, new Date().toISOString());
}

export function getChatHistory(sessionId: string, limit = 40): ChatMessageRow[] {
  const rows = db
    .prepare(
      `SELECT role, content, page_slug FROM (SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`
    )
    .all(sessionId, limit) as { role: string; content: string; page_slug: string | null }[];
  return rows.map((r) => ({
    role: r.role as ChatMessageRow["role"],
    content: r.content,
    pageSlug: r.page_slug ?? undefined,
  }));
}

export interface ChatSessionRow {
  sessionId: string;
  /** 会话名：首个用户消息（截断） */
  title: string;
  lastAt: string;
  msgs: number;
  /** 会话最近一次管理的页面 slug（回溯"哪次会话产出了哪篇文章"） */
  lastSlug?: string;
}

/** 会话列表：以首个用户消息命名，按最后活跃排序 */
export function listChatSessions(limit = 20): ChatSessionRow[] {
  const rows = db
    .prepare(
      `SELECT m.session_id AS sessionId,
        (SELECT content FROM chat_messages x WHERE x.session_id = m.session_id AND x.role = 'user' ORDER BY x.id ASC LIMIT 1) AS title,
        MAX(m.created_at) AS lastAt,
        COUNT(*) AS msgs,
        (SELECT page_slug FROM chat_messages y WHERE y.session_id = m.session_id AND y.page_slug IS NOT NULL ORDER BY y.id DESC LIMIT 1) AS lastSlug
      FROM chat_messages m GROUP BY m.session_id ORDER BY lastAt DESC LIMIT ?`
    )
    .all(limit) as { sessionId: string; title: string | null; lastAt: string; msgs: number; lastSlug: string | null }[];
  return rows.map((r) => ({
    sessionId: r.sessionId,
    title: (r.title ?? "（无用户消息）").slice(0, 40),
    lastAt: r.lastAt,
    msgs: r.msgs,
    lastSlug: r.lastSlug ?? undefined,
  }));
}

export { db, DB_PATH };
