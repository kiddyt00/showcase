import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { DIMENSIONS, Orientation, Scene } from "../src/video/types";
import { FlowPath, StackBoxes, TerminalSim, Counter as CounterElement, CompareBars, SpringCounter, BorderBeam, TextScramble, SpotlightCard } from "./elements";
import { StoryboardView } from "./storyboard";

export interface SlideshowProps {
  title: string;
  icon?: string;
  tags: string[];
  orientation: Orientation;
  scenes: Scene[];
  /** 页面 slug：片尾卡显示短码 */
  slug?: string;
  /** 可选：背景音乐（public 相对路径），低音量循环铺底 */
  bgmFile?: string;
}

const T = { bg: "#0b0f0e", fg: "#f4f4f5", accent: "#10b981", sub: "#a1a1aa" };

/** 卡拉OK字幕：词级时间戳驱动，纯 interpolate 无状态（帧 seek 安全） */
const SUB_HALF_COLS = 68; // 行宽上限（半角列；CJK 记 2）
const SUB_FADE_S = 0.28; // 行切换交叉淡入时长（秒）

const subCharW = (c: string) => (c.charCodeAt(0) > 0x2e80 ? 2 : 1);
const subDisplayW = (s: string) => Array.from(s).reduce((w, c) => w + subCharW(c), 0);

type KWord = { text: string; sep: string; startMs: number; endMs: number };
type KLine = { words: KWord[]; startMs: number; endMs: number };

