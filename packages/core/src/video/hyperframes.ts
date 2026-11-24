/**
 * HyperFrames 渲染管线：同一份分镜 storyboard → HTML+GSAP 组合 → HyperFrames CLI 渲染 MP4。
 * 与 Remotion 版（pipeline.ts）共用 buildSpec 产出的场景数据与 TTS 音频，只换渲染引擎。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getPage } from "../store";
import { DIMENSIONS, FPS, Orientation, Scene, VideoJobSpec, VideoMode } from "./types";
import { PUBLIC_ASSETS_DIR } from "../paths";
import { VIDEO_DIR, buildSpec } from "./pipeline";

/** 定位 hyperframes 可执行文件（agent app 的 node_modules / monorepo 根 / 全局） */
function hfBin(): string {
  const fsSync = require("node:fs") as typeof import("node:fs");
  // pnpm 布局：agent app cwd = apps/agent；monorepo 根 node_modules 也要覆盖
  const candidates = [
    path.join(process.cwd(), "node_modules", ".bin", "hyperframes.cmd"),
    path.join(process.cwd(), "node_modules", ".bin", "hyperframes"),
    path.join(process.cwd(), "..", "..", "node_modules", ".bin", "hyperframes.cmd"),
    path.join(process.cwd(), "..", "..", "node_modules", ".bin", "hyperframes"),
  ];
  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) {
        console.warn(`[hf] 使用可执行文件: ${c}`);
        return c;
      }
    } catch {
      /* try next */
    }
  }
  console.warn(`[hf] 未找到本地 hyperframes（cwd=${process.cwd()}），回退 npx`);
  return "npx";
}

