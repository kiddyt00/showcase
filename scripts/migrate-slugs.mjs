#!/usr/bin/env node
/**
 * slug 英文化迁移（一次性）：为现有 4 篇页面把中文 slug 换成英文 slug，
 * 旧中文 slug 写入 pages.aliases（供 308 永久重定向），同时重命名
 * public/diagrams/{oldslug} → public/diagrams/{newslug} 并更新 diagrams JSON 内的 URL。
 *
 * 用法：node scripts/migrate-slugs.mjs
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

const ROOT = findRepoRoot(process.cwd());
const DB_PATH = path.join(ROOT, "data", "showcase.db");
const _require = createRequire(import.meta.url);
const betterSqlite3 = (() => {
  try {
    return _require("better-sqlite3");
  } catch {
    // monorepo 下 .mjs 无法解析 workspace 包，退回 .pnpm 绝对路径
    return _require(path.join(ROOT, "node_modules/.pnpm/better-sqlite3@13.2.0/node_modules/better-sqlite3"));
  }
})();

// 旧中文 slug → 新英文 slug（人工指定，保证语义与 SEO）
const MAPPING = {
  "magpie-给所有-ai-编程-agent-换模型的统一网关-mwsrb6r0":
    "magpie-unified-gateway-for-ai-coding-agents",
  "next-js-全栈-react-框架的深度解析-mwsz8enq":
    "nextjs-fullstack-react-framework-deep-dive",
  "superpowers-为编码代理注入完整软件开发方法论-mwszalwe":
    "superpowers-coding-agent-methodology",
  "测试项目-demotool-深度解析-mwsqq9ab": "demotool-deep-dive-test",
};

const db = new betterSqlite3(DB_PATH);
db.pragma("journal_mode = WAL");

// aliases 列兜底迁移
try {
  db.exec(`ALTER TABLE pages ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'`);
} catch {
  /* 已存在 */
}

const update = db.prepare(
  `UPDATE pages SET slug = ?, aliases = ?, diagrams = ? WHERE slug = ?`
);
const diagramsRoot = path.join(ROOT, "public", "diagrams");

let done = 0;
for (const [oldSlug, newSlug] of Object.entries(MAPPING)) {
  const row = db.prepare(`SELECT diagrams FROM pages WHERE slug = ?`).get(oldSlug);
  if (!row) {
    console.log(`跳过（不存在）: ${oldSlug}`);
    continue;
  }
  // 图表产物目录与 URL 一并迁移
  let diagrams = row.diagrams || "[]";
  const oldDir = path.join(diagramsRoot, oldSlug);
  const newDir = path.join(diagramsRoot, newSlug);
  if (fs.existsSync(oldDir)) {
    fs.rmSync(newDir, { recursive: true, force: true });
    fs.renameSync(oldDir, newDir);
  }
  if (diagrams.includes(oldSlug)) {
    diagrams = diagrams.split(`/diagrams/${oldSlug}/`).join(`/diagrams/${newSlug}/`);
  }
  const existingAliases = (() => {
    try {
      return JSON.parse(db.prepare(`SELECT aliases FROM pages WHERE slug = ?`).get(oldSlug).aliases || "[]");
    } catch {
      return [];
    }
  })();
  const aliases = JSON.stringify([...new Set([...existingAliases, oldSlug])]);
  update.run(newSlug, aliases, diagrams, oldSlug);
  done++;
  console.log(`✓ ${oldSlug} → ${newSlug}（aliases=${aliases}）`);
}

// chat_messages.page_slug 是展示用软引用，保留旧值不影响功能
console.log(`\n完成：${done} 篇页面已迁移。`);
db.close();
