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

import type { VideoJob, VideoStatus, Orientation } from "./video/types";

export function upsertVideoJob(job: VideoJob): void {
  db.prepare(
    `INSERT INTO video_jobs (slug,orientation,status,error,video_path,created_at,progress)
     VALUES (@slug,@orientation,@status,@error,@videoPath,@createdAt,@progress)
     ON CONFLICT(slug,orientation) DO UPDATE SET
       status=excluded.status, error=excluded.error, video_path=excluded.video_path,
       progress=excluded.progress`
  ).run({
    slug: job.slug,
    orientation: job.orientation,
    status: job.status,
    error: job.error ?? null,
    videoPath: job.videoPath ?? null,
    createdAt: job.createdAt,
    progress: job.progress ?? 0,
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
    | { slug: string; orientation: string; status: string; error: string | null; video_path: string | null; created_at: string; progress: number | null }
    | undefined;
  if (!row) return null;
  return {
    slug: row.slug,
    orientation: row.orientation as Orientation,
    status: row.status as VideoStatus,
    error: row.error ?? undefined,
    videoPath: row.video_path ?? undefined,
    progress: row.progress ?? undefined,
    createdAt: row.created_at,
  };
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

export { db, DB_PATH };
