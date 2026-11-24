/**
 * v5 分镜渲染器：把 LLM 设计的 storyboard（视觉原语组合）翻译成 Remotion 组件树。
 * 每层原语独立入场动效；原语不可用时静默跳过。web 动效的帧驱动移植版都住这里。
 */
import React from "react";
import { AbsoluteFill, interpolate, staticFile, Img, OffthreadVideo } from "remotion";
import type { EnterFx, Scene, StoryboardLayer } from "../src/video/types";
import { FlowPath, StackBoxes, TerminalSim, CompareBars, SpringCounter, BorderBeam, TextScramble, SpotlightCard, ProgressRing, StepTimeline, StatGrid, QuoteCard } from "./elements";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const C = {
  bg: "#0b0f0e",
  panel: "#10161f",
  panel2: "#161d28",
  fg: "#f4f4f5",
  accent: "#10b981",
  sub: "#a1a1aa",
};

const SIZE_PX: Record<string, number> = {
  giant: 150,
  large: 96,
  medium: 56,
  small: 34,
};

const COLOR_MAP: Record<string, string> = { fg: C.fg, accent: C.accent, sub: C.sub };

/** 通用入场包装：fx + delaySec → 帧驱动的 opacity/transform */
function useEnter(
  fx: EnterFx | undefined,
  delaySec: number,
  frame: number,
  fps: number
): { opacity: number; transform: string } {
  const start = delaySec * fps;
  const local = frame - start;
  if (local < 0) return { opacity: 0, transform: "none" };
  const p = (frames: number) => interpolate(local, [0, frames], [0, 1], clamp);
  switch (fx) {
    case "spring": {
      const t = Math.min(1, local / 26);
      // 阻尼弹簧：一次过冲
      const eased = 1 - Math.exp(-5.5 * t) * Math.cos(1.4 * Math.PI * t) * (1 - t * 0.25);
      return { opacity: p(8), transform: `scale(${(0.9 + eased * 0.1).toFixed(3)}) translateY(${((1 - eased) * 24).toFixed(1)}px)` };
    }
    case "scramble":
      return { opacity: 1, transform: "none" }; // scramble 自身处理逐字
    case "border-beam":
      return { opacity: p(12), transform: `translateY(${((1 - p(12)) * 18).toFixed(1)}px)` };
    case "spotlight":
      return { opacity: p(14), transform: "none" };
    case "scale-blur":
      return { opacity: p(14), transform: `scale(${(0.92 + p(14) * 0.08).toFixed(3)})` };
    case "fade-up":
    default:
      return { opacity: p(12), transform: `translateY(${((1 - p(12)) * 24).toFixed(1)}px)` };
  }
}

