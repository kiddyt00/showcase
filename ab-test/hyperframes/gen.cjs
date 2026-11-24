/**
 * A/B 对比用：读 storyboard-full.json，生成 HyperFrames 的 HTML 组合。
 * 同样的分镜设计、同样的视觉语言，改用 HTML + GSAP 实现。
 */
const fs = require("fs");
const path = require("path");

const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, "storyboard-full.json"), "utf8"));
const W = 1920;
const H = 1080;

// 计算每场景起始时间
let t = 0;
const timed = scenes.map((s, i) => {
  const item = { ...s, i, start: +t.toFixed(2) };
  t += s.duration;
  return item;
});
const TOTAL = +t.toFixed(2);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SIZE = { giant: 150, large: 96, medium: 56, small: 34 };
const COLOR = { fg: "#f4f4f5", accent: "#10b981", sub: "#a1a1aa" };

/** 每个原语渲染成 HTML + 返回对应的 GSAP 动画代码片段 */
function renderLayer(l, i, sceneStart) {
  const d = (l.enter && l.enter.delaySec) || 0;
  const at = sceneStart + d;
  const id = `s${sceneStart}-l${i}`.replace(/\./g, "_");

  if (l.type === "text") {
    const size = SIZE[l.size] || 96;
    const color = COLOR[l.color] || COLOR.fg;
    const align = l.align === "center" ? "center" : "left";
    const fx = (l.enter && l.enter.fx) || "fade-up";
    let anim;
    if (fx === "scramble") {
      anim = `
  // scramble: 逐字解码
  (function(){
    const el = document.querySelector('#${id}');
    const final = el.dataset.text;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&';
    function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; } }
    const o = {p:0};
    tl.to(o, {p:1, duration:1.4, ease:'none', onUpdate:function(){
      const n = Math.floor(o.p * final.length * 1.6);
      let out = '';
      const rnd = mulberry32(Math.floor(o.p * 1000) + 7);
      for (let k=0;k<final.length;k++){
        out += (k < n) ? final[k] : (final[k]===' '?' ':chars[Math.floor(rnd()*chars.length)]);
      }
      el.textContent = out;
    }, onComplete:function(){ el.textContent = final; }}, ${at});
  })();`;
    } else if (fx === "spring") {
      anim = `  tl.from('#${id}', {opacity:0, scale:0.86, y:28, duration:0.9, ease:'back.out(2.2)'}, ${at});`;
    } else {
      anim = `  tl.from('#${id}', {opacity:0, y:26, duration:0.7, ease:'power3.out'}, ${at});`;
    }
    return {
      html: `<div id="${id}" class="layer text${align === "center" ? " center" : ""}" data-text="${esc(l.content)}" style="font-size:${size}px;color:${color};text-align:${align};${l.size === "giant" ? "font-weight:900" : "font-weight:800"}">${esc(l.content)}</div>`,
      anim,
    };
  }

  if (l.type === "metric") {
    const num = parseFloat(String(l.value).replace(/[^0-9.]/g, "")) || 0;
    const prefix = String(l.value).match(/^[^0-9]*/)[0] || "";
    const suffix = String(l.value).replace(/^[^0-9]*/, "").replace(/[\d.,]/g, "") || "";
    const scaled = /[亿万美元]/.test(l.value);
    return {
      html: `<div id="${id}" class="layer metric">
        <div class="metric-value"><span class="pre">${esc(prefix)}</span><span class="num" data-to="${num}">0</span><span class="suf">${esc(suffix)}</span></div>
        <div class="metric-label">${esc(l.label)}</div>
      </div>`,
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

  if (l.type === "stats") {
    const items = l.stats
      .map(
        (s, k) =>
          `<div class="stat" data-k="${k}"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div>${s.delta ? `<div class="stat-delta">${esc(s.delta)}</div>` : ""}</div>`
      )
      .join("");
    const cols = l.stats.length <= 2 ? l.stats.length : 2;
    return {
      html: `<div id="${id}" class="layer stats" style="grid-template-columns:repeat(${cols},1fr)">${items}</div>`,
      anim: `  tl.from('#${id} .stat', {opacity:0, y:34, duration:0.75, stagger:0.16, ease:'power3.out'}, ${at});`,
    };
  }

  if (l.type === "ring") {
    const r = 200;
    const circ = 2 * Math.PI * r;
    const ratio = Math.min(1, Math.max(0, l.ratio));
    return {
      html: `<div id="${id}" class="layer ring-wrap">
        <svg width="520" height="520" viewBox="0 0 520 520" class="ring">
          <circle cx="260" cy="260" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="26"/>
          <circle class="ring-fg" cx="260" cy="260" r="${r}" fill="none" stroke="#10b981" stroke-width="26"
            stroke-linecap="round" transform="rotate(-90 260 260)"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${circ.toFixed(1)}"/>
          <text x="260" y="272" text-anchor="middle" class="ring-text" data-final="${esc(l.centerText || Math.round(ratio * 100) + "%")}">0%</text>
        </svg>
        <div class="ring-label">${esc(l.label)}</div>
      </div>`,
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
      txt.textContent = finalTxt.replace(/%/, pct + '%').replace(/[\\d.]+/, pct);
    }}, ${at + 0.2});
    tl.from(wrap.querySelector('.ring-label'), {opacity:0, y:16, duration:0.6, ease:'power2.out'}, ${at + 0.9});
  })();`,
    };
  }

  if (l.type === "quote") {
    return {
      html: `<div id="${id}" class="layer quote">
        <div class="quote-mark">“</div>
        <div class="quote-text">${esc(l.quote)}</div>
        ${l.author ? `<div class="quote-author"><span class="quote-rule"></span><span>${esc(l.author)}</span></div>` : ""}
      </div>`,
      anim: `
  tl.from('#${id}', {opacity:0, y:40, duration:0.9, ease:'power3.out'}, ${at});
  tl.from('#${id} .quote-mark', {opacity:0, scale:0.5, duration:0.8, ease:'back.out(1.8)'}, ${at});
  tl.from('#${id} .quote-choice, #${id} .quote-author', {opacity:0, y:14, duration:0.6, ease:'power2.out'}, ${at + 0.35});
  tl.from('#${id} .quote-rule', {scaleX:0, duration:0.7, ease:'power2.inOut', transformOrigin:'left center'}, ${at + 0.5});`,
    };
  }

  if (l.type === "timeline") {
    const steps = l.steps
      .map(
        (s, k) =>
          `<div class="tl-step" data-k="${k}"><div class="tl-dot">${k + 1}</div><div class="tl-name">${esc(s)}</div></div>`
      )
      .join("");
    return {
      html: `<div id="${id}" class="layer timeline"><div class="tl-line"></div><div class="tl-row">${steps}</div></div>`,
      anim: `
  tl.from('#${id} .tl-line', {scaleX:0, duration:0.9, ease:'power2.inOut', transformOrigin:'left center'}, ${at});
  tl.from('#${id} .tl-step', {opacity:0, y:26, scale:0.8, duration:0.7, stagger:0.18, ease:'back.out(1.8)'}, ${at + 0.15});`,
    };
  }

  if (l.type === "card") {
    return {
      html: `<div id="${id}" class="layer card${l.accent ? " accent" : ""}">
        ${l.title ? `<div class="card-title">${esc(l.title)}</div>` : ""}
        ${l.body ? `<div class="card-body">${esc(l.body)}</div>` : ""}
      </div>`,
      anim: `
  tl.from('#${id}', {opacity:0, y:24, duration:0.7, ease:'power3.out'}, ${at});
  // border-beam: 一圈描边光扫过（用 conic-gradient 遮罩旋转）
  tl.fromTo('#${id}', {backgroundPosition:'-140% 0'}, {backgroundPosition:'240% 0', duration:1.8, ease:'power2.inOut'}, ${at});`,
    };
  }

  if (l.type === "compare") {
    const beats = l.beats || [];
    const items = beats
      .map((b, k) => {
        const w = parseFloat(String(b.content).replace(/[^0-9.]/g, "")) || k + 1;
        return `<div class="cmp-row" data-k="${k}"><span class="cmp-label">${esc(b.label || "")}</span><div class="cmp-track"><div class="cmp-bar" data-w="${w}"></div></div></div>`;
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

  return { html: "", anim: "" };
}

// 组装
const sceneBlocks = [];
const animBlocks = [];
for (const s of timed) {
  const bg = s.storyboard.background || {};
  const bgCss =
    bg.type === "gradient" && bg.to
      ? `linear-gradient(${bg.angle || 160}deg, ${bg.from}, ${bg.to})`
      : bg.from || "#0b0f0e";

  const layers = s.storyboard.layers.map((l, i) => renderLayer(l, i, s.start));
  sceneBlocks.push(
    `  <div id="scene-${s.i}" class="scene clip" data-start="${s.start}" data-duration="${s.duration}" data-track-index="0" style="background:${bgCss}">
${layers.map((x) => x.html).join("\n")}
  </div>
  <audio id="audio-${s.i}" class="clip" data-start="${s.start}" data-duration="${s.duration}" data-track-index="${10 + s.i}" src="${s.audio}"></audio>`
  );
  animBlocks.push(layers.map((x) => x.anim).join("\n"));
}

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>NVIDIA 财报 · HyperFrames 版</title>
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
  .tl-dot { width:74px; height:74px; border-radius:50%; background:#161d28; border:4px solid rgba(16,185,129,0.55); color:#10b981;
           display:flex; align-items:center; justify-content:center; font-size:30px; font-weight:800; }
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
</style>
</head>
<body>
<div id="stage" data-composition-id="nvidia" data-start="0" data-duration="${TOTAL}" data-width="${W}" data-height="${H}">
${sceneBlocks.join("\n")}
</div>
<script>
  gsap.registerPlugin();
  const tl = gsap.timeline({ paused: true });
${animBlocks.join("\n")}
  window.__timelines = window.__timelines || {};
  window.__timelines["nvidia"] = tl;
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, "index.html"), html);
console.log(`生成 index.html: ${(html.length / 1024).toFixed(1)} KB, 总时长 ${TOTAL}s, ${timed.length} 场景`);