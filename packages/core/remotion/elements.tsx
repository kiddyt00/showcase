/**
 * v4 动效图解元素库：FlowPath / StackBoxes / TerminalSim / Counter / CompareBars
 * 统一驱动接口：每个元素接收 { beats, timeline, durationFrames, fps, frame }，
 * beats[i].atWord 命中 timeline 词时间（帧）时触发该节拍动画（复用 components 的 beatToFrames）。
 * 全部代码绘制、无外部素材；timeline 为空时按 beats 均分降级。
 */
import { Easing, interpolate } from "remotion";
import { TerminalSim, TemplateProps, beatToFrames } from "./components";

export { TerminalSim };
export type { TemplateProps };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const T = {
  bg: "#0b0f0e",
  fg: "#f4f4f5",
  accent: "#10b981",
  sub: "#a1a1aa",
  muted: "#52525b",
};

/** 从 beats 提取节拍标签序列（不足 count 时补默认名） */
function beatLabels(beats: TemplateProps["beats"], count: number, fallbackPrefix: string): string[] {
  return Array.from({ length: count }, (_, i) => beats[i]?.label || `${fallbackPrefix} ${i + 1}`);
}

/* ---------- 1. FlowPath 流程路径（伪 3D 纵深） ---------- */

const FP_W = 1560;
const FP_H = 760;