/** 单层渲染：按 layer.type 分发 */
const LayerView: React.FC<{
  layer: StoryboardLayer;
  frame: number;
  fps: number;
  durationFrames: number;
}> = ({ layer, frame, fps, durationFrames }) => {
  const enter = useEnter(layer.enter?.fx ?? "fade-up", layer.enter?.delaySec ?? 0, frame, fps);
  const style: React.CSSProperties = { opacity: enter.opacity, transform: enter.transform };

  switch (layer.type) {
    case "text": {
      const size = SIZE_PX[layer.size ?? "large"] ?? 96;
      if (layer.enter?.fx === "scramble") {
        return (
          <div style={{ ...style }}>
            <TextScramble text={layer.content} frame={frame - (layer.enter.delaySec ?? 0) * fps} fontSize={size} color={COLOR_MAP[layer.color ?? "fg"]} />
          </div>
        );
      }
      return (
        <div
          style={{
            ...style,
            fontFamily: "sans-serif",
            fontSize: size,
            fontWeight: layer.size === "giant" ? 900 : 800,
            color: COLOR_MAP[layer.color ?? "fg"],
            lineHeight: 1.12,
            textAlign: layer.align ?? "left",
            width: "100%",
          }}
        >
          {layer.content}
        </div>
      );
    }
    case "card": {
      const inner = (
        <div
          style={{
            padding: "36px 44px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "flex-start",
            width: "100%",
          }}
        >
          {layer.title ? (
            <div style={{ fontFamily: "sans-serif", fontSize: 52, fontWeight: 900, color: layer.accent ? C.accent : C.fg, lineHeight: 1.15 }}>{layer.title}</div>
          ) : null}
          {layer.body ? <div style={{ fontFamily: "sans-serif", fontSize: 26, color: C.sub, lineHeight: 1.5 }}>{layer.body}</div> : null}
        </div>
      );
      if (layer.enter?.fx === "border-beam") {
        return (
          <div style={{ ...style, width: "86%", display: "flex", justifyContent: "center" }}>
            <BorderBeam width={900} height={340} frame={frame} periodFrames={120}>
              {inner}
            </BorderBeam>
          </div>
        );
      }
      if (layer.enter?.fx === "spotlight") {
        return (
          <div style={{ ...style, width: "100%", display: "flex", justifyContent: "center" }}>
            <SpotlightCard width={980} height={340} frame={frame - (layer.enter.delaySec ?? 0) * fps} title={layer.title ?? ""} note={layer.body} />
          </div>
        );
      }
      return (
        <div
          style={{
            ...style,
            width: "86%",
            borderRadius: 28,
            backgroundColor: layer.accent ? "rgba(16,185,129,0.10)" : C.panel2,
            border: `1px solid ${layer.accent ? "rgba(16,185,129,0.45)" : "rgba(255,255,255,0.09)"}`,
          }}
        >
          {inner}
        </div>
      );
    }
    case "metric":
      return (
        <div style={{ ...style, width: "100%", display: "flex", justifyContent: layer.enter?.fx === "spring" ? "center" : "flex-start" }}>
          <SpringCounter
            value={parseNumber(layer.value)}
            frame={frame - (layer.enter?.delaySec ?? 0) * fps}
            durationFrames={Math.min(durationFrames - 10, 55)}
            label={layer.label}
            fontSize={170}
          />
        </div>
      );
    case "ring":
      return (
        <div style={{ ...style, width: "100%", display: "flex", justifyContent: "center" }}>
          <ProgressRing
            ratio={layer.ratio}
            frame={frame - (layer.enter?.delaySec ?? 0) * fps}
            label={layer.label}
            centerText={layer.centerText}
          />
        </div>
      );
    case "timeline":
      return (
        <div style={{ ...style, width: "100%" }}>
          <StepTimeline steps={layer.steps} frame={frame - (layer.enter?.delaySec ?? 0) * fps} />
        </div>
      );
    case "stats":
      return (
        <div style={{ ...style, width: "100%" }}>
          <StatGrid stats={layer.stats} frame={frame - (layer.enter?.delaySec ?? 0) * fps} />
        </div>
      );
    case "quote":
      return (
        <div style={{ ...style, width: "100%", display: "flex", justifyContent: "center" }}>
          <QuoteCard quote={layer.quote} author={layer.author} frame={frame - (layer.enter?.delaySec ?? 0) * fps} />
        </div>
      );
    case "photo":
    case "clip": {
      const src = (layer as { src?: string }).src;
      if (!src) return null;
      const caption = (layer as { caption?: string }).caption;
      return (
        <div style={{ ...style, width: "92%", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: "100%",
              height: 560,
              borderRadius: 24,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
              backgroundColor: "#10161f",
            }}
          >
            {src.endsWith(".mp4") ? (
              <OffthreadVideo muted src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Img
                src={staticFile(src)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: `scale(${interpolate(frame, [0, durationFrames], [1.0, 1.06], clamp)})`,
                }}
              />
            )}
          </div>
          {caption ? (
            <div style={{ fontFamily: "sans-serif", fontSize: 26, color: C.sub, textAlign: "center" }}>{caption}</div>
          ) : null}
        </div>
      );
    }
    case "image":
      return (
        <div style={{ ...style, width: "100%", display: "flex", justifyContent: "center" }}>
          <Img src={staticFile(layer.src)} style={{ maxWidth: "100%", maxHeight: 640, borderRadius: 24 }} />
        </div>
      );
    case "video":
      return (
        <div style={{ ...style, width: "100%", display: "flex", justifyContent: "center" }}>
          <OffthreadVideo muted src={staticFile(layer.src)} style={{ maxWidth: "100%", maxHeight: 640, borderRadius: 24 }} />
        </div>
      );
    default: {
      // 复合原语（flowpath/stackboxes/terminal/compare）：beats 驱动，复用 v4 组件。
      // 无 beats 时跳过该层——空 beats 会渲染出"元素一/节点 2"这类哑占位，观感灾难
      const beats = (layer as { beats?: Scene["beats"] }).beats ?? [];
      if (!beats.length) return null;
      const props = { beats, timeline: [], durationFrames, fps, frame };
      const el =
        layer.type === "flowpath" ? (
          <FlowPath {...props} />
        ) : layer.type === "stackboxes" ? (
          <StackBoxes {...props} />
        ) : layer.type === "terminal" ? (
          <TerminalSim {...props} />
        ) : layer.type === "compare" ? (
          <CompareBars {...props} />
        ) : null;
      if (!el) return null;
      return (
        <div style={{ ...style, width: "86%", alignSelf: "center", display: "flex", justifyContent: "center" }}>{el}</div>
      );
    }
  }
};

function parseNumber(s: string): number {
  const m = s.replace(/[,，\s]/g, "").match(/([\d.]+)([万kKmMwW]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2]?.toLowerCase();
  if (unit === "万" || unit === "w") return n * 10000;
  if (unit === "k") return n * 1000;
  if (unit === "m") return n * 1000000;
  return n;
}

/** 场景级渲染入口：background + layers 栈 */
export const StoryboardView: React.FC<{
  scene: Scene;
  frame: number;
  fps: number;
  durationFrames: number;
}> = ({ scene, frame, fps, durationFrames }) => {
  const sb = scene.storyboard;
  if (!sb) return null;
  const bg = sb.background;
  return (
    <AbsoluteFill
      style={{
        background:
          bg?.type === "gradient" && bg.to
            ? `linear-gradient(${bg.angle ?? 160}deg, ${bg.from}, ${bg.to})`
            : bg?.from ?? "transparent",
        padding: "8%",
        display: "flex",
        flexDirection: "column",
        gap: 28,
        justifyContent: "center",
      }}
    >
      {(sb.layers ?? []).map((l, i) => (
        <LayerView key={i} layer={l} frame={frame} fps={fps} durationFrames={durationFrames} />
      ))}
    </AbsoluteFill>
  );
};
