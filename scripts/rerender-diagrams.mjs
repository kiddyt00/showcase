#!/usr/bin/env node
/**
 * 重新渲染全部 pages 的 diagrams（SeeCode）：
 * - 应用项目级 .seecode/config.json（watermark=false、fonts=system）
 * - cwd=仓库根，保证项目配置生效
 * - 两步：render → 交互 HTML；export --formats svg → 静态 SVG
 * - 更新 DB 中 diagrams 的 svgUrl/htmlUrl（通常不变），产物写入 public/diagrams/{slug}/
 *
 * 用法：pnpm rerender-diagrams   （或 node scripts/rerender-diagrams.mjs）
 */
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fsSync.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
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
    return _require(path.join(ROOT, "node_modules/.pnpm/better-sqlite3@13.2.0/node_modules/better-sqlite3"));
  }
})();

const SEECODE_CLI = path.join(ROOT, "packages", "core", "vendor", "seecode", "scripts", "seecode.mjs");
const DIAGRAMS_ROOT = path.join(ROOT, "public", "diagrams");
const TIMEOUT_MS = 30_000;

/** 移除 SVG 中可执行的注入点（与 packages/core/src/diagrams.ts sanitizeSvg 一致） */
function sanitizeSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
}

async function renderDiagram(slug, diagram) {
  const outDir = path.join(DIAGRAMS_ROOT, slug);
  const specStr = JSON.stringify(diagram.spec);
  if (specStr.includes("</script")) {
    console.warn(`  跳过 ${slug}/${diagram.id}：spec 含 </script>`);
    return diagram;
  }
  let workDir = null;
  try {
    await fs.mkdir(outDir, { recursive: true });
    // 临时目录必须在仓库根之下：SeeCode 按 spec 所在目录向上查 .seecode/config.json
    const tmpBase = path.join(ROOT, "node_modules", ".cache", "seecode-tmp");
    await fs.mkdir(tmpBase, { recursive: true });
    workDir = await fs.mkdtemp(path.join(tmpBase, `seecode-${diagram.id}-`));
    const specPath = path.join(workDir, `${diagram.id}.json`);
    await fs.writeFile(specPath, specStr, "utf8");

    // 1. render → 交互式 HTML
    const htmlPath = path.join(workDir, `${diagram.id}.html`);
    await execFileAsync("node", [SEECODE_CLI, "render", specPath, "--out", htmlPath], {
      timeout: TIMEOUT_MS,
      cwd: ROOT, // 项目级 .seecode/config.json（watermark=false、fonts=system）
    });
    const html = await fs.readFile(htmlPath, "utf8");
    if (!html.includes("<html")) throw new Error("render 未产出 HTML");
    const fitCss = `<style data-showcase-fit>
html, body { overflow: hidden !important; }
.sc-figure svg, .sc-stage svg { width: 100% !important; height: auto !important; max-width: 100% !important; display: block; }
.sc-figure { display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0 !important; }
.sc-toolbar, .sc-mini { display: none !important; }
</style></head>`;
    const fittedHtml = html.includes("</head>") ? html.replace("</head>", fitCss) : html + fitCss;
    await fs.writeFile(path.join(outDir, `${diagram.id}.html`), fittedHtml, "utf8");

    // 2. export → 静态 SVG
    await execFileAsync("node", [SEECODE_CLI, "export", htmlPath, "--formats", "svg"], {
      timeout: TIMEOUT_MS,
      cwd: ROOT,
    });
    const svg = await fs.readFile(path.join(workDir, `${diagram.id}.svg`), "utf8");
    if (!svg.includes("<svg")) throw new Error("export 未产出 SVG 内容");
    await fs.writeFile(path.join(outDir, `${diagram.id}.svg`), sanitizeSvg(svg), "utf8");

    console.log(`  ✓ ${diagram.id}（html+svg）`);
    return { ...diagram, svgUrl: `/diagrams/${slug}/${diagram.id}.svg`, htmlUrl: `/diagrams/${slug}/${diagram.id}.html` };
  } catch (err) {
    console.warn(`  ✗ ${slug}/${diagram.id}:`, err instanceof Error ? err.message : err);
    return diagram;
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const db = new betterSqlite3(DB_PATH);
try {
  db.exec(`ALTER TABLE pages ADD COLUMN diagrams TEXT NOT NULL DEFAULT '[]'`);
} catch {
  /* 已存在 */
}
const rows = db.prepare(`SELECT slug, diagrams FROM pages WHERE diagrams != '[]'`).all();
const update = db.prepare(`UPDATE pages SET diagrams = ? WHERE slug = ?`);

let total = 0;
for (const row of rows) {
  const diagrams = JSON.parse(row.diagrams || "[]");
  if (!diagrams.length) continue;
  console.log(`页面 ${row.slug}（${diagrams.length} 张图）`);
  const rendered = [];
  for (const d of diagrams) {
    rendered.push(await renderDiagram(row.slug, d));
    total++;
  }
  update.run(JSON.stringify(rendered), row.slug);
}
console.log(`\n完成：${rows.length} 篇页面 / ${total} 张图已重渲染。`);
db.close();