/** 跑 hyperframes 命令（在指定 cwd） */
function runHf(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const bin = hfBin();
    const cmd = bin === "npx" ? "npx" : bin;
    const finalArgs = bin === "npx" ? ["hyperframes", ...args] : args;
    const child = spawn(cmd, finalArgs, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hyperframes 命令超时（${timeoutMs / 1000}s）`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SIZE_PX: Record<string, number> = { giant: 150, large: 96, medium: 56, small: 34 };
const COLOR_MAP: Record<string, string> = { fg: "#f4f4f5", accent: "#10b981", sub: "#a1a1aa" };

interface LayerHtml {
  html: string;
  anim: string;
}

/** 原语 → HTML+GSAP（与 ab-test 同款实现，按 storyboard 层声明生成） */
function renderLayer(
  l: NonNullable<NonNullable<Scene["storyboard"]>["layers"]>[number],
  sceneStart: number,
  idx: number,
  durSec: number
): LayerHtml {
  const d = (l.enter && l.enter.delaySec) || 0;
  const at = (sceneStart + d).toFixed(2);
  const id = `s${String(sceneStart).replace(/\./g, "_")}-l${idx}`;

  switch (l.type) {
    case "text": {
      const size = SIZE_PX[l.size ?? "large"] ?? 96;
      const color = COLOR_MAP[l.color ?? "fg"];
      const align = l.align === "center" ? "center" : "left";
      const fx = l.enter?.fx ?? "fade-up";
      let anim: string;
      if (fx === "scramble") {
        anim = `
  (function(){
    const el = document.querySelector('#${id}');
    const final = el.dataset.text;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&';
    function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; } }
    const o = {p:0};
    tl.to(o, {p:1, duration:1.4, ease:'none', onUpdate:function(){
      const rnd = mulberry32(Math.floor(o.p * 1000) + 7);
      const n = Math.floor(o.p * final.length * 1.6);
      let out = '';
      for (let k=0;k<final.length;k++){
        out += (k < n) ? final[k] : (final[k]===' '?' ':chars[Math.floor(rnd()*chars.length)]);
      }
      el.textContent = out;
    }, onComplete:function(){ el.textContent = final; }}, ${at});
  })();`;
      } else if (fx === "spring") {
        anim = `  tl.from('#${id}', {opacity:0, scale:0.86, y:28, duration:0.9, ease:'back.out(2.2)'}, ${at});`;
      } else if (fx === "scale-blur") {
        anim = `  tl.from('#${id}', {opacity:0, scale:0.92, duration:0.8, ease:'power3.out'}, ${at});`;
      } else {
        anim = `  tl.from('#${id}', {opacity:0, y:26, duration:0.7, ease:'power3.out'}, ${at});`;
      }
      return {
        html: `<div id="${id}" class="layer text${align === "center" ? " center" : ""}" data-text="${esc(l.content)}" style="font-size:${size}px;color:${color};text-align:${align};${l.size === "giant" ? "font-weight:900" : "font-weight:800"}">${esc(l.content)}</div>`,
        anim,
      };
    }
    case "metric": {
      const num = parseFloat(String(l.value).replace(/[^0-9.]/g, "")) || 0;
      const prefix = String(l.value).match(/^[^0-9]*/)?.[0] ?? "";
      const suffix = String(l.value).replace(/^[^0-9]*/, "").replace(/[\d.,]/g, "") ?? "";
      return {
        html: `<div id="${id}" class="layer metric"><div class="metric-value"><span class="pre">${esc(prefix)}</span><span class="num" data-to="${num}">0</span><span class="suf">${esc(suffix)}</span></div><div class="metric-label">${esc(l.label)}</div></div>`,
        anim: `
  (function(){
    const wrap = document.querySelector('#${id}');
    const numEl = wrap.querySelector('.num');
    const to = parseFloat(numEl.dataset.to);
    const o = {v:0};
    tl.from(wrap, {opacity:0, y:30, duration:0.6, ease:'power2.out'}, ${at});
    tl.to(o, {v:to, duration:1.3, ease:'power2.out', onUpdate:function(){
      const n = o.v;
      numEl.textContent = n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(n < 10 ? 1 : 0);
    }}, ${at + 0.1});
    tl.from(wrap.querySelector('.metric-label'), {opacity:0, y:12, duration:0.5, ease:'power2.out'}, ${at + 0.4});
  })();`,
      };
    }
    case "stats": {
      const items = l.stats
        .map((s) => `<div class="stat"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div>${s.delta ? `<div class="stat-delta">${esc(s.delta)}</div>` : ""}</div>`)
        .join("");
      const cols = l.stats.length <= 2 ? l.stats.length : 2;
      return {
        html: `<div id="${id}" class="layer stats" style="grid-template-columns:repeat(${cols},1fr)">${items}</div>`,
        anim: `  tl.from('#${id} .stat', {opacity:0, y:34, duration:0.75, stagger:0.16, ease:'power3.out'}, ${at});`,
      };
    }
    case "ring": {
      const r = 200;
      const circ = 2 * Math.PI * r;
      const ratio = Math.min(1, Math.max(0, l.ratio));
      const finalTxt = l.centerText ?? `${Math.round(ratio * 100)}%`;
      return {
        html: `<div id="${id}" class="layer ring-wrap"><svg width="520" height="520" viewBox="0 0 520 520" class="ring"><circle cx="260" cy="260" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="26"/><circle class="ring-fg" cx="260" cy="260" r="${r}" fill="none" stroke="#10b981" stroke-width="26" stroke-linecap="round" transform="rotate(-90 260 260)" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${circ.toFixed(1)}"/><text x="260" y="272" text-anchor="middle" class="ring-text" data-final="${esc(finalTxt)}">0%</text></svg><div class="ring-label">${esc(l.label)}</div></div>`,
        anim: `
  (function(){
    const wrap = document.querySelector('#${id}');
    const ring = wrap.querySelector('.ring-fg');
    const txt = wrap.querySelector('.ring-text');
    const circ = ${circ.toFixed(1)};
    const ratio = ${ratio};
    const finalTxt = txt.dataset.final;
    const o = {p:0};
    tl.from(wrap, {opacity:0, scale:0.88, duration:0.9, ease:'power3.out'}, ${at});
    tl.to(o, {p:1, duration:1.5, ease:'power2.out', onUpdate:function(){
      ring.setAttribute('stroke-dashoffset', (circ*(1-ratio*o.p)).toFixed(1));
      const pct = Math.round(ratio*o.p*100);
      txt.textContent = finalTxt.replace(/[\\d.]+/, pct);
    }}, ${at + 0.2});
    tl.from(wrap.querySelector('.ring-label'), {opacity:0, y:16, duration:0.6, ease:'power2.out'}, ${at + 0.9});
  })();`,
      };
    }
    case "quote":
      return {
        html: `<div id="${id}" class="layer quote"><div class="quote-mark">“</div><div class="quote-text">${esc(l.quote)}</div>${l.author ? `<div class="quote-author"><span class="quote-rule"></span><span>${esc(l.author)}</span></div>` : ""}</div>`,
        anim: `
  tl.from('#${id}', {opacity:0, y:40, duration:0.9, ease:'power3.out'}, ${at});
  tl.from('#${id} .quote-mark', {opacity:0, scale:0.5, duration:0.8, ease:'back.out(1.8)'}, ${at});
  tl.from('#${id} .quote-author', {opacity:0, y:14, duration:0.6, ease:'power2.out'}, ${at + 0.35});
  tl.from('#${id} .quote-rule', {scaleX:0, duration:0.7, ease:'power2.inOut', transformOrigin:'left center'}, ${at + 0.5});`,
      };
    case "timeline": {
      const steps = l.steps
        .map((s, k) => `<div class="tl-step"><div class="tl-dot">${k + 1}</div><div class="tl-name">${esc(s)}</div></div>`)
        .join("");
      return {
        html: `<div id="${id}" class="layer timeline"><div class="tl-line"></div><div class="tl-row">${steps}</div></div>`,
        anim: `
  tl.from('#${id} .tl-line', {scaleX:0, duration:0.9, ease:'power2.inOut', transformOrigin:'left center'}, ${at});
  tl.from('#${id} .tl-step', {opacity:0, y:26, scale:0.8, duration:0.7, stagger:0.18, ease:'back.out(1.8)'}, ${at + 0.15});`,
      };
    }
    case "card":
      return {
        html: `<div id="${id}" class="layer card${l.accent ? " accent" : ""}">${l.title ? `<div class="card-title">${esc(l.title)}</div>` : ""}${l.body ? `<div class="card-body">${esc(l.body)}</div>` : ""}</div>`,
        anim: `
  tl.from('#${id}', {opacity:0, y:24, duration:0.7, ease:'power3.out'}, ${at});
  tl.fromTo('#${id}', {backgroundPosition:'-140% 0'}, {backgroundPosition:'240% 0', duration:1.8, ease:'power2.inOut'}, ${at});`,
      };
    case "compare": {
      const beats = l.beats ?? [];
      const items = beats
        .map((b, k) => {
          const w = parseFloat(String(b.content).replace(/[^0-9.]/g, "")) || k + 1;
          return `<div class="cmp-row"><span class="cmp-label">${esc(b.label || "")}</span><div class="cmp-track"><div class="cmp-bar" data-w="${w}"></div></div></div>`;
        })
        .join("");
      const max = Math.max(...beats.map((b, k) => parseFloat(String(b.content).replace(/[^0-9.]/g, "")) || k + 1), 1);
      return {
        html: `<div id="${id}" class="layer compare">${items}</div>`,
        anim: `
  (function(){
    const rows = document.querySelectorAll('#${id} .cmp-row');
    rows.forEach(function(row, k){
      const bar = row.querySelector('.cmp-bar');
      const w = (parseFloat(bar.dataset.w) / ${max}) * 100;
      tl.from(row, {opacity:0, x:-20, duration:0.5, ease:'power2.out'}, ${at} + k*0.16);
      tl.fromTo(bar, {width:'0%'}, {width: w.toFixed(1)+'%', duration:0.9, ease:'power3.out'}, ${at} + k*0.16 + 0.1);
    });
  })();`,
      };
    }
    case "photo":
    case "clip": {
      const mediaLayer = l as unknown as { src?: string; caption?: string };
      const src = mediaLayer.src;
      if (!src) return { html: "", anim: "" };
      const caption = mediaLayer.caption ?? "";
      const isVideo = l.type === "clip" || src.endsWith(".mp4");
      const media = isVideo
        ? `<video class="ph-media" src="${esc(src)}" muted loop autoplay playsinline></video>`
        : `<img class="ph-media" src="${esc(src)}" />`;
      return {
        html: `<div id="${id}" class="layer photo-wrap">${media}<div class="ph-scrim"></div>${caption ? `<div class="ph-caption">${esc(caption)}</div>` : ""}</div>`,
        anim: `
  (function(){
    const wrap = document.querySelector('#${id}');
    const media = wrap.querySelector('.ph-media');
    tl.from(wrap, {opacity:0, scale:0.94, duration:0.9, ease:'power3.out'}, ${at});
    tl.fromTo(media, {scale:1}, {scale:1.06, duration:${durSec.toFixed(2)}, ease:'none'}, ${at});
  })();`,
      };
    }
    case "flowpath":
    case "stackboxes":
    case "terminal": {
      // Remotion 复合原语在 HyperFrames 侧退化为卡片+要点（引擎差异接受）
      const beats = l.beats ?? [];
      const labels = beats.map((b) => b.label || b.content || "").filter(Boolean);
      if (!labels.length) return { html: "", anim: "" };
      const rows = labels.slice(0, 5).map((s, k) => `<div class="tl-step"><div class="tl-dot">${k + 1}</div><div class="tl-name">${esc(String(s))}</div></div>`).join("");
      return {
        html: `<div id="${id}" class="layer timeline"><div class="tl-line"></div><div class="tl-row">${rows}</div></div>`,
        anim: `
  tl.from('#${id} .tl-line', {scaleX:0, duration:0.9, ease:'power2.inOut', transformOrigin:'left center'}, ${at});
  tl.from('#${id} .tl-step', {opacity:0, y:26, scale:0.8, duration:0.7, stagger:0.18, ease:'back.out(1.8)'}, ${at + 0.15});`,
      };
    }
    default:
      return { html: "", anim: "" };
  }
}