/** 分组：timeline（或 narration 降级）→ 行。按标点断句 + 按显示宽度断行 */
function buildKaraokeLines(
  timeline: NonNullable<Scene["timeline"]>,
  narration: string,
  durFrames: number,
  fps: number
): KLine[] {
  const durMs = (durFrames / fps) * 1000;
  let src: { text: string; startMs: number; endMs: number }[];
  if (timeline.length) {
    src = [...timeline]
      .sort((a, b) => a.startMs - b.startMs)
      .map((w) => ({ text: w.word, startMs: w.startMs, endMs: w.endMs }));
  } else {
    // 降级：narration 按宽度切块，时长均分（整块当一个"词"，整块点亮）
    const chars = Array.from(narration.replace(/\s+/g, " ").trim());
    if (!chars.length) return [];
    const chunks: string[] = [];
    let buf = "";
    let w = 0;
    for (const c of chars) {
      const cw = subCharW(c);
      if (w + cw > SUB_HALF_COLS && buf) {
        chunks.push(buf);
        buf = "";
        w = 0;
      }
      buf += c;
      w += cw;
    }
    if (buf) chunks.push(buf);
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    let idx = 0;
    src = chunks.map((line) => {
      const start = (idx / totalLen) * durMs;
      idx += line.length;
      return { text: line, startMs: start, endMs: start + (line.length / totalLen) * durMs };
    });
  }
  if (!src.length) return [];

  // 词间分隔：拉丁↔拉丁边界补空格（中文词块相连不补）
  const words: KWord[] = src.map((w, i) => ({
    text: w.text,
    sep: /[A-Za-z0-9]$/.test(w.text) && /^[A-Za-z0-9(]/.test(src[i + 1]?.text ?? "") ? " " : "",
    startMs: w.startMs,
    endMs: w.endMs,
  }));

  const PUNCT = /[。！？；：、,.!?;:…—～"'”』」）)]/;
  const lines: KLine[] = [];
  let cur: KWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ words: cur, startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const width = cur.reduce((acc2, x) => acc2 + subDisplayW(x.text) + (x.sep ? 1 : 0), -1);
    if (PUNCT.test(w.text) || width >= SUB_HALF_COLS) flush();
  }
  flush();
  return lines;
}

const KaraokeSubtitle: React.FC<{
  local: number;
  durFrames: number;
  fps: number;
  timeline: NonNullable<Scene["timeline"]>;
  narration: string;
}> = ({ local, durFrames, fps, timeline, narration }) => {
  const lines = React.useMemo(
    () => buildKaraokeLines(timeline, narration, durFrames, fps),
    [timeline, narration, durFrames, fps]
  );
  const t = local / fps;
  const fadeOp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  // 当前行：startMs ≤ t < endMs；行间停顿保持上一行；首行前不显示
  let li = lines.findIndex((l) => t >= l.startMs && t < l.endMs);
  if (li < 0) {
    for (let k = lines.length - 1; k >= 0; k--) {
      if (t >= lines[k].startMs) {
        li = k;
        break;
      }
    }
  }
  if (li < 0) li = 0;

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: "70%", height: 110, marginLeft: 40 }}>
      {lines.map((line, i) => {
        // 当前行淡入 0→1；前一行在同窗口淡出 1→0（交叉淡入）
        let opacity = 0;
        if (i === li) {
          opacity = interpolate(t, [line.startMs / 1000, line.startMs / 1000 + SUB_FADE_S], [0, 1], fadeOp);
        } else if (li > 0 && i === li - 1) {
          const nextStart = lines[li].startMs / 1000;
          opacity = interpolate(t, [nextStart, nextStart + SUB_FADE_S], [1, 0], fadeOp);
        }
        if (opacity <= 0.01) return null;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              alignContent: "center",
              columnGap: 2,
              opacity,
              textAlign: "right",
            }}
          >
            {line.words.map((w, k) => {
              const isCur = t >= w.startMs / 1000 && t < w.endMs / 1000;
              const isDone = t >= w.endMs / 1000;
              // 当前词 pop：升到 1.16 后回落
              const wProg = Math.min(
                1,
                Math.max(0, (t - w.startMs / 1000) / Math.max(0.001, (w.endMs - w.startMs) / 1000))
              );
              const pop = isCur ? interpolate(wProg, [0, 0.35, 1], [1, 1.16, 1], fadeOp) : 1;
              return (
                <span
                  key={k}
                  style={{
                    display: "inline-block",
                    whiteSpace: "pre",
                    fontFamily: "sans-serif",
                    fontSize: 34,
                    fontWeight: isCur ? 800 : 600,
                    lineHeight: 1.5,
                    color: isCur ? T.accent : isDone ? T.fg : "rgba(244,244,245,0.4)",
                    transform: `scale(${pop.toFixed(3)})`,
                    transformOrigin: "center bottom",
                  }}
                >
                  {w.text + w.sep}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export const slideshowCalculations = {
  dimensions: DIMENSIONS,
  fps: 30,
};

/** slug 短码：取各段首字符 + 长度，如 "github-showcase" → "gh-s8" 风格的紧凑标识 */
function slugShortcode(slug?: string): string {
  if (!slug) return "";
  const parts = slug.split(/[-_/]/).filter(Boolean);
  const core = parts.map((p) => p.slice(0, 2)).join("-").slice(0, 12);
  return core || slug.slice(0, 12);
}

/** 标题分词：空格分词；无空格（中文等）按 2 字一组，供逐词淡入 */
function splitWords(text: string): { w: string; sep: string }[] {
  const trimmed = text.trim();
  // 按空白切但保留分隔符：拉丁词间保留空格；中文按 2 字一组分块（块间无空隙）
  const parts = trimmed.split(/(\s+)/);
  const out: { w: string; sep: string }[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+$/.test(p)) {
      if (out.length) out[out.length - 1].sep = " ";
      continue;
    }
    if (/[A-Za-z0-9]/.test(p) && p.length <= 24 && !/[\u4e00-\u9fa5]/.test(p)) {
      out.push({ w: p, sep: "" });
    } else {
      for (let i = 0; i < p.length; i += 2) {
        out.push({ w: p.slice(i, i + 2), sep: "" });
      }
    }
  }
  return out;
}

/** 标题逐词淡入：每词间隔 3 帧，词内 8 帧完成淡入 + 轻微上移 */
const WordFadeTitle: React.FC<{
  text: string;
  local: number;
  start?: number;
  style?: React.CSSProperties;
}> = ({ text, local, start = 0, style }) => (
  <h1 style={{ ...style, whiteSpace: "pre-wrap" }}>
    {splitWords(text).map(({ w, sep }, i) => {
      const from = start + i * 3;
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            whiteSpace: "pre",
            opacity: interpolate(local, [from, from + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            transform: `translateY(${interpolate(local, [from, from + 8], [18, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}px)`,
          }}
        >
          {w + sep}
        </span>
      );
    })}
  </h1>
);

/** 代码打字机场景：深色终端窗口 + 逐字出现 + 光标闪烁 */
const CodeTypewriter: React.FC<{
  code: NonNullable<Scene["code"]>;
  local: number;
  opacity: number;
}> = ({ code, local, opacity }) => {
  // 每 2 帧出 1 个字符；超长代码截断（画面放不下，narration 补足）
  const MAX_CHARS = 900;
  const content = code.content.slice(0, MAX_CHARS);
  const shown = content.slice(0, Math.min(content.length, Math.floor(local / 2)));
  const done = shown.length >= content.length;
  const cursorOn = local % 20 < 10;
  return (
    <div
      style={{
        flex: 1,
        marginTop: 30,
        backgroundColor: "#0d1117",
        borderRadius: 20,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        opacity,
        boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
      }}
    >
      {/* 窗口栏：三个圆点 + 文件名/语言 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 24px",
          backgroundColor: "#161b22",
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c }} />
        ))}
        <span style={{ fontFamily: "monospace", fontSize: 24, color: "#8b949e", marginLeft: 12 }}>
          {code.language}
        </span>
      </div>
      {/* 代码区：等宽 + 打字机 */}
      <pre
        style={{
          margin: 0,
          padding: "28px 32px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 28,
          lineHeight: 1.6,
          color: "#e6edf3",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "hidden",
          flex: 1,
        }}
      >
        {shown}
        <span style={{ color: done ? "#28c840" : "#e6edf3", opacity: cursorOn ? 1 : 0.1 }}>
          ▍
        </span>
      </pre>
    </div>
  );
};

/** 数字滚动场景：0 → value 大号滚动 + label */
const CounterRoll: React.FC<{
  counter: NonNullable<Scene["counter"]>;
  local: number;
  dur: number;
  opacity: number;
}> = ({ counter, local, dur, opacity }) => {
  const value = Math.round(
    interpolate(local, [0, dur], [0, counter.value], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
  return (
    <div
      style={{
        flex: 1,
        marginTop: 30,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 200,
          fontWeight: 900,
          color: T.accent,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          textShadow: "0 0 60px rgba(16,185,129,0.35)",
        }}
      >
        {value.toLocaleString("en-US")}
        {counter.suffix ?? ""}
      </div>
      <div
        style={{
          fontFamily: "sans-serif",
          fontSize: 48,
          color: T.sub,
          letterSpacing: 4,
        }}
      >
        {counter.label}
      </div>
    </div>
  );
};

/** 场景转场样式：按索引循环 blur-dissolve / mask-wipe / zoom-through；storyboard 显式声明优先 */
const TRANSITION_FX = ["blur", "wipe", "zoom"] as const;

function transitionStyleFor(
  idx: number,
  local: number,
  dur: number,
  fps: number,
  declared?: { in?: string; out?: string }
): React.CSSProperties {
  const OVERLAP = Math.round(fps * 0.5); // 0.5s 转场窗口
  const fx = TRANSITION_FX[idx % TRANSITION_FX.length];
  const tIn = interpolate(local, [0, OVERLAP], [0, 1], { extrapolateRight: "clamp" });
  const tOut = interpolate(local, [dur - OVERLAP, dur], [0, 1], { extrapolateLeft: "clamp" });
  const useIn = declared?.in !== "none";
  const useOut = declared?.out !== "none" && idx < 99; // 末场景不做出场

  // 进入：blur-dissolve / wipe 位移 / zoom 收拢
  let enterStyle: React.CSSProperties = {};
  if (useIn && local < OVERLAP) {
    if (fx === "blur") {
      enterStyle = {
        opacity: tIn,
        filter: `blur(${(1 - tIn) * 14}px)`,
        transform: `scale(${0.975 + 0.025 * tIn})`,
      };
    } else if (fx === "wipe") {
      enterStyle = {
        clipPath: `inset(0 0 0 ${(1 - tIn) * 100}%)`,
      };
    } else {
      enterStyle = {
        opacity: Math.min(1, tIn * 1.4),
        transform: `scale(${1.16 - 0.16 * tIn})`,
        filter: `blur(${(1 - tIn) * 10}px)`,
      };
    }
  }
  // 退出：对称反向
  let exitStyle: React.CSSProperties = {};
  if (useOut && local > dur - OVERLAP) {
    if (fx === "blur") {
      exitStyle = {
        opacity: 1 - tOut,
        filter: `blur(${tOut * 14}px)`,
        transform: `scale(${1 + 0.03 * tOut})`,
      };
    } else if (fx === "wipe") {
      exitStyle = {
        clipPath: `inset(0 ${(tOut * 100).toFixed(1)}% 0 0)`,
      };
    } else {
      exitStyle = {
        opacity: 1 - tOut,
        transform: `scale(${1 + 0.14 * tOut})`,
        filter: `blur(${tOut * 10}px)`,
      };
    }
  }
  return { ...enterStyle, ...exitStyle };
}

const Slideshow: React.FC<SlideshowProps> = ({ title, icon, tags, scenes, slug, bgmFile }) => {  const frame = useCurrentFrame();
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

  // v4 关键词与小注：keyword 来自 scene.keyword 或 beats 最后一个 label / heading
  const lastBeatLabel = scene.beats?.length ? scene.beats[scene.beats.length - 1].label : undefined;
  const keyword = (scene.keyword || lastBeatLabel || scene.heading || "").slice(0, 8);
  const note = (scene.note || "").slice(0, 20);

  // 转场方向：按索引奇偶交替"从右滑入"/"从左滑入"
  const fromRight = idx % 2 === 0;
  const inSign = fromRight ? 1 : -1;
  // 入场：translateX ±40 → 0（12 帧）
  const inAnim = interpolate(local, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const upAnim = interpolate(local, [0, 12], [24, 0], { extrapolateRight: "clamp" });
  const slideX = interpolate(local, [0, 12], [40 * inSign, 0], { extrapolateRight: "clamp" });
  // 出场：最后 8 帧反向滑出 + 淡出
  const outAnim = interpolate(local, [dur - 8, dur], [1, 0], { extrapolateLeft: "clamp" });
  const outSlideX = interpolate(local, [dur - 8, dur], [0, -40 * inSign], { extrapolateLeft: "clamp" });

  // 首场景（开场）与其他场景不同排版
  const isIntro = idx === 0;
  // 片尾行动卡：最后一个场景
  const isEndCard = idx === scenes.length - 1;
  // 图表场景：以图为主；有动画 MP4 时用视频替代静态图
  const hasVideo = !isIntro && !!scene.videoFile;
  const hasImage = !isIntro && !!(scene.imageFile || scene.videoFile);
  // 代码打字机 / 数字滚动场景
  const hasCode = !isIntro && !isEndCard && !hasImage && !!scene.code;
  const hasCounter = !isIntro && !isEndCard && !hasImage && !hasCode && !!scene.counter;
  // v4 动效图解元素：flowpath / stackboxes / terminal / counter / compare（stepflow/stacklayers 为 v3 兼容别名）
  const tplVisual = scene.visual;
  const hasTemplate =
    !isIntro && !isEndCard && !hasImage && !hasCode && !hasCounter &&
    (tplVisual === "flowpath" || tplVisual === "stackboxes" || tplVisual === "terminal" ||
      tplVisual === "counter" || tplVisual === "compare" ||
      tplVisual === "stepflow" || tplVisual === "stacklayers");
  // 幻灯片模式画面：slideFile 存在时全屏铺满（cover），整段场景轻微 Ken Burns 1.0 → 1.04
  const hasSlide = !!scene.slideFile;
  // v5 分镜：storyboard 存在时接管整个场景画面（背景+层栈），仅保留字幕/进度条/音频
  const hasStoryboard = !isIntro && !isEndCard && !!scene.storyboard;
  const kbSlide = hasSlide
    ? interpolate(local, [0, dur], [1.0, 1.04], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  // Ken Burns：整段场景内 1.0 → 1.05
  const zoom = hasImage
    ? interpolate(local, [0, dur], [1.0, 1.05], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  // 标题下划线：scaleX 0 → 100%（10 帧）
  const underline = interpolate(local, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  // 全片进度（底部细条）
  const progress = total > 0 ? frame / total : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: T.bg }}>
      {/* 片尾卡背景：accent 渐变 */}
      {isEndCard ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, rgba(16,185,129,0.25), rgba(16,185,129,0.05) 55%, transparent)`,
          }}
        />
      ) : null}
      {/* 背景光斑 */}
      {!isEndCard ? (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(60% 50% at 70% 20%, rgba(16,185,129,0.12), transparent), radial-gradient(50% 40% at 20% 80%, rgba(16,185,129,0.07), transparent)",
          }}
        />
      ) : null}

      {/* 配音：所有场景音频从时间线 0 通过 Sequence 挂载（动态挂载 Audio 只有首个生效） */}
      {scenes.map((s, i) =>
        s.audioFile && starts[i] !== undefined ? (
          <Sequence key={`audio-${i}`} from={starts[i]} durationInFrames={s.durationFrames}>
            <Audio src={staticFile(s.audioFile)} />
          </Sequence>
        ) : null
      )}

      {/* 背景音乐：低音量循环铺底（用户放置 public/videos/bgm.mp3 时启用） */}
      {bgmFile ? <Audio loop src={staticFile(bgmFile)} volume={0.08} /> : null}

      {/* 开场/片尾空镜背景：免费实拍素材全屏铺满 + 暗化压底（pipeline 自动匹配） */}
      {(isIntro || isEndCard) && (scene.videoFile || scene.imageFile) ? (
        <>
          <AbsoluteFill style={{ overflow: "hidden" }}>
            {scene.videoFile ? (
              <OffthreadVideo
                src={staticFile(scene.videoFile)}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: inAnim }}
              />
            ) : (
              <Img
                src={staticFile(scene.imageFile!)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: inAnim,
                  transform: `scale(${interpolate(local, [0, dur], [1.0, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})`,
                }}
              />
            )}
          </AbsoluteFill>
          {/* 暗化遮罩：保证标题可读 */}
          <AbsoluteFill style={{ backgroundColor: "rgba(11,15,14,0.74)" }} />
        </>
      ) : null}

      {/* v5 分镜：LLM 设计的原语组合接管场景画面；外包转场层（进入+退出，消除硬切） */}
      {hasStoryboard ? (
        <AbsoluteFill
          style={transitionStyleFor(idx, local, dur, fps, scene.storyboard?.transitions)}
        >
          <StoryboardView scene={scene} frame={local} fps={fps} durationFrames={dur} />
        </AbsoluteFill>
      ) : null}

      {/* 幻灯片模式：截图全屏铺满 + 底部渐变压边 + Ken Burns，替代默认布局（narration/字幕/进度条仍保留） */}
      {hasSlide ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Img
            src={staticFile(scene.slideFile!)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${kbSlide})`,
            }}
          />
          {/* 底部渐变压边：字幕可读性 */}
          <AbsoluteFill
            style={{
              background: "linear-gradient(to top, rgba(2,6,23,0.6), rgba(2,6,23,0.18) 18%, transparent 32%)",
            }}
          />
        </AbsoluteFill>
      ) : null}

      {/* 场景容器：转场滑动（静音场景同样有动画）；幻灯片模式跳过默认布局 */}
      <AbsoluteFill
        style={{
          flexDirection: "column",
          justifyContent: "center",
          padding: "8%",
          opacity: outAnim,
          transform: `translateX(${slideX + outSlideX}px)`,
          display: hasSlide || hasStoryboard ? "none" : "flex",
        }}
      >
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

        {isEndCard ? (
          /* 片尾行动卡：大字 CTA + slug 短码 */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 36 }}>
            <h1
              style={{
                fontFamily: "sans-serif",
                fontSize: 120,
                fontWeight: 900,
                color: T.fg,
                margin: 0,
                lineHeight: 1.1,
                opacity: inAnim,
                transform: `translateX(${interpolate(local, [0, 10], [inSign * 60, 0], { extrapolateRight: "clamp" })}px)`,
              }}
            >
              去试试 →
            </h1>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 40,
                color: T.accent,
                border: `2px solid ${T.accent}`,
                borderRadius: 16,
                padding: "12px 32px",
                backgroundColor: "rgba(16,185,129,0.12)",
                opacity: interpolate(local, [10, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            >
              {slugShortcode(slug)}
            </div>
            <p style={{ fontFamily: "sans-serif", fontSize: 40, color: T.sub, margin: 0, opacity: inAnim }}>
              链接就在页面下方
            </p>
          </div>
        ) : hasTemplate ? (
          /* v4 动效图解：小字场景名 + 超大关键词 + 一行小注 + 动效元素（占全宽 80%） */
          <div style={{ display: "flex", flexDirection: "column", width: "100%", alignItems: "flex-start" }}>
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: 30,
                fontWeight: 600,
                color: T.sub,
                letterSpacing: 2,
                opacity: inAnim,
              }}
            >
              {idx}. {scene.heading}
            </div>
            <h1
              style={{
                fontFamily: "sans-serif",
                fontSize: keyword ? (keyword.length <= 4 ? 96 : 72) : 72,
                fontWeight: 900,
                color: T.fg,
                margin: 0,
                marginTop: 10,
                lineHeight: 1.1,
                opacity: inAnim,
              }}
            >
              {keyword}
            </h1>
            {note ? (
              <div
                style={{
                  fontFamily: "sans-serif",
                  fontSize: 18,
                  color: T.sub,
                  marginTop: 10,
                  opacity: inAnim,
                }}
              >
                {note}
              </div>
            ) : null}
            {/* 动效元素区域：全宽 80% 居中 */}
            <div style={{ width: "80%", alignSelf: "center", flex: 1, display: "flex", flexDirection: "column", marginTop: 20, minHeight: 0 }}>
              {tplVisual === "flowpath" || tplVisual === "stepflow" ? (
                <FlowPath beats={scene.beats ?? []} timeline={scene.timeline ?? []} durationFrames={dur} fps={fps} frame={local} />
              ) : tplVisual === "stackboxes" || tplVisual === "stacklayers" ? (
                <StackBoxes beats={scene.beats ?? []} timeline={scene.timeline ?? []} durationFrames={dur} fps={fps} frame={local} />
              ) : tplVisual === "terminal" ? (
                <TerminalSim beats={scene.beats ?? []} timeline={scene.timeline ?? []} durationFrames={dur} fps={fps} frame={local} />
              ) : tplVisual === "counter" ? (
                scene.counter ? (
                  /* Spring 升级版：物理弹簧过冲数字（无 counter 数据时退回 v4 匀速版） */
                  <SpringCounter
                    value={scene.counter.value}
                    frame={local}
                    durationFrames={Math.min(dur - 10, 60)}
                    label={scene.counter.label}
                    suffix={scene.counter.suffix}
                  />
                ) : (
                  <CounterElement beats={scene.beats ?? []} timeline={scene.timeline ?? []} durationFrames={dur} fps={fps} frame={local} />
                )
              ) : (
                <CompareBars beats={scene.beats ?? []} timeline={scene.timeline ?? []} durationFrames={dur} fps={fps} frame={local} />
              )}
            </div>
          </div>
        ) : (
          <>
            <WordFadeTitle
              text={isIntro ? title : `${idx}. ${scene.heading}`}
              local={local}
              style={{
                fontFamily: "sans-serif",
                fontSize: isIntro ? 96 : 72,
                fontWeight: 800,
                color: T.fg,
                margin: 0,
                lineHeight: 1.15,
              }}
            />
            {/* 标题下划线：accent 色 scaleX 展开 */}
            <div
              style={{
                width: isIntro ? 360 : 280,
                height: 8,
                marginTop: 24,
                borderRadius: 4,
                backgroundColor: T.accent,
                transform: `scaleX(${underline})`,
                transformOrigin: "left center",
              }}
            />
          </>
        )}

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
              {hasVideo ? (
                <OffthreadVideo
                  src={staticFile(scene.videoFile!)}
                  muted
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <Img
                  src={staticFile(scene.imageFile!)}
                  style={{ width: "100%", height: "100%", objectFit: "contain", transform: `scale(${zoom})` }}
                />
              )}
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

        {hasCode ? (
          <CodeTypewriter code={scene.code!} local={local} opacity={inAnim * outAnim} />
        ) : null}

        {hasCounter ? (
          <CounterRoll counter={scene.counter!} local={local} dur={dur} opacity={inAnim * outAnim} />
        ) : null}

        {!hasImage && !hasCode && !hasCounter && !hasTemplate && !isIntro && !isEndCard ? (
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
        ) : !isEndCard && !hasTemplate ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, rowGap: 14, marginTop: 40, opacity: inAnim, maxWidth: "100%" }}>
            {tags.slice(0, 8).map((t) => (
              <span key={t} style={{ fontFamily: "sans-serif", fontSize: 36, color: T.accent, border: `2px solid ${T.accent}`, borderRadius: 999, padding: "6px 24px" }}>
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </AbsoluteFill>

      {/* 底部品牌 + 场景字幕（片尾卡字幕由 CTA 区承担） */}
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
        {!isEndCard && !isIntro ? (
          <KaraokeSubtitle
            local={local}
            durFrames={dur}
            fps={fps}
            timeline={scene.timeline ?? []}
            narration={scene.narration}
          />
        ) : null}
      </div>

      {/* 全片进度条：底部 2px 细条，accent 色 */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, backgroundColor: "#27272a" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: T.accent }} />
      </div>

      {/* 首帧黑场淡入 */}
      {frame < fps / 2 ? (
        <AbsoluteFill style={{ backgroundColor: "black", opacity: 1 - frame / (fps / 2) }} />
      ) : null}
      {/* 全局时间戳（仅开发/Studio 预览可见；渲染 bundle NODE_ENV=production 自动整段剔除） */}
      {process.env.NODE_ENV !== "production" ? (
        <div style={{ position: "absolute", top: "4%", right: "6%", fontFamily: "sans-serif", fontSize: 26, color: "#52525b" }}>
          {Math.floor(frame / fps)}s / {Math.floor(total / fps)}s
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export default Slideshow;
