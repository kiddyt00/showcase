/**
 * 动画模板组件库（P1）：StepFlow / StackLayers / TerminalSim
 * 统一 props：beats（节拍）+ timeline（词级时间戳）驱动。
 * 动画触发时间 = beats[i].atWord 在 timeline 中匹配词的 startMs → 帧；
 * timeline 为空或词未命中 → 按 beats 均分场景时长（降级必须无滚动条无报错）。
 */
import { Easing, interpolate } from "remotion";
import { Scene } from "../src/video/types";

export type Beat = NonNullable<Scene["beats"]>[number];
export type Timeline = NonNullable<Scene["timeline"]>;

export interface TemplateProps {
  beats: Beat[];
  timeline: Timeline;
  durationFrames: number;
  fps: number;
  /** 场景内相对帧（Slideshow 的 local） */
  frame: number;
}

const T = { fg: "#f4f4f5", accent: "#10b981", sub: "#a1a1aa", muted: "#52525b" };

/**
 * 节拍 → 帧号。词命中 timeline 用真实词时间，否则均分。
 * 返回数组长度恒等于 beats.length（beats 为空时由调用方给 count 均分）。
 */
export function beatToFrames(
  beats: Beat[],
  timeline: Timeline,
  durationFrames: number,
  fps: number,
  fallbackCount?: number
): number[] {
  const count = beats.length || fallbackCount || 0;
  if (count === 0) return [];
  const even = (i: number) => Math.round((durationFrames * (i + 1)) / (count + 1));
  if (!timeline.length || !beats.length) return Array.from({ length: count }, (_, i) => even(i));

  // atWord 匹配：按顺序向后找（同一词多次出现时不回跳），找不到 → 均分该拍
  const frames: number[] = [];
  let searchFrom = 0;
  for (let i = 0; i < beats.length; i++) {
    const at = beats[i].atWord.trim();
    let hit = -1;
    for (let j = searchFrom; j < timeline.length; j++) {
      const w = timeline[j].word.trim();
      if (w === at || w.includes(at) || at.includes(w)) {
        hit = j;
        break;
      }
    }
    if (hit >= 0) {
      searchFrom = hit; // 允许同词重复命中下一处（searchFrom 不 +1 以兼容少词 timeline）
      frames.push(Math.min(durationFrames - 1, Math.max(0, Math.round((timeline[hit].startMs / 1000) * fps))));
    } else {
      frames.push(even(i));
    }
  }
  // 保证时间单调不减（渲染画面不能回退）
  for (let i = 1; i < frames.length; i++) {
    if (frames[i] < frames[i - 1]) frames[i] = frames[i - 1];
  }
  return frames;
}

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/* ---------- 1. StepFlow 步骤流 ---------- */

