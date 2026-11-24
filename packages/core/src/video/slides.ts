/**
 * 幻灯片模式：PageContent → 排版 HTML → chrome-headless-shell 截图 PNG
 * 风格：渐变毛玻璃（深空渐变底 + 半透明玻璃卡片 + 电光青强调），与站点 tech 主题同源
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openBrowser, type HeadlessBrowser } from "@remotion/renderer";
import { PUBLIC_ASSETS_DIR, REPO_ROOT_DIR } from "../paths";
import type { PageContent } from "../types";
import { DIMENSIONS, Orientation } from "./types";

// chrome-headless-shell 一次性 --screenshot 模式在本环境存在已知问题（network service 崩溃挂起），
// 而 CDP 协议驱动同一二进制可用（Remotion 渲染即走该路径）——故保留 execFile 为主路径并加 CDP 兜底。
/** CDP 兜底：openBrowser 打开 chrome-headless-shell，Page.captureScreenshot 截图 */
async function cdpScreenshot(
  width: number,
  height: number,
  htmlPath: string,
  pngPath: string,
  browserRef: { browser: HeadlessBrowser | null }
): Promise<void> {
  if (!browserRef.browser) {
    browserRef.browser = await openBrowser("chrome", {
      browserExecutable: CHROME_PATH,
      logLevel: "error",
    });
  }
  const noop = () => null;
  const page = await browserRef.browser._createPageInContext({
    context: noop,
    logLevel: "error",
    indent: false,
    pageIndex: 0,
    onBrowserLog: null,
    onLog: noop,
  });
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto({ url: `file://${htmlPath}`, timeout: 15000 });
    // 等待字体/backdrop-filter 合成
    await new Promise((r) => setTimeout(r, 600));
    const client = page._client();
    const res = (await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    })) as { data?: string; value?: { data?: string } };
    const data = res.data ?? res.value?.data;
    if (!data) throw new Error("CDP 截图未返回数据");
    await fsp.writeFile(pngPath, Buffer.from(data, "base64"));
  } finally {
    await page.close().catch(() => {});
  }
}

/** chrome-headless-shell 二进制（Remotion 下载），缺失时抛错降级 */
const CHROME_PATH = path.resolve(
  REPO_ROOT_DIR,
  "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"
);

/** 关键 section 页数上限（封面 + 5 + 尾页 ≤ 7 场景，与脚本 MAX_SCENES 对齐） */
const MAX_SECTION_SLIDES = 5;

const ACCENT = "#22d3ee";

/** HTML 转义 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 去 Markdown 符号 + 压缩空白 */
function plain(s: string): string {
  return s.replace(/[#*`\[\]()>|]/g, "").replace(/\s+/g, " ").trim();
}

/** 页面骨架：深空对角渐变底 + 极光光斑 + 网格噪点纹理 */
function pageShell(inner: string, w: number, h: number): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
  body {
    font-family: "Rajdhani", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    background: linear-gradient(135deg, #0a0e1a 0%, #10182e 55%, #1a2440 100%);
    color: #e8edf7;
    position: relative;
  }
  .bg { position: absolute; inset: 0; }
  .blob { position: absolute; border-radius: 50%; filter: blur(90px); }
  .blob-a { width: ${Math.round(w * 0.42)}px; height: ${Math.round(w * 0.42)}px; left: -6%; top: -12%;
    background: radial-gradient(circle, rgba(34,211,238,0.20), transparent 70%); }
  .blob-b { width: ${Math.round(w * 0.36)}px; height: ${Math.round(w * 0.36)}px; right: -4%; bottom: -10%;
    background: radial-gradient(circle, rgba(99,102,241,0.16), transparent 70%); }
  .grid { position: absolute; inset: 0; opacity: 0.5;
    background-image: linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px);
    background-size: 64px 64px; }
  .stage { position: absolute; inset: 0; display: flex; flex-direction: column;
    justify-content: center; padding: ${Math.round(h * 0.09)}px ${Math.round(w * 0.08)}px; }
  .card {
    background: rgba(255,255,255,0.055);
    backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 28px;
    box-shadow: 0 32px 80px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.10);
  }
  .accent { color: ${ACCENT}; }
  .kicker { font-size: ${Math.round(h * 0.026)}px; letter-spacing: 6px; color: ${ACCENT};
    text-transform: uppercase; font-weight: 600; }
  .rule { width: 120px; height: 4px; border-radius: 2px; margin: 26px 0;
    background: linear-gradient(90deg, ${ACCENT}, rgba(34,211,238,0)); }
  .tag { display: inline-block; font-size: ${Math.round(h * 0.024)}px; color: ${ACCENT};
    border: 1px solid rgba(34,211,238,0.55); border-radius: 999px;
    padding: 8px 26px; background: rgba(34,211,238,0.08); margin: 0 14px 14px 0; }
  .brand { position: absolute; bottom: ${Math.round(h * 0.05)}px; left: ${Math.round(w * 0.08)}px;
    right: ${Math.round(w * 0.08)}px; display: flex; justify-content: space-between;
    font-size: ${Math.round(h * 0.022)}px; color: rgba(226,232,240,0.5); letter-spacing: 3px; }
</style></head>
<body>
  <div class="bg"><div class="blob blob-a"></div><div class="blob blob-b"></div><div class="grid"></div></div>
  ${inner}
</body></html>`;
}

/** 封面页：title + summary + tags */
function coverHtml(page: PageContent, w: number, h: number): string {
  const titleSize = Math.round(h * 0.088);
  const sumSize = Math.round(h * 0.036);
  const tags = page.tags.slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return pageShell(
    `<div class="stage">
      <div class="kicker">SHOWCASE · ${esc(page.category)}</div>
      <h1 style="font-size:${titleSize}px; font-weight:700; line-height:1.18; margin:30px 0 0; max-width:88%;">${esc(page.title)}</h1>
      <div class="rule"></div>
      <p style="font-size:${sumSize}px; line-height:1.6; color:#b6c2d9; max-width:80%;">${esc(page.summary)}</p>
      <div style="margin-top:44px;">${tags}</div>
    </div>
    <div class="brand"><span>SHOWCASE</span><span class="accent">SLIDES</span></div>`,
    w,
    h
  );
}

/** 内容页：heading + body 前 120 字 + bullets 前 3 条（毛玻璃卡片承载要点） */
function sectionHtml(heading: string, body: string, bullets: string[], index: number, w: number, h: number): string {
  const headSize = Math.round(h * 0.058);
  const bodySize = Math.round(h * 0.03);
  const bulletSize = Math.round(h * 0.028);
  const bulletItems = bullets
    .slice(0, 3)
    .map(
      (b) =>
        `<li style="display:flex; align-items:flex-start; gap:18px; margin-bottom:22px;">
          <span style="color:${ACCENT}; font-size:${bulletSize}px; line-height:1.55;">▸</span>
          <span style="font-size:${bulletSize}px; line-height:1.55; color:#dbe4f0;">${esc(b)}</span>
        </li>`
    )
    .join("");
  return pageShell(
    `<div class="stage">
      <div class="kicker">0${index} / SECTION</div>
      <h1 style="font-size:${headSize}px; font-weight:700; line-height:1.25; margin:26px 0 0; max-width:88%;">${esc(heading)}</h1>
      <div class="rule"></div>
      <p style="font-size:${bodySize}px; line-height:1.75; color:#b6c2d9; max-width:82%;">${esc(body)}</p>
      ${bulletItems ? `<div class="card" style="margin-top:44px; padding:38px 44px; max-width:78%;"><ul style="list-style:none;">${bulletItems}</ul></div>` : ""}
    </div>
    <div class="brand"><span>SHOWCASE</span><span class="accent">0${index}</span></div>`,
    w,
    h
  );
}

/** 尾页：行动卡 "去看看 →" + slug */
function endHtml(slug: string, w: number, h: number): string {
  const ctaSize = Math.round(h * 0.115);
  const slugSize = Math.round(h * 0.03);
  return pageShell(
    `<div class="stage">
      <div class="kicker">CALL TO ACTION</div>
      <h1 style="font-size:${ctaSize}px; font-weight:700; line-height:1.1; margin:34px 0 0;">
        去看看 <span class="accent">→</span>
      </h1>
      <div style="margin-top:52px;">
        <span style="display:inline-block; font-family:'SF Mono','JetBrains Mono',monospace; font-size:${slugSize}px;
          color:${ACCENT}; border:2px solid rgba(34,211,238,0.7); border-radius:18px; padding:16px 38px;
          background:rgba(34,211,238,0.10);">${esc(slug)}</span>
      </div>
      <p style="font-size:${Math.round(h * 0.028)}px; color:#b6c2d9; margin-top:36px;">链接就在页面下方</p>
    </div>
    <div class="brand"><span>SHOWCASE</span><span class="accent">GO →</span></div>`,
    w,
    h
  );
}

export interface SlidesResult {
  /** PNG public 相对路径数组（失败的页已跳过） */
  slideFiles: string[];
  /** 实际截图宽高比（w/h） */
  aspect: number;
}

/**
 * 生成幻灯片截图：封面 + 每个 section（≤5）+ 尾页。
 * 单页截图失败降级跳过；chrome 二进制缺失抛错（调用方回退标准模式）。
 */
export async function generateSlides(
  page: PageContent,
  orientation: Orientation
): Promise<SlidesResult> {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error("chrome-headless-shell 不存在，幻灯片模式不可用");
  }
  const { width, height } = DIMENSIONS[orientation];
  const aspect = width / height;

  type SlideSpec = { kind: "cover" } | { kind: "section"; heading: string; body: string; bullets: string[]; index: number } | { kind: "end" };
  const specs: SlideSpec[] = [{ kind: "cover" }];
  const sections = page.sections.filter((s) => s.heading || s.body).slice(0, MAX_SECTION_SLIDES);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    specs.push({
      kind: "section",
      heading: s.heading || page.title,
      body: plain(s.body).slice(0, 120),
      bullets: (s.bullets ?? []).map(plain).filter(Boolean).slice(0, 3),
      index: i + 1,
    });
  }
  specs.push({ kind: "end" });

  const outDirRel = `videos/${page.slug}-slides/${orientation}`;
  const outDir = path.join(PUBLIC_ASSETS_DIR, outDirRel);
  await fsp.mkdir(outDir, { recursive: true });

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "slides-"));
  const slideFiles: string[] = [];
  const cdpBrowserRef: { browser: HeadlessBrowser | null } = { browser: null };
  try {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const html =
        spec.kind === "cover"
          ? coverHtml(page, width, height)
          : spec.kind === "section"
            ? sectionHtml(spec.heading, spec.body, spec.bullets, spec.index, width, height)
            : endHtml(page.slug, width, height);
      const htmlPath = path.join(tmpDir, `slide-${i}.html`);
      await fsp.writeFile(htmlPath, html, "utf8");
      const pngRel = `${outDirRel}/slide-${i}.png`;
      const pngPath = path.join(PUBLIC_ASSETS_DIR, pngRel);
      try {
        try {
          // 主路径：chrome-headless-shell 一次性 --screenshot
          await new Promise<void>((resolve, reject) => {
            execFile(
              CHROME_PATH,
              [
                "--headless",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                `--user-data-dir=${path.join(tmpDir, `profile-${i}`)}`,
                `--screenshot=${pngPath}`,
                `--window-size=${width},${height}`,
                "--hide-scrollbars",
                "--timeout=8000",
                `file://${htmlPath}`,
              ],
              { timeout: 15000 },
              (err) => (err ? reject(err) : resolve())
            );
          });
        } catch {
          // 兜底：CDP 协议驱动同一二进制（本环境一次性截图模式不可用）
          await cdpScreenshot(width, height, htmlPath, pngPath, cdpBrowserRef);
        }
        const stat = await fsp.stat(pngPath);
        if (!stat.isFile() || stat.size === 0) throw new Error("截图输出为空");
        slideFiles.push(pngRel);
      } catch (err) {
        // 单页降级：该页跳过（对应场景回退默认布局）
        console.warn(
          `[slides] 幻灯片 ${i} 截图失败，跳过:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } finally {
    if (cdpBrowserRef.browser) {
      await cdpBrowserRef.browser.close({ silent: true }).catch(() => {});
    }
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  if (!slideFiles.length) {
    throw new Error("全部幻灯片截图失败");
  }
  return { slideFiles, aspect };
}
