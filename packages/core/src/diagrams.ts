/**
 * SeeCode 图表渲染服务
 * 把 Diagram spec 交给内嵌的 SeeCode CLI：
 *   validate → render（交互式 HTML，网页 iframe 嵌入）→ export（静态 SVG，视频场景用）
 * 渲染失败不抛错：返回 error 字段供上层回喂 LLM 修正 spec 后重试。
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
/** 动画 mp4 导出是浏览器逐帧步进，比静态导出慢得多，单独放宽超时 */
const MP4_EXPORT_TIMEOUT_MS = 120_000;

/**
 * mp4 导出互斥队列：多个图表并行渲染时，Chrome 逐帧步进导出并发会互相干扰
 * （实测并行双导出随机失败），这里串行化 mp4 导出，svg/html 仍并行。
 */
let mp4ExportQueue: Promise<void> = Promise.resolve();

function enqueueMp4Export<T>(task: () => Promise<T>): Promise<T> {
  const run = mp4ExportQueue.then(task, task);
  mp4ExportQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export interface DiagramRenderResult {
  diagram: Diagram;
  /** 渲染失败原因（SeeCode 校验问题或执行错误），成功时为 undefined */
  error?: string;
}

export interface FailedDiagram {
  diagram: Diagram;
  error: string;
}

/** 校验 SeeCode spec，返回结构化问题列表（空数组 = 通过） */
export async function validateDiagramSpecFile(specPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "node",
      [SEECODE_CLI, "validate", specPath],
      { timeout: 15_000, cwd: REPO_ROOT_DIR }
    );
    return parseProblems(stdout) ?? [];
  } catch (err) {
    const out = (err as { stdout?: string; stderr?: string })?.stdout ??
      (err as { stderr?: string })?.stderr ?? "";
    const fallback = parseProblems(out);
    return fallback ?? [String(out).slice(0, 300) || "校验失败"];
  }
}

function parseProblems(out: string): string[] | null {
  try {
    const parsed = JSON.parse(out) as { problems?: { msg?: string; message?: string }[] };
    if (!parsed || typeof parsed !== "object") return null;
    return (parsed.problems ?? []).map(
      (p) => [p.msg, p.message].filter(Boolean).join(" ") || "未知问题"
    );
  } catch {
    return null;
  }
}

