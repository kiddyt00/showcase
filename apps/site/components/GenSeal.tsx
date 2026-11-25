"use client";

/**
 * 印次章 GenSeal（r1-open 构想四）：圆形"油印"印章，标记本页的生成印次
 * - 双层圆环（外环虚线 + 边缘不规则的 path 圆），轻微旋转 -4deg，油印歪斜感
 * - 中心两行：第 N 版（N 从 page.generator 尾部版本号提取，缺省 1）+ hash 前 6 位
 * - hash 前 6 位由 PageView（服务端组件）用 node:crypto 算好传入：
 *   crypto.createHash('sha256').update(slug + createdAt).digest().hexSlice(0, 6)
 * - 油印质感：fill 用 accent 色 85% 透明度 + feTurbulence 噪点滤镜
 * - 交互：hover 提示"生成指纹 · 点击复制"；点击复制 `ShowCase Nº{N} · sha:{hash}`，
 *   复制成功后短暂显示"已复制"；纯静态图形，reduced-motion 无影响
 */
import { useCallback, useRef, useState } from "react";

/** 从 generator 字符串提取印次版本号：如 "github@1" → 1；无 @N 后缀时默认 1 */
function extractVersion(generator: string): number {
  const m = /@(\d+)$/.exec(generator.trim());
  const n = m ? Number.parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** 中心圆周路径：半径 r 的 12 段贝塞尔近似，每段半径随机抖动 ±irregular → 边缘不规则（非完美圆） */
function roughCirclePath(cx: number, cy: number, r: number, irregular: number, seed: number): string {
  const rand = (i: number) => {
    // 确定性伪随机（同一 seed 每次渲染一致，避免 SSR/CSR 水合不一致）
    const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const pts: Array<[number, number]> = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = r + (rand(i) - 0.5) * 2 * irregular;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  // Catmull-Rom → 三次贝塞尔：平滑闭合且过所有抖动点
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + " Z";
}

export default function GenSeal({
  generator,
  hash,
  className = "",
}: {
  /** page.generator（如 "github@1"），用于提取印次 N */
  generator: string;
  /** sha256(slug + createdAt) 前 6 位 hex —— PageView 服务端用 node:crypto 算好传入 */
  hash: string;
  className?: string;
}) {
  const version = extractVersion(generator);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyFingerprint = useCallback(() => {
    const text = `ShowCase Nº${version} · sha:${hash}`;
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {
        // 剪贴板 API 被拒（非安全上下文等）→ 退回 execCommand 方案
        legacyCopy(text);
        done();
      });
    } else {
      legacyCopy(text);
      done();
    }
  }, [version, hash]);

  return (
    <button
      type="button"
      onClick={copyFingerprint}
      title="生成指纹 · 点击复制"
      aria-label={`生成指纹：第 ${version} 版，校验码 ${hash}。点击复制`}
      className={`group relative inline-flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      {/* 印章 SVG：轻微歪斜 -4deg；仅几何属性，无动画（reduced-motion 无影响） */}
      <svg
        width="52"
        height="52"
        viewBox="0 0 52 52"
        role="img"
        aria-hidden="true"
        style={{ transform: "rotate(-4deg)" }}
      >
        <defs>
          {/* 油印噪点：feTurbulence 置换边缘 + 半透明叠加，模拟印泥不匀 */}
          <filter id="genseal-roughen" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.6"
              numOctaves="2"
              seed="7"
              result="noise"
            />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" />
          </filter>
        </defs>
        <g filter="url(#genseal-roughen)">
          {/* 内环实线 + 外环虚线：双层圆环（边缘不规则 path，非完美圆） */}
          <path
            d={roughCirclePath(26, 26, 24, 0.7, 11)}
            fill="none"
            stroke="#b3452e"
            strokeOpacity="0.85"
            strokeWidth="1.1"
            strokeDasharray="3 2.4"
          />
          <path
            d={roughCirclePath(26, 26, 19.5, 0.5, 23)}
            fill="none"
            stroke="#b3452e"
            strokeOpacity="0.85"
            strokeWidth="1.6"
          />
          {/* 中心文字：第 N 版 + hash 前 6 位（油印 accent 色 85% 透明度） */}
          <text
            x="26"
            y="23.5"
            textAnchor="middle"
            fontSize="8.5"
            fontWeight="700"
            fill="#b3452e"
            fillOpacity="0.85"
            letterSpacing="0.5"
          >
            第 {version} 版
          </text>
          <text
            x="26"
            y="34"
            textAnchor="middle"
            fontSize="8"
            fill="#b3452e"
            fillOpacity="0.85"
            letterSpacing="1.2"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {hash}
          </text>
        </g>
      </svg>
      {/* 点击复制成功提示（短暂浮现） */}
      <span
        aria-live="polite"
        className={`pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-[11px] text-[var(--fg)] shadow-sm transition-opacity duration-150 ${
          copied ? "opacity-100" : "opacity-0"
        }`}
      >
        已复制
      </span>
    </button>
  );
}

/** execCommand 兜底复制（非安全上下文 / 旧浏览器） */
function legacyCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* 复制失败静默：提示仍会浮现一次，可接受 */
  }
  document.body.removeChild(ta);
}
