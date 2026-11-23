/**
 * SeeCode 图表渲染服务
 * 把 Diagram spec 交给内嵌的 SeeCode CLI 渲染成 SVG，写入 public/diagrams/{slug}/。
 * 渲染失败不抛错（降级为无 svgUrl），保证页面创建流程不被图表阻塞。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Diagram, PageContent } from "./types";
import { CORE_ROOT, PUBLIC_ASSETS_DIR, REPO_ROOT_DIR } from "./paths";

const execFileAsync = promisify(execFile);

const SEECODE_CLI = path.join(CORE_ROOT, "vendor", "seecode", "scripts", "seecode.mjs");
const DIAGRAMS_ROOT = path.join(PUBLIC_ASSETS_DIR, "diagrams");
const RENDER_TIMEOUT_MS = 30_000;

/**
 * 渲染单张图表：
 *   render → 交互式 HTML（网页 iframe 嵌入，保留悬停/聚焦/动画）
 *   export --formats svg → 静态 SVG（解说视频场景用）
 * 任一步失败都降级返回原 diagram（无 URL），不阻塞页面创建流程。
 */
export async function renderDiagram(slug: string, diagram: Diagram): Promise<Diagram> {
  const outDir = path.join(DIAGRAMS_ROOT, slug);
  const svgUrl = `/diagrams/${slug}/${diagram.id}.svg`;
  const htmlUrl = `/diagrams/${slug}/${diagram.id}.html`;

  // spec 里不允许出现 </script>（会被嵌入 HTML 的 <script> 数据段，防提前闭合）
  const specStr = JSON.stringify(diagram.spec);
  if (specStr.includes("</script")) {
    console.warn(`[diagram] ${slug}/${diagram.id} spec 含 </script>，已拒绝渲染`);
    return diagram;
  }

  let workDir: string | null = null;
  try {
    await fs.mkdir(outDir, { recursive: true });
    // 临时目录必须在仓库根之下：SeeCode 按spec 所在目录向上查 .seecode/config.json，
    // /tmp 下查不到项目配置（watermark=false、fonts=system 不生效）
    const tmpBase = path.join(REPO_ROOT_DIR, "node_modules", ".cache", "seecode-tmp");
    await fs.mkdir(tmpBase, { recursive: true });
    workDir = await fs.mkdtemp(path.join(tmpBase, `seecode-${diagram.id}-`));
    const specPath = path.join(workDir, `${diagram.id}.json`);
    await fs.writeFile(specPath, specStr, "utf8");

    // 1. render spec → 交互式 HTML
    const htmlPath = path.join(workDir, `${diagram.id}.html`);
    // cwd 设为仓库根：SeeCode 需要读取项目级 .seecode/config.json（watermark=false、fonts=system）
    await execFileAsync("node", [SEECODE_CLI, "render", specPath, "--out", htmlPath], {
      timeout: RENDER_TIMEOUT_MS,
      cwd: REPO_ROOT_DIR,
    });
    const html = await fs.readFile(htmlPath, "utf8");
    if (!html.includes("<html")) throw new Error("render 未产出 HTML");
    // 注入自适应缩放 CSS：图永远缩放到铺满 iframe，任何尺寸下不出现滚动条/鼠标拖动
    const fitCss = `<style data-showcase-fit>
html, body { overflow: hidden !important; }
.sc-figure svg, .sc-stage svg { width: 100% !important; height: auto !important; max-width: 100% !important; display: block; }
.sc-figure { display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0 !important; }
.sc-toolbar, .sc-mini { display: none !important; }
</style></head>`;
    const fittedHtml = html.includes("</head>") ? html.replace("</head>", fitCss) : html + fitCss;
    await fs.writeFile(path.join(outDir, `${diagram.id}.html`), fittedHtml, "utf8");

    // 2. export → 静态 SVG（纯 Node 导出，失败不影响 HTML 嵌入）
    let svgUrlOut: string | undefined;
    try {
      await execFileAsync("node", [SEECODE_CLI, "export", htmlPath, "--formats", "svg"], {
        timeout: RENDER_TIMEOUT_MS,
        cwd: REPO_ROOT_DIR,
      });
      const svgPath = path.join(workDir, `${diagram.id}.svg`);
      const svg = await fs.readFile(svgPath, "utf8");
      if (!svg.includes("<svg")) throw new Error("export 未产出 SVG 内容");
      await fs.writeFile(path.join(outDir, `${diagram.id}.svg`), sanitizeSvg(svg), "utf8");
      svgUrlOut = svgUrl;
    } catch (err) {
      console.warn(`[diagram] ${slug}/${diagram.id} SVG 导出失败（HTML 嵌入不受影响）:`, err instanceof Error ? err.message : err);
    }

    return { ...diagram, svgUrl: svgUrlOut, htmlUrl };
  } catch (err) {
    console.warn(
      `[diagram] 渲染图表 ${slug}/${diagram.id} 失败:`,
      err instanceof Error ? err.message : err
    );
    return diagram;
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 遍历渲染页面所有图表 */
export async function renderPageDiagrams(page: PageContent): Promise<void> {
  if (!page.diagrams?.length) return;
  page.diagrams = await Promise.all(page.diagrams.map((d) => renderDiagram(page.slug, d)));
}

/** 移除 SVG 中可执行的注入点：<script>、on* 事件属性、javascript: href */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
}
