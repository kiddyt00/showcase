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

const C = { panel2: "#161d28" };

/** 从 beats 提取节拍标签序列（不足 count 时补默认名） */
function beatLabels(beats: TemplateProps["beats"], count: number, fallbackPrefix: string): string[] {
  return Array.from({ length: count }, (_, i) => beats[i]?.label || `${fallbackPrefix} ${i + 1}`);
}

/* ---------- 0. Web 动效移植：Spring/Beam/Scramble/Spotlight（帧驱动版） ---------- */

/** 弹簧缓动（临界阻尼近似，无外部依赖）：给 Remotion spring 的轻量替代 */
function springEase(t: number, overshoot = 1.2): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // 阻尼正弦：一次轻微过冲后稳定
  return 1 - Math.exp(-6 * t) * Math.cos(overshoot * Math.PI * t) * (1 - t * 0.3);
}

/** SpringCounter：数字从 0 弹簧滚到目标值（带过冲回落），替代匀速 count 的升级版 */
export const SpringCounter: React.FC<{
  value: number;
  frame: number;
  durationFrames?: number;
  label?: string;
  suffix?: string;
  fontSize?: number;
}> = ({ value, frame, durationFrames = 60, label, suffix, fontSize = 150 }) => {
  const p = Math.min(1, frame / durationFrames);
  const eased = springEase(p);
  const current = Math.round(value * eased);
  const scale = 1 + (1 - eased) * 0.06; // 起步略大，落定时回正
  return (
    <div style={{ textAlign: "center", width: "100%" }}>
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize,
          fontWeight: 900,
          color: T.accent,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          transform: `scale(${scale.toFixed(3)})`,
          transformOrigin: "center bottom",
        }}
      >
        {current.toLocaleString("en-US")}
        {suffix ? <span style={{ fontSize: fontSize * 0.4, marginLeft: 8 }}>{suffix}</span> : null}
      </div>
      {label ? (
        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 30,
            color: T.sub,
            marginTop: 18,
            opacity: interpolate(frame, [10, 25], [0, 1], clamp),
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};

/** BorderBeam：细光束沿卡片边框循环（帧驱动 conic-gradient，SVG mask 实现） */
export const BorderBeam: React.FC<{
  width: number;
  height: number;
  frame: number;
  radius?: number;
  periodFrames?: number;
  color?: string;
  children?: React.ReactNode;
}> = ({ width, height, frame, radius = 28, periodFrames = 150, color = "rgba(16,185,129,0.85)", children }) => {
  const id = `beam-${width}-${height}`;
  const angle = ((frame % periodFrames) / periodFrames) * 360;
  return (
    <div style={{ position: "relative", width, height }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          border: "2px solid rgba(255,255,255,0.10)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
      {/* 光束：旋转的 conic 渐变被 mask 只露边缘 */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <defs>
          <mask id={id}>
            <rect x="4" y="4" width={width - 8} height={height - 8} rx={radius - 4} fill="none" stroke="#fff" strokeWidth="3" />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx={radius}
          fill="none"
          stroke="url(#beamgrad)"
          strokeWidth="6"
          mask={`url(#${id})`}
          style={{ transformOrigin: "center" }}
        />
        <defs>
          <linearGradient id="beamgrad" gradientTransform={`rotate(${angle})`}>
            <stop offset="0%" stopColor="transparent" />
            <stop offset="80%" stopColor="transparent" />
            <stop offset="92%" stopColor={color} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&";

/** TextScramble：字符"解码"式渐显——每个字符从随机字符池滚动定格，左→右波浪锁定 */
export const TextScramble: React.FC<{
  text: string;
  frame: number;
  /** 每字符锁定间隔（帧） */
  stagger?: number;
  fontSize?: number;
  color?: string;
}> = ({ text, frame, stagger = 2.5, fontSize = 96, color = T.fg }) => {
  const chars = text.split("");
  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize,
        fontWeight: 900,
        color,
        whiteSpace: "pre",
        letterSpacing: 2,
      }}
    >
      {chars.map((ch, i) => {
        const lockAt = i * stagger + 8;
        const locked = frame >= lockAt;
        // 未锁定时每 4 帧换一个随机字符
        const rnd = SCRAMBLE_CHARS[Math.floor(frame / 4 + i * 7) % SCRAMBLE_CHARS.length];
        return (
          <span key={i} style={{ opacity: frame >= i * stagger ? 1 : 0 }}>
            {locked ? ch : /[\s]/.test(ch) ? ch : rnd}
          </span>
        );
      })}
    </div>
  );
};

/** SpotlightCard：一道柔光从卡片左侧扫到右侧（进入时单次扫过，非循环） */
export const SpotlightCard: React.FC<{
  width: number;
  height: number;
  frame: number;
  enterFrames?: number;
  title: string;
  note?: string;
}> = ({ width, height, frame, enterFrames = 45, title, note }) => {
  const sweep = interpolate(frame, [0, enterFrames], [-0.4, 1.4], clamp); // 光心位置 0~1，超出后移出画面
  const lightX = width * sweep;
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 28,
        backgroundColor: "#10161f",
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 56px",
      }}
    >
      {/* 扫过的聚光层 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(420px circle at ${lightX}px 50%, rgba(16,185,129,0.14), transparent 65%)`,
          opacity: frame < enterFrames + 15 ? 1 : interpolate(frame, [enterFrames + 15, enterFrames + 45], [1, 0.35], clamp),
        }}
      />
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize: 64,
          fontWeight: 900,
          color: T.fg,
          opacity: interpolate(frame, [12, 30], [0, 1], clamp),
          transform: `translateY(${interpolate(frame, [12, 30], [16, 0], clamp)}px)`,
        }}
      >
        {title}
      </div>
      {note ? (
        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 26,
            color: T.sub,
            marginTop: 14,
            opacity: interpolate(frame, [24, 42], [0, 1], clamp),
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};

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

/* ---------- 6. ProgressRing 进度环（占比/完成度） ---------- */

export const ProgressRing: React.FC<{
  /** 0~1 */
  ratio: number;
  frame: number;
  label: string;
  size?: number;
  color?: string;
  centerText?: string;
}> = ({ ratio, frame, label, size = 460, color = T.accent, centerText }) => {
  const r = size * 0.42;
  const circ = 2 * Math.PI * r;
  const p = interpolate(frame, [5, 55], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const val = Math.min(1, Math.max(0, ratio));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={size * 0.055} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={size * 0.055}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - val * p)}
          style={{ filter: "drop-shadow(0 0 18px rgba(16,185,129,0.45))" }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
          fontFamily="sans-serif"
          fontWeight={900}
          fontSize={size * 0.2}
          fill={T.fg}
        >
          {centerText ?? `${Math.round(val * 100)}%`}
        </text>
      </svg>
      <div style={{ fontFamily: "sans-serif", fontSize: 42, color: T.sub, maxWidth: 520, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
};

/* ---------- 7. StepTimeline 横向步骤时间轴（顺序/阶段） ---------- */

export const StepTimeline: React.FC<{
  steps: string[];
  frame: number;
  durationFrames?: number;
  stagger?: number;
}> = ({ steps, frame, stagger = 10 }) => {
  const shown = steps.slice(0, 5);
  return (
    <div style={{ position: "relative", width: "100%", padding: "40px 20px" }}>
      {/* 贯穿线：从左向右生长 */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          height: 6,
          width: `${interpolate(frame, [0, 20], [0, 100], clamp)}%`,
          background: "linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.7))",
          borderRadius: 3,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {shown.map((s, i) => {
          const at = 8 + i * stagger;
          const pop = interpolate(frame, [at, at + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
          const isLast = i === shown.length - 1;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 18,
                opacity: pop,
                transform: `translateY(${(1 - pop) * 26}px) scale(${(0.8 + pop * 0.2).toFixed(3)})`,
              }}
            >
              <div
                style={{
                  width: isLast ? 84 : 64,
                  height: isLast ? 84 : 64,
                  borderRadius: "50%",
                  backgroundColor: isLast ? T.accent : C.panel2,
                  border: `4px solid ${isLast ? T.accent : "rgba(16,185,129,0.5)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "monospace",
                  fontSize: isLast ? 36 : 30,
                  fontWeight: 800,
                  color: isLast ? "#022c22" : T.accent,
                  boxShadow: isLast ? "0 0 42px rgba(16,185,129,0.5)" : "none",
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  fontFamily: "sans-serif",
                  fontSize: 34,
                  fontWeight: 700,
                  color: isLast ? T.fg : C.sub,
                  textAlign: "center",
                  maxWidth: 280,
                }}
              >
                {s.slice(0, 10)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------- 8. StatGrid 多数字网格（财报/数据面板） ---------- */

export const StatGrid: React.FC<{
  stats: { label: string; value: string; delta?: string }[];
  frame: number;
  stagger?: number;
}> = ({ stats, frame, stagger = 9 }) => {
  const shown = stats.slice(0, 4);
  const cols = shown.length <= 2 ? shown.length : 2;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 28,
        width: "100%",
      }}
    >
      {shown.map((s, i) => {
        const at = 6 + i * stagger;
        const enter = interpolate(frame, [at, at + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        return (
          <div
            key={i}
            style={{
              borderRadius: 26,
              backgroundColor: "#10161f",
              border: "1px solid rgba(255,255,255,0.09)",
              padding: "36px 40px",
              opacity: enter,
              transform: `translateY(${((1 - enter) * 30).toFixed(1)}px)`,
            }}
          >
            <div style={{ fontFamily: "sans-serif", fontSize: 30, color: T.sub }}>{s.label.slice(0, 14)}</div>
            <div style={{ fontFamily: "sans-serif", fontSize: 76, fontWeight: 900, color: T.fg, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>
              {s.value.slice(0, 12)}
            </div>
            {s.delta ? (
              <div style={{ fontFamily: "sans-serif", fontSize: 30, color: T.accent, marginTop: 8, fontWeight: 700 }}>{s.delta.slice(0, 16)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/* ---------- 9. QuoteCard 金句卡（观点/结论/引用） ---------- */

export const QuoteCard: React.FC<{
  quote: string;
  author?: string;
  frame: number;
  enterFrames?: number;
}> = ({ quote, author, frame, enterFrames = 40 }) => {
  const rise = interpolate(frame, [4, enterFrames], [40, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const fade = interpolate(frame, [4, enterFrames * 0.7], [0, 1], clamp);
  // 引导线从左下角生长
  const lineGrow = interpolate(frame, [enterFrames * 0.6, enterFrames * 1.4], [0, 1], clamp);
  return (
    <div style={{ position: "relative", width: "100%", padding: "0 80px", opacity: fade, transform: `translateY(${rise}px)` }}>
      {/* 巨型引号装饰 */}
      <div
        style={{
          position: "absolute",
          top: -60,
          left: 20,
          fontFamily: "Georgia, serif",
          fontSize: 220,
          color: "rgba(16,185,129,0.18)",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        “
      </div>
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize: 58,
          fontWeight: 800,
          color: T.fg,
          lineHeight: 1.5,
          textAlign: "left",
        }}
      >
        {quote.slice(0, 44)}
      </div>
      {author ? (
        <div
          style={{
            marginTop: 28,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div style={{ width: 90 * lineGrow, height: 5, backgroundColor: T.accent, borderRadius: 3 }} />
          <span style={{ fontFamily: "sans-serif", fontSize: 32, color: T.sub }}>{author.slice(0, 20)}</span>
        </div>
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
