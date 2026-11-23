import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { DIMENSIONS, Orientation, Scene } from "../src/video/types";

export interface SlideshowProps {
  title: string;
  icon?: string;
  tags: string[];
  orientation: Orientation;
  scenes: Scene[];
}

const T = { bg: "#0b0f0e", fg: "#f4f4f5", accent: "#10b981", sub: "#a1a1aa" };

export const slideshowCalculations = {
  dimensions: DIMENSIONS,
  fps: 30,
};

const Slideshow: React.FC<SlideshowProps> = ({ title, icon, tags, scenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 图标可能是外部 URL，也可能是 public 内的本地路径
  const iconSrc =
    icon && /^https?:\/\//.test(icon) ? icon : icon ? staticFile(icon) : null;

  // 按帧数切分场景
  const starts: number[] = [];
  let acc = 0;
  for (const s of scenes) {
    starts.push(acc);
    acc += s.durationFrames;
  }
  const total = acc;
  let idx = scenes.length - 1;
  for (let i = 0; i < scenes.length; i++) {
    if (frame < starts[i]) { idx = i - 1; break; }
    idx = i;
  }
  idx = Math.max(0, idx);
  const scene = scenes[idx];
  const local = frame - starts[idx];
  const dur = scene.durationFrames;

  const inAnim = interpolate(local, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const upAnim = interpolate(local, [0, 12], [24, 0], { extrapolateRight: "clamp" });
  const outAnim = interpolate(local, [dur - 8, dur], [1, 0.96], { extrapolateLeft: "clamp" });

  // 首场景（开场）与其他场景不同排版
  const isIntro = idx === 0;
  // 图表场景：以图为主
  const hasImage = !isIntro && !!scene.imageFile;
  // Ken Burns：整段场景内 1.0 → 1.05
  const zoom = hasImage
    ? interpolate(local, [0, dur], [1.0, 1.05], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: T.bg }}>
      {/* 背景光斑 */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(60% 50% at 70% 20%, rgba(16,185,129,0.12), transparent), radial-gradient(50% 40% at 20% 80%, rgba(16,185,129,0.07), transparent)",
        }}
      />

      {/* 配音：所有场景音频从时间线 0 通过 Sequence 挂载（动态挂载 Audio 只有首个生效） */}
      {scenes.map((s, i) =>
        s.audioFile && starts[i] !== undefined ? (
          <Sequence key={`audio-${i}`} from={starts[i]} durationInFrames={s.durationFrames}>
            <Audio src={staticFile(s.audioFile)} />
          </Sequence>
        ) : null
      )}

      <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "8%" }}>
        {/* 场景进度点 */}
        <div style={{ position: "absolute", top: "6%", left: "8%", display: "flex", gap: 10 }}>
          {scenes.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === idx ? 36 : 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: i <= idx ? T.accent : "#27272a",
                transition: "none",
              }}
            />
          ))}
        </div>

        {isIntro && iconSrc ? (
          <Img
            src={iconSrc}
            style={{ width: 160, height: 160, borderRadius: 36, objectFit: "contain", marginBottom: 40, backgroundColor: "#18181b", padding: 20, opacity: inAnim }}
          />
        ) : null}

        <h1
          style={{
            fontFamily: "sans-serif",
            fontSize: isIntro ? 96 : 72,
            fontWeight: 800,
            color: T.fg,
            margin: 0,
            lineHeight: 1.15,
            opacity: inAnim * outAnim,
            transform: `translateY(${upAnim}px)`,
          }}
        >
          {isIntro ? title : `${idx}. ${scene.heading}`}
        </h1>

        {hasImage ? (
          <>
            <h1 style={{ fontFamily: "sans-serif", fontSize: 56, fontWeight: 800, color: T.fg, margin: 0, lineHeight: 1.15, opacity: inAnim * outAnim }}>
              {scene.heading}
            </h1>
            <div
              style={{
                flex: 1,
                marginTop: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#fafafa",
                borderRadius: 24,
                padding: 24,
                overflow: "hidden",
                opacity: inAnim * outAnim,
              }}
            >
              <Img
                src={staticFile(scene.imageFile!)}
                style={{ width: "100%", height: "100%", objectFit: "contain", transform: `scale(${zoom})` }}
              />
            </div>
            {scene.bullets.length ? (
              <div style={{ display: "flex", gap: 24, marginTop: 20, opacity: inAnim }}>
                {scene.bullets.slice(0, 3).map((b, i) => (
                  <span key={i} style={{ fontFamily: "sans-serif", fontSize: 30, color: T.sub }}>
                    • {b}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {!hasImage && !isIntro ? (
          <ul style={{ marginTop: 40, opacity: inAnim, transform: `translateY(${upAnim}px)` }}>
            {scene.bullets.map((b, i) => (
              <li
                key={i}
                style={{
                  fontFamily: "sans-serif",
                  fontSize: 44,
                  color: T.sub,
                  lineHeight: 1.7,
                  opacity: interpolate(local, [8 + i * 6, 16 + i * 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                }}
              >
                • {b}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: "flex", gap: 16, marginTop: 40, opacity: inAnim }}>
            {tags.map((t) => (
              <span key={t} style={{ fontFamily: "sans-serif", fontSize: 36, color: T.accent, border: `2px solid ${T.accent}`, borderRadius: 999, padding: "6px 24px" }}>
                {t}
              </span>
            ))}
          </div>
        )}
      </AbsoluteFill>

      {/* 底部品牌 + 场景字幕 */}
      <div
        style={{
          position: "absolute",
          bottom: "5%",
          left: "8%",
          right: "8%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "sans-serif",
        }}
      >
        <span style={{ fontSize: 30, color: T.sub }}>ShowCase</span>
        <span style={{ fontSize: 32, color: T.fg, opacity: 0.85, maxWidth: "70%" }}>
          {isIntro ? "" : scene.narration.length > 60 ? scene.narration.slice(0, 60) + "…" : scene.narration}
        </span>
      </div>

      {/* 首帧黑场淡入 */}
      {frame < fps / 2 ? (
        <AbsoluteFill style={{ backgroundColor: "black", opacity: 1 - frame / (fps / 2) }} />
      ) : null}
      {/* 全局时间戳（开发校验用，正式可去掉） */}
      <div style={{ position: "absolute", top: "4%", right: "6%", fontFamily: "sans-serif", fontSize: 26, color: "#52525b" }}>
        {Math.floor(frame / fps)}s / {Math.floor(total / fps)}s
      </div>
    </AbsoluteFill>
  );
};

export default Slideshow;