export const StepFlow: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const count = Math.max(3, Math.min(5, beats.length || 3));
  const labels = Array.from({ length: count }, (_, i) => beats[i]?.label || `步骤 ${i + 1}`);
  const beatFrames = beatToFrames(beats, timeline, durationFrames, fps, count);
  const nodeSize = 220;

  return (
    <div
      style={{
        flex: 1,
        marginTop: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 60,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", overflow: "hidden" }}>
        {Array.from({ length: count }, (_, i) => {
          const at = beatFrames[i] ?? durationFrames;
          const active = frame >= at;
          const lit = interpolate(frame, [at, at + 10], [0.25, 1], clamp);
          // 命中时刻放大脉冲：0.9 → 1.1 → 1.0
          const pulse = interpolate(
            frame,
            [at, at + 6, at + 14],
            [0.9, 1.12, 1.0],
            { ...clamp, easing: Easing.out(Easing.ease) }
          );
          // 连线生长：两节点都亮后 scaleX 0→1（起点 = 下一节点命中帧，简化用 opacity+scale）
          const nextAt = beatFrames[i + 1] ?? -1;
          const grow =
            i < count - 1
              ? interpolate(frame, [nextAt, nextAt + 10], [0, 1], { ...clamp, extrapolateLeft: "clamp" })
              : 0;
          // 光点沿连线匀速移动（连线完成后循环）
          const dotT =
            i < count - 1 && grow >= 1
              ? ((frame - (nextAt + 10)) / 24) % 1
              : -1;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  width: nodeSize,
                  height: nodeSize,
                  borderRadius: 32,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                  backgroundColor: active ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                  border: `3px solid ${active ? T.accent : "#3f3f46"}`,
                  opacity: lit,
                  transform: `scale(${pulse})`,
                  boxShadow: active ? "0 0 44px rgba(16,185,129,0.35)" : "none",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 64,
                    fontWeight: 800,
                    color: active ? T.accent : T.muted,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    fontFamily: "sans-serif",
                    fontSize: 34,
                    fontWeight: 600,
                    color: active ? T.fg : T.muted,
                    textAlign: "center",
                    padding: "0 12px",
                  }}
                >
                  {labels[i]}
                </span>
              </div>
              {i < count - 1 ? (
                <div
                  style={{
                    width: 110,
                    height: 6,
                    backgroundColor: "#3f3f46",
                    position: "relative",
                    transformOrigin: "left center",
                    transform: `scaleX(${grow})`,
                    flexShrink: 0,
                  }}
                >
                  {dotT >= 0 && dotT <= 1 ? (
                    <div
                      style={{
                        position: "absolute",
                        top: -7,
                        left: `${dotT * 100}%`,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: T.accent,
                        boxShadow: "0 0 18px rgba(16,185,129,0.8)",
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------- 2. StackLayers 盒子叠加 ---------- */

// accent 同色系深浅渐变（深 → 浅）
const LAYER_COLORS = ["#064e3b", "#065f46", "#047857", "#059669", "#10b981"];
const LAYER_TOPS = ["#0b6b50", "#0d7d5c", "#109470", "#17ad84", "#3ecfa0"];

export const StackLayers: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const count = Math.max(3, Math.min(5, beats.length || 3));
  const labels = Array.from({ length: count }, (_, i) => beats[i]?.label || `层 ${i + 1}`);
  const beatFrames = beatToFrames(beats, timeline, durationFrames, fps, count);

  return (
    <div
      style={{
        flex: 1,
        marginTop: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* 自下而上堆叠：DOM 顺序倒排，第 i 层（底部）最先弹入 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
        {Array.from({ length: count }, (_, layer) => layer).reverse().map((i) => {
          const at = beatFrames[i] ?? durationFrames;
          // 弹入：translateY 30 → 0 带回弹（back easing）
          const drop = interpolate(frame, [at, at + 18], [30, 0], {
            ...clamp,
            easing: Easing.out(Easing.back(1.7)),
          });
          const fade = interpolate(frame, [at, at + 8], [0, 1], clamp);
          const pop = interpolate(frame, [at, at + 10, at + 20], [0.85, 1.06, 1], clamp);
          return (
            <div
              key={i}
              style={{
                width: 720 - i * 60,
                height: 120,
                position: "relative",
                opacity: fade,
                transform: `translateY(${drop}px) scale(${pop})`,
                flexShrink: 0,
              }}
            >
              {/* 伪 3D 顶面：浅色条 skew 出立体感 */}
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  right: -14,
                  top: -16,
                  height: 16,
                  backgroundColor: LAYER_TOPS[i % LAYER_TOPS.length],
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
              {/* 盒子主体 */}
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: 14,
                  backgroundColor: LAYER_COLORS[i % LAYER_COLORS.length],
                  border: "2px solid rgba(255,255,255,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 20,
                  position: "relative",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.4)",
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 40, color: "rgba(255,255,255,0.65)" }}>
                  L{i + 1}
                </span>
                <span style={{ fontFamily: "sans-serif", fontSize: 44, fontWeight: 700, color: "#ffffff" }}>
                  {labels[i]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------- 3. TerminalSim 终端模拟 ---------- */

export const TerminalSim: React.FC<TemplateProps> = ({ beats, timeline, durationFrames, fps, frame }) => {
  const lines = beats.slice(0, 6);
  const beatFrames = beatToFrames(beats, timeline, durationFrames, fps, beats.length);
  const cursorOn = frame % 20 < 10;

  // 预渲染每行内容：type → 逐字（从该 beat 帧到下一 beat 帧线性插值）；output → 瞬间出现
  const rendered = lines.map((b, i) => {
    const start = beatFrames[i] ?? durationFrames;
    const next = beatFrames[i + 1] ?? start + 60;
    if (b.action === "type" && b.content) {
      const shown = Math.round(
        interpolate(frame, [start + 4, Math.max(start + 8, next - 4)], [0, b.content.length], clamp)
      );
      return {
        kind: "cmd" as const,
        text: b.content.slice(0, Math.max(0, shown)),
        visible: frame >= start,
        typing: shown < b.content.length,
      };
    }
    // output：输出行瞬间出现（label=ok 时尾加绿色 ✓）
    return {
      kind: "out" as const,
      text: b.content || b.label || "",
      ok: b.label === "ok",
      visible: frame >= start,
      typing: false,
    };
  });

  return (
    <div
      style={{
        flex: 1,
        marginTop: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          backgroundColor: "#0d1117",
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
          border: "1px solid #21262d",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* macOS 窗口栏 */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 28px", backgroundColor: "#161b22" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c }} />
          ))}
          <span style={{ fontFamily: "monospace", fontSize: 26, color: "#8b949e", marginLeft: 12 }}>terminal</span>
        </div>
        {/* 内容区 */}
        <div
          style={{
            padding: "32px 36px",
            minHeight: 320,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 34,
            lineHeight: 1.8,
            color: "#e6edf3",
            overflow: "hidden",
          }}
        >
          {rendered.map((l, i) =>
            l.visible ? (
              <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {l.kind === "cmd" ? (
                  <>
                    <span style={{ color: T.accent }}>$ </span>
                    {l.text}
                    {l.typing && cursorOn ? <span style={{ opacity: cursorOn ? 1 : 0.1 }}>▍</span> : null}
                  </>
                ) : (
                  <span style={{ color: "#c9d1d9" }}>
                    <span style={{ color: T.muted }}>&gt; </span>
                    {l.text}
                    {l.ok ? <span style={{ color: "#3fb950", marginLeft: 12 }}>✓</span> : null}
                  </span>
                )}
              </div>
            ) : null
          )}
          {/* 常驻光标行 */}
          <div>
            <span style={{ color: T.accent }}>$ </span>
            <span style={{ opacity: cursorOn ? 1 : 0.1, color: "#e6edf3" }}>▍</span>
          </div>
        </div>
      </div>
    </div>
  );
};