/** 用 buildSpec 的 scenes 生成 HyperFrames HTML */
export function composeHyperframesHtml(spec: VideoJobSpec): { html: string; totalSec: number } {
  const W = DIMENSIONS[spec.orientation].width;
  const H = DIMENSIONS[spec.orientation].height;
  let t = 0;
  const timed = spec.scenes.map((s, i) => {
    const dur = s.durationFrames / FPS;
    const item = { s, i, start: +t.toFixed(2), dur: +dur.toFixed(2) };
    t += dur;
    return item;
  });
  const TOTAL = +t.toFixed(2);

  const sceneBlocks: string[] = [];
  const animBlocks: string[] = [];
  for (const { s, i, start, dur } of timed) {
    const sb = s.storyboard;
    const bg = sb?.background;
    const bgCss = bg?.type === "gradient" && bg.to ? `linear-gradient(${bg.angle ?? 160}deg, ${bg.from}, ${bg.to})` : bg?.from ?? "#0b0f0e";

    let layersHtml = "";
    let layersAnim = "";
    if (sb?.layers?.length) {
      const rendered = sb.layers.map((l, li) => renderLayer(l, start, li, dur));
      layersHtml = rendered.map((x) => x.html).join("\n");
      layersAnim = rendered.map((x) => x.anim).join("\n");
    } else {
      // 无分镜：关键词大字兜底
      const kw = s.keyword || s.heading;
      layersHtml = `<div id="s${i}-kw" class="layer text center" style="font-size:130px;font-weight:900;color:#f4f4f5;text-align:center">${esc(kw)}</div>`;
      layersAnim = `  tl.from('#s${i}-kw', {opacity:0, y:30, duration:0.8, ease:'power3.out'}, ${start.toFixed(2)});`;
    }

    sceneBlocks.push(
      `  <div id="scene-${i}" class="scene clip" data-start="${start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="0" style="background:${bgCss}">\n${layersHtml}\n  </div>\n  <audio id="audio-${i}" class="clip" data-start="${start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="${10 + i}" src="${path.basename(s.audioFile)}"></audio>`
    );
    animBlocks.push(layersAnim);
  }

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>${esc(spec.title)} · HyperFrames</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#0b0f0e; }
  body { font-family: "Segoe UI", system-ui, sans-serif; }
  #stage { position:relative; width:${W}px; height:${H}px; overflow:hidden; }
  .scene { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:86px 150px; gap:34px; }
  .layer { position:relative; }
  .text { line-height:1.12; letter-spacing:-0.01em; }
  .text.center { align-self:center; }
  .metric { display:flex; flex-direction:column; align-items:center; gap:16px; }
  .metric-value { font-size:168px; font-weight:900; color:#10b981; line-height:1; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
  .metric-value .pre { font-size:96px; }
  .metric-value .suf { font-size:80px; margin-left:6px; }
  .metric-label { font-size:32px; color:#a1a1aa; }
  .stats { display:grid; gap:26px; width:100%; }
  .stat { background:#10161f; border:1px solid rgba(255,255,255,0.09); border-radius:26px; padding:34px 40px; }
  .stat-label { font-size:28px; color:#a1a1aa; }
  .stat-value { font-size:72px; font-weight:900; color:#f4f4f5; margin-top:8px; font-variant-numeric:tabular-nums; }
  .stat-delta { font-size:28px; color:#10b981; font-weight:700; margin-top:6px; }
  .ring-wrap { display:flex; align-items:center; gap:50px; }
  .ring-text { font-size:96px; font-weight:900; fill:#f4f4f5; font-family:sans-serif; }
  .ring-label { font-size:40px; color:#a1a1aa; max-width:520px; line-height:1.4; }
  .quote { padding:0 60px; }
  .quote-mark { position:absolute; top:-90px; left:0; font-family:Georgia,serif; font-size:210px; color:rgba(16,185,129,0.18); line-height:1; }
  .quote-text { font-size:58px; font-weight:800; color:#f4f4f5; line-height:1.5; }
  .quote-author { margin-top:30px; display:flex; align-items:center; gap:18px; font-size:30px; color:#a1a1aa; }
  .quote-rule { display:inline-block; width:86px; height:5px; background:#10b981; border-radius:3px; }
  .timeline { position:relative; padding:30px 0; }
  .tl-line { position:absolute; top:74px; left:0; width:100%; height:6px; background:linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.75)); border-radius:3px; }
  .tl-row { display:flex; justify-content:space-between; position:relative; }
  .tl-step { display:flex; flex-direction:column; align-items:center; gap:18px; }
  .tl-dot { width:74px; height:74px; border-radius:50%; background:#161d28; border:4px solid rgba(16,185,129,0.55); color:#10b981; display:flex; align-items:center; justify-content:center; font-size:30px; font-weight:800; }
  .tl-step:last-child .tl-dot { background:#10b981; border-color:#10b981; color:#022c22; box-shadow:0 0 40px rgba(16,185,129,0.55); }
  .tl-name { font-size:30px; font-weight:700; color:#a1a1aa; text-align:center; max-width:230px; }
  .card { background:#161d28; border:1px solid rgba(255,255,255,0.09); border-radius:26px; padding:36px 44px;
          background-image:linear-gradient(110deg, transparent 30%, rgba(16,185,129,0.22) 50%, transparent 70%);
          background-size:220% 100%; background-position:-140% 0; }
  .card.accent { background-color:rgba(16,185,129,0.10); border-color:rgba(16,185,129,0.45); }
  .card-title { font-size:50px; font-weight:900; color:#10b981; }
  .card-body { font-size:26px; color:#a1a1aa; margin-top:10px; }
  .compare { display:flex; flex-direction:column; gap:26px; width:100%; }
  .cmp-row { display:flex; align-items:center; gap:26px; }
  .cmp-label { font-size:34px; font-weight:700; color:#f4f4f5; width:300px; text-align:right; flex-shrink:0; }
  .cmp-track { flex:1; height:64px; background:rgba(255,255,255,0.05); border-radius:12px; overflow:hidden; }
  .cmp-bar { height:100%; width:0%; background:linear-gradient(90deg, rgba(16,185,129,0.5), #10b981); border-radius:12px; }
  .photo-wrap { position:absolute; inset:0; overflow:hidden; }
  .ph-media { width:100%; height:100%; object-fit:cover; display:block; transform-origin:center center; }
  .ph-scrim { position:absolute; left:0; right:0; bottom:0; height:40%;
              background:linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.30) 55%, transparent); }
  .ph-caption { position:absolute; left:80px; right:80px; bottom:56px; color:#f4f4f5;
                font-size:36px; font-weight:600; line-height:1.4; text-shadow:0 2px 14px rgba(0,0,0,0.65); }
</style>
</head>
<body>
<div id="stage" data-composition-id="${esc(spec.slug)}" data-start="0" data-duration="${TOTAL}" data-width="${W}" data-height="${H}">
${sceneBlocks.join("\n")}
</div>
<script>
  const tl = gsap.timeline({ paused: true });
${animBlocks.join("\n")}
  window.__timelines = window.__timelines || {};
  window.__timelines["${esc(spec.slug)}"] = tl;
</script>
</body>
</html>
`;
  return { html, totalSec: TOTAL };
}

/** 渲染 HyperFrames 版视频：spec → 项目目录 → CLI render */
export async function renderVideoHyperframes(
  slug: string,
  orientation: Orientation,
  onProgress?: (percent: number) => void,
  _mode: VideoMode = "hyperframes"
): Promise<{ path: string; scenes: Array<{ heading: string; seconds: number }> }> {
  const page = await getPage(slug);
  if (!page) throw new Error(`页面 ${slug} 不存在`);

  onProgress?.(3);
  // 复用 Remotion 管线的 buildSpec（脚本/TTS/素材全部一致）
  const spec = await buildSpec(page, orientation, "standard");
  onProgress?.(12);

  const projectDir = path.join(PUBLIC_ASSETS_DIR, "videos", `${slug}-hf`);
  await fs.mkdir(projectDir, { recursive: true });

  // 音频已在 buildSpec 生成（资产目录内），复制到项目目录
  const assetDir = path.join(PUBLIC_ASSETS_DIR, "videos", `${slug}-assets`, orientation);
  for (const f of await fs.readdir(assetDir)) {
    if (f.endsWith(".mp3")) await fs.copyFile(path.join(assetDir, f), path.join(projectDir, f));
  }

  const { html, totalSec } = composeHyperframesHtml(spec);
  await fs.writeFile(path.join(projectDir, "index.html"), html, "utf8");
  onProgress?.(20);

  // lint（失败不阻塞，只记录）
  try {
    await runHf(["lint", "."], projectDir, 120_000);
  } catch (err) {
    console.warn(`[hf] lint 跳过: ${err instanceof Error ? err.message : err}`);
  }
  onProgress?.(25);

  const outName = `${slug}-${orientation}-hf.mp4`;
  const outPath = path.join(VIDEO_DIR, outName);
  const timeoutMs = 20 * 60_000;
  const bin = hfBin();
  console.warn(`[hf] 开始渲染: cwd=${projectDir} bin=${bin} out=${outPath}`);
  const started = Date.now();
  let lastPct = 25;
  const finalArgs = bin === "npx" ? ["hyperframes", "render", ".", "--output", outPath] : ["render", ".", "--output", outPath];
  const child = spawn(bin, finalArgs, {
    cwd: projectDir,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  let stderrTail = "";
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hyperframes render 超时（${timeoutMs / 60000} 分钟）`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      const text = String(d);
      // 解析 @hf-progress 事件回填进度（capture/encode 阶段占 25→95%）
      const m = text.match(/@hf-progress \{"code":"(\w+)","done":(\d+),"total":(\d+),"pct":(\d+)\}/);
      if (m) {
        const pct = 25 + (Number(m[4]) / 100) * 70;
        if (pct - lastPct >= 3) {
          lastPct = pct;
          onProgress?.(Math.round(pct));
        }
      }
    });
    child.stderr?.on("data", (d) => {
      stderrTail = (stderrTail + String(d)).slice(-2000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`hyperframes render 退出码 ${code}: ${stderrTail.slice(-600)}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await done;
  onProgress?.(96);

  const stat = await fs.stat(outPath);
  if (!stat.isFile() || stat.size === 0) throw new Error("HyperFrames 渲染完成但输出缺失");
  onProgress?.(99);

  const scenesSummary = spec.scenes.map((s) => ({
    heading: s.heading,
    seconds: Math.round(s.durationFrames / FPS),
  }));
  return { path: outPath, scenes: scenesSummary };
}