/** 渲染单张图表。失败不抛错，返回 error 供上层（LLM 修正重试）使用。 */
export async function renderDiagram(
  slug: string,
  diagram: Diagram
): Promise<DiagramRenderResult> {
  const outDir = path.join(DIAGRAMS_ROOT, slug);
  const svgUrl = `/diagrams/${slug}/${diagram.id}.svg`;
  const htmlUrl = `/diagrams/${slug}/${diagram.id}.html`;

  // spec 里不允许出现 </script>（会被嵌入 HTML 的 <script> 数据段，防提前闭合）
  const specStr = JSON.stringify(diagram.spec);
  if (specStr.includes("</script")) {
    console.warn(`[diagram] ${slug}/${diagram.id} spec 含 </script>，已拒绝渲染`);
    return { diagram, error: "spec 含 </script>，存在注入风险，已拒绝渲染" };
  }

  let workDir: string | null = null;
  try {
    await fs.mkdir(outDir, { recursive: true });
    // 临时目录必须在仓库根之下：SeeCode 按 spec 所在目录向上查 .seecode/config.json
    const tmpBase = path.join(REPO_ROOT_DIR, "node_modules", ".cache", "seecode-tmp");
    await fs.mkdir(tmpBase, { recursive: true });
    workDir = await fs.mkdtemp(path.join(tmpBase, `seecode-${diagram.id}-`));
    const specPath = path.join(workDir, `${diagram.id}.json`);
    await fs.writeFile(specPath, specStr, "utf8");

    // 0. 预校验：拿 SeeCode 结构化问题列表（供上层回喂 LLM 修正）
    const problems = await validateDiagramSpecFile(specPath);
    if (problems.length) {
      return { diagram, error: `SeeCode spec 校验失败: ${problems.join("; ")}` };
    }

    // 1. render spec → 交互式 HTML（cwd=仓库根以读取项目级 .seecode/config.json）
    const htmlPath = path.join(workDir, `${diagram.id}.html`);
    await execFileAsync("node", [SEECODE_CLI, "render", specPath, "--out", htmlPath], {
      timeout: RENDER_TIMEOUT_MS,
      cwd: REPO_ROOT_DIR,
    });
    const html = await fs.readFile(htmlPath, "utf8");
    if (!html.includes("<html")) throw new Error("render 未产出 HTML");

    // 注入自适应缩放 CSS：图永远缩放铺满 iframe，不出现滚动条/鼠标拖动
    const fitCss = `<style data-showcase-fit>
html, body { overflow: hidden !important; }
.sc-figure svg, .sc-stage svg { width: 100% !important; height: auto !important; max-width: 100% !important; display: block; }
.sc-figure { display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0 !important; }
.sc-toolbar, .sc-mini { display: none !important; }
</style></head>`;
    const fittedHtml = html.includes("</head>")
      ? html.replace("</head>", fitCss)
      : html + fitCss;
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
      console.warn(
        `[diagram] ${slug}/${diagram.id} SVG 导出失败（HTML 嵌入不受影响）:`,
        err instanceof Error ? err.message : err
      );
    }

    // 3. export → 动画 MP4（SeeCode 浏览器逐帧步进"逐步绘制"，解说视频场景用）
    // 依赖系统 Chrome；失败（无浏览器/超时）只告警，不影响 html/svg 产物
    let mp4UrlOut: string | undefined;
    try {
      await enqueueMp4Export(() =>
        execFileAsync("node", [SEECODE_CLI, "export", htmlPath, "--formats", "mp4"], {
          timeout: MP4_EXPORT_TIMEOUT_MS,
          cwd: REPO_ROOT_DIR,
        })
      );
      const mp4Path = path.join(workDir, `${diagram.id}.mp4`);
      const stat = await fs.stat(mp4Path);
      if (!stat.isFile() || stat.size === 0) throw new Error("export 未产出 MP4 内容");
      await fs.copyFile(mp4Path, path.join(outDir, `${diagram.id}.mp4`));
      mp4UrlOut = `/diagrams/${slug}/${diagram.id}.mp4`;
    } catch (err) {
      console.warn(
        `[diagram] ${slug}/${diagram.id} 动画 MP4 导出失败（HTML/SVG 不受影响）:`,
        err instanceof Error ? err.message : err
      );
    }

    return { diagram: { ...diagram, svgUrl: svgUrlOut, mp4Url: mp4UrlOut, htmlUrl } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[diagram] 渲染图表 ${slug}/${diagram.id} 失败:`, msg);
    return { diagram, error: msg.slice(0, 400) };
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface RenderPageDiagramsResult {
  /** 渲染失败的图表清单（含错误信息，供上层回喂 LLM 修正 spec 后重试） */
  failed: FailedDiagram[];
}

/** 渲染页面所有图表；成功的回写 page.diagrams，失败的返回清单 */
export async function renderPageDiagrams(
  page: PageContent
): Promise<RenderPageDiagramsResult> {
  if (!page.diagrams?.length) return { failed: [] };
  const results = await Promise.all(
    page.diagrams.map((d) => renderDiagram(page.slug, d))
  );
  const failed: FailedDiagram[] = [];
  const ok: Diagram[] = [];
  for (const r of results) {
    if (r.error) failed.push({ diagram: r.diagram, error: r.error });
    else ok.push(r.diagram);
  }
  page.diagrams = ok;
  return { failed };
}

/** 移除 SVG 中可执行的注入点：<script>、on* 事件属性、javascript: href */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(
      /(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi,
      '$1="#"'
    );
}