export const FlowPath: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const count = Math.max(3, Math.min(5, beats.length || 3));
  const labels = beatLabels(beats, count, "节点");
  const beatFrames = beatToFrames(beats, timeline, durationFrames, fps, count);

  // 透视路径：自底（近、大）向顶（远、小）。节点沿路径分布，横向轻微交错。
  const nodes = Array.from({ length: count }, (_, i) => {
    const p = count === 1 ? 0.5 : i / (count - 1); // 0=底部近端, 1=顶部远端
    const y = FP_H - 90 - p * (FP_H - 200);
    const zigzag = i % 2 === 0 ? -1 : 1;
    const x = FP_W / 2 + zigzag * (90 + p * 130);
    const scale = 1.5 - p * 0.85; // 近大远小
    return { x, y, p, scale };
  });

  // 路径主线条（穿过所有节点，透视梯形描边）
  const pathD = nodes
    .map((n, i) => `${i === 0 ? "M" : "L"} ${n.x} ${n.y}`)
    .join(" ");

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${FP_W} ${FP_H}`} style={{ width: "100%", maxHeight: "100%" }}>
        <defs>
          <linearGradient id="fp-road" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(16,185,129,0.35)" />
            <stop offset="100%" stopColor="rgba(16,185,129,0.05)" />
          </linearGradient>
          <filter id="fp-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="14" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 透视路面：底部宽、顶部窄的梯形 */}
        <polygon
          points={`${FP_W / 2 - 330},${FP_H - 60} ${FP_W / 2 + 330},${FP_H - 60} ${FP_W / 2 + 90},60 ${FP_W / 2 - 90},60`}
          fill="url(#fp-road)"
          stroke="rgba(16,185,129,0.25)"
          strokeWidth={3}
        />

        {/* 相邻节点连线：后一节点命中时生长（strokeDasharray 生长动画） */}
        {nodes.slice(0, -1).map((n, i) => {
          const m = nodes[i + 1];
          const at = beatFrames[i + 1] ?? durationFrames;
          const grow = interpolate(frame, [at, at + 14], [0, 1], clamp);
          const dx = m.x - n.x;
          const dy = m.y - n.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          return (
            <line
              key={`e${i}`}
              x1={n.x}
              y1={n.y}
              x2={m.x}
              y2={m.y}
              stroke={T.accent}
              strokeWidth={10 - m.p * 5}
              strokeLinecap="round"
              strokeDasharray={len}
              strokeDashoffset={len * (1 - grow)}
              opacity={0.85}
            />
          );
        })}

        {/* 全部点亮后：光点沿路径匀速循环 */}
        {(() => {
          const lastAt = beatFrames[count - 1] ?? durationFrames;
          if (frame < lastAt + 14) return null;
          // 折线总长与均匀速参数 t → 坐标
          const segs = nodes.slice(0, -1).map((n, i) => {
            const m = nodes[i + 1];
            return Math.hypot(m.x - n.x, m.y - n.y);
          });
          const total = segs.reduce((a, b) => a + b, 0);
          const t = (((frame - lastAt - 14) / 90) % 1) * total;
          let acc = 0;
          for (let i = 0; i < segs.length; i++) {
            if (t <= acc + segs[i]) {
              const k = (t - acc) / segs[i];
              const x = nodes[i].x + (nodes[i + 1].x - nodes[i].x) * k;
              const y = nodes[i].y + (nodes[i + 1].y - nodes[i].y) * k;
              return <circle key="dot" cx={x} cy={y} r={16} fill={T.accent} filter="url(#fp-glow)" />;
            }
            acc += segs[i];
          }
          return null;
        })()}

        {/* 节点：伪 3D 圆角方块 + 顶面高光；命中时 Easing.back 弹入落下 + 发光点亮 */}
        {nodes.map((n, i) => {
          const at = beatFrames[i] ?? durationFrames;
          const appear = frame >= at;
          // 弹入落下：从上方 -80px 落到位，back easing 回弹
          const drop = interpolate(frame, [at, at + 20], [-80, 0], {
            ...clamp,
            easing: Easing.out(Easing.back(1.4)),
          });
          const fade = interpolate(frame, [at, at + 8], [0, 1], clamp);
          const glow = interpolate(frame, [at, at + 16], [0, 1], clamp);
          const size = 190 * n.scale;
          const depth = size * 0.22; // 伪 3D 侧深
          const sx = n.x - size / 2;
          const sy = n.y - size / 2 - depth / 2;
          return (
            <g key={`n${i}`} opacity={fade} transform={`translate(0 ${drop})`}>
              {/* 侧面（深色） */}
              <rect x={sx + depth} y={sy + depth} width={size} height={size} rx={size * 0.14} fill="#022c22" />
              {/* 主体 */}
              <rect
                x={sx}
                y={sy}
                width={size}
                height={size}
                rx={size * 0.14}
                fill={appear ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.06)"}
                stroke={appear ? T.accent : "#3f3f46"}
                strokeWidth={5}
                filter={appear && glow > 0.5 ? "url(#fp-glow)" : undefined}
              />
              {/* 顶面高光条（伪 3D 顶面） */}
              <rect
                x={sx + size * 0.1}
                y={sy + size * 0.78}
                width={size * 0.8}
                height={size * 0.12}
                rx={size * 0.07}
                fill={appear ? "rgba(62,207,160,0.55)" : "rgba(255,255,255,0.08)"}
              />
              <text
                x={n.x}
                y={n.y + size * 0.06}
                textAnchor="middle"
                fontFamily="sans-serif"
                fontWeight={800}
                fontSize={Math.min(46, size * 0.24)}
                fill={appear ? "#ffffff" : T.muted}
              >
                {labels[i].slice(0, 7)}
              </text>
              <text
                x={n.x}
                y={n.y - size * 0.28}
                textAnchor="middle"
                fontFamily="monospace"
                fontWeight={800}
                fontSize={Math.min(34, size * 0.17)}
                fill={appear ? T.accent : T.muted}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ---------- 2. StackBoxes 盒子堆叠（从上方落下 + 挤压回弹） ---------- */

const BOX_COLORS = ["#064e3b", "#065f46", "#047857", "#059669"];
const BOX_TOPS = ["#0b6b50", "#0d7d5c", "#109470", "#17ad84"];

export const StackBoxes: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const count = Math.max(3, Math.min(4, beats.length || 3));
  const labels = beatLabels(beats, count, "层");
  const beatFrames = beatToFrames(beats, timeline, durationFrames, fps, count);

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden", paddingBottom: 30 }}>
      {/* 自下而上堆叠：DOM 倒排，第 i 层（底部）先落 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        {Array.from({ length: count }, (_, i) => i).reverse().map((i) => {
          const at = beatFrames[i] ?? durationFrames;
          // 从上方 -320px 落下，back easing 轻微过冲
          const drop = interpolate(frame, [at, at + 20], [-320, 0], {
            ...clamp,
            easing: Easing.out(Easing.back(1.2)),
          });
          const fade = interpolate(frame, [at, at + 6], [0, 1], clamp);
          // 落地挤压回弹：scaleY 0.72 → 1.08 → 1
          const squash = interpolate(frame, [at + 16, at + 22, at + 32], [1, 0.72, 1], {
            ...clamp,
            easing: Easing.out(Easing.ease),
          });
          const pop = interpolate(frame, [at + 22, at + 32], [1, 1.08], { ...clamp, easing: Easing.out(Easing.ease) });
          const w = 760;
          const h = 130;
          return (
            <div
              key={i}
              style={{
                width: w,
                height: h,
                position: "relative",
                opacity: fade,
                transform: `translateY(${drop}px) scale(${pop}, ${squash})`,
                transformOrigin: "bottom center",
                flexShrink: 0,
              }}
            >
              {/* 伪 3D 顶面 */}
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  right: -14,
                  top: -16,
                  height: 16,
                  backgroundColor: BOX_TOPS[i % BOX_TOPS.length],
                  transform: "skewX(-45deg)",
                }}
              />
              {/* 伪 3D 侧面 */}
              <div
                style={{
                  position: "absolute",
                  top: -16,
                  bottom: 0,
                  right: -16,
                  width: 16,
                  backgroundColor: "#022c22",
                  transform: "skewY(-45deg)",
                  transformOrigin: "top left",
                }}
              />
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: 14,
                  backgroundColor: BOX_COLORS[i % BOX_COLORS.length],
                  border: "2px solid rgba(255,255,255,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.4)",
                }}
              >
                <span style={{ fontFamily: "sans-serif", fontSize: 46, fontWeight: 700, color: "#ffffff" }}>
                  {i === count - 1 ? `⭐ ${labels[i]}` : labels[i]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------- 4. Counter 大数字滚动 ---------- */

/** 从 beats labels 里解析数字（如 "187k Star" → 187000 / "1.2万" → 12000），找不到返回 null */
function parseCounterBeats(beats: TemplateProps["beats"]): { value: number; suffix: string; text: string } | null {
  for (let i = beats.length - 1; i >= 0; i--) {
    const label = (beats[i]?.label ?? "").trim();
    const m = label.match(/^([\d,.]+)\s*(k|m|w|万|亿)?\s*(.*)$/i);
    if (!m) continue;
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const mult = unit === "k" ? 1e3 : unit === "m" ? 1e6 : unit === "w" || unit === "万" ? 1e4 : unit === "亿" ? 1e8 : 1;
    return { value: num * mult, suffix: m[3] ?? "", text: label };
  }
  return null;
}

export const Counter: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const parsed = parseCounterBeats(beats);
  // 无数字 label：整段时长滚动 0 → 目标；数字字号 clamp 120~240px
  const fontSize = Math.max(120, Math.min(240, parsed ? 240 - Math.max(0, String(Math.round(parsed.value)).length - 4) * 24 : 200));
  const value = parsed
    ? Math.round(interpolate(frame, [4, Math.max(30, durationFrames - 10)], [0, parsed.value], { ...clamp, easing: Easing.out(Easing.ease) }))
    : 0;
  const label = parsed?.suffix || beats[0]?.label || "";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        overflow: "hidden",
      }}
    >
      {parsed ? (
        <div
          style={{
            fontFamily: "monospace",
            fontSize,
            fontWeight: 900,
            color: T.accent,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            textShadow: "0 0 60px rgba(16,185,129,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {value.toLocaleString("en-US")}
        </div>
      ) : (
        <div style={{ fontFamily: "monospace", fontSize: 160, fontWeight: 900, color: T.accent }}>
          {beats[beats.length - 1]?.label || "—"}
        </div>
      )}
      {label ? (
        <div style={{ fontFamily: "sans-serif", fontSize: 44, color: T.sub, letterSpacing: 4 }}>{label}</div>
      ) : null}
    </div>
  );
};

/* ---------- 5. CompareBars 对比条形图 ---------- */

export const CompareBars: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const count = Math.max(2, Math.min(4, beats.length || 2));
  const beatFrames = beatToFrames(beats, timeline, durationFrames, fps, count);
  // 权重：beats[i].content 为数字则用之，否则均分（后到的条更长，形成阶梯）
  const weights = Array.from({ length: count }, (_, i) => {
    const n = parseFloat(beats[i]?.content ?? "");
    return Number.isFinite(n) && n > 0 ? n : i + 1;
  });
  const maxW = Math.max(...weights);
  const barMaxW = 1100;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 44,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const at = beatFrames[i] ?? durationFrames;
        const grow = interpolate(frame, [at, at + 22], [0, 1], {
          ...clamp,
          easing: Easing.out(Easing.cubic),
        });
        const w = (weights[i] / maxW) * barMaxW;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 28, width: barMaxW + 360 }}>
            <span
              style={{
                fontFamily: "sans-serif",
                fontSize: 40,
                fontWeight: 700,
                color: T.fg,
                width: 330,
                textAlign: "right",
                opacity: interpolate(frame, [at, at + 8], [0, 1], clamp),
              }}
            >
              {beats[i]?.label || `项 ${i + 1}`}
            </span>
            <div style={{ position: "relative", height: 84, width: barMaxW, flexShrink: 0 }}>
              <div
                style={{
                  width: w * grow,
                  height: "100%",
                  borderRadius: 14,
                  backgroundColor: i === count - 1 ? T.accent : "rgba(16,185,129,0.45)",
                  boxShadow: i === count - 1 ? "0 0 40px rgba(16,185,129,0.35)" : "none",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
