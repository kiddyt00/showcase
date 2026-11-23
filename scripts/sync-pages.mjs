#!/usr/bin/env node
/**
 * 内容同步脚本：把本机 data/showcase.db 中的全部 pages 同步到目标站点。
 *
 * 用法：
 *   SYNC_TARGET=http://your-server:3100 SYNC_TOKEN=<ADMIN_TOKEN> pnpm sync
 *
 * 逻辑：
 *   - 逐条 POST /api/pages（header x-admin-token）
 *   - 409（slug 已存在）→ 改发 PATCH /api/pages/{slug} 全量更新
 *   - 输出成功 / 跳过 / 失败摘要
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const TARGET = process.env.SYNC_TARGET || "http://localhost:3100";
const TOKEN = process.env.SYNC_TOKEN || process.env.ADMIN_TOKEN;

// monorepo：默认定位仓库根的 data/（向上查找 pnpm-workspace.yaml），可用 DATA_DIR 覆盖
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

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(findRepoRoot(process.cwd()), "data");
const DB_PATH = path.join(DATA_DIR, "showcase.db");

if (!TOKEN) {
  console.error("错误：缺少同步令牌，请设置 SYNC_TOKEN（即目标站点的 ADMIN_TOKEN）");
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error(`错误：本地数据库不存在：${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare(`SELECT * FROM pages ORDER BY created_at ASC`).all();

function rowToPage(row) {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    source: { type: row.source_type, url: row.source_url ?? undefined, name: row.source_name ?? undefined },
    icon: row.icon ?? undefined,
    tags: JSON.parse(row.tags || "[]"),
    sections: JSON.parse(row.sections || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
    createdAt: row.created_at,
    generator: row.generator,
  };
}

const ok = [];
const skipped = [];
const failed = [];

for (const row of rows) {
  const page = rowToPage(row);
  const slug = encodeURIComponent(page.slug);
  const headers = {
    "Content-Type": "application/json",
    "x-admin-token": TOKEN,
  };
  try {
    const res = await fetch(`${TARGET}/api/pages`, {
      method: "POST",
      headers,
      body: JSON.stringify(page),
    });
    if (res.ok) {
      ok.push(page.slug);
      continue;
    }
    if (res.status === 409) {
      // slug 已存在 → 全量更新
      const patch = await fetch(`${TARGET}/api/pages/${slug}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          title: page.title,
          summary: page.summary,
          category: page.category,
          icon: page.icon,
          tags: page.tags,
          sections: page.sections,
          metadata: page.metadata,
        }),
      });
      if (patch.ok) {
        ok.push(`${page.slug}（更新）`);
      } else {
        failed.push(`${page.slug}: PATCH ${patch.status} ${await patch.text()}`);
      }
      continue;
    }
    failed.push(`${page.slug}: POST ${res.status} ${await res.text()}`);
  } catch (err) {
    failed.push(`${page.slug}: ${err.message}`);
  }
}

console.log(`同步目标: ${TARGET}`);
console.log(`本地页面总数: ${rows.length}`);
console.log(`成功: ${ok.length}${ok.length ? " →\n  - " + ok.join("\n  - ") : ""}`);
console.log(`跳过: ${skipped.length}`);
console.log(`失败: ${failed.length}${failed.length ? " →\n  - " + failed.join("\n  - ") : ""}`);

db.close();
process.exit(failed.length ? 1 : 0);
