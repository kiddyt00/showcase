/**
 * 解说视频渲染管线
 * PageContent → 口播脚本 → TTS → Remotion 渲染 MP4
 * 独立进程任务，结果写入 public/videos/
 */
import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getPage } from "../store";
import { generateScript, generateSlidesScript } from "./script";
import { generateSlides } from "./slides";
import { synthesizeWithTimeline, WordTimestamp } from "./tts";
import { DIMENSIONS, FPS, Orientation, Scene, SceneSummary, VideoJobSpec, VideoMode } from "./types";
import { CORE_ROOT, PUBLIC_ASSETS_DIR } from "../paths";
import type { Diagram, Section } from "../types";
import type { ScriptScene } from "./script";

export const VIDEO_DIR = path.join(PUBLIC_ASSETS_DIR, "videos");

/** 场景时长硬上限（秒）：脚本层超长 narration 已截断，这里再兜底 */
const MAX_SCENE_SECONDS = 22;

export interface RenderVideoResult {
  path: string;
  /** 场景摘要 [{heading, seconds}]，写库供播放器章节时间轴 */
  scenes: SceneSummary[];
}

/** 渲染一条视频，返回 MP4 路径与场景摘要 */
export async function renderVideo(
  slug: string,
  orientation: Orientation,
  onProgress?: (percent: number) => void,
  mode: VideoMode = "standard"
): Promise<RenderVideoResult> {
  const page = await getPage(slug);
  if (!page) throw new Error(`页面 ${slug} 不存在`);

  const spec = await buildSpec(page, orientation, mode);
  const outName =
    mode === "slides" ? `${slug}-${orientation}-slides.mp4` : `${slug}-${orientation}.mp4`;
  const outPath = path.join(VIDEO_DIR, outName);
  await fs.mkdir(VIDEO_DIR, { recursive: true });

  const entry = path.join(CORE_ROOT, "remotion", "entry.tsx");
  const serveUrl = await getServeUrl(entry);

  const composition = await selectComposition({
    serveUrl,
    id: "Slideshow",
    inputProps: spec as unknown as Record<string, unknown>,
  });
  // 渲染进度回调（节流到每 5% 写一次）
  let lastReported = 0;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps: spec as unknown as Record<string, unknown>,
    onProgress: (p) => {
      if (!onProgress) return;
      const percent = Math.round(p.progress * 90); // 渲染占 0~90%，合成/写盘占尾段
      if (percent - lastReported >= 5) {
        lastReported = percent;
        onProgress(percent);
      }
    },
  });
  onProgress?.(95);

  // 校验输出文件确实存在，才标记任务为 done
  const stat = await fs.stat(outPath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error("渲染完成但输出文件缺失或为空");
  }
  return {
    path: outPath,
    scenes: spec.scenes.map((s) => ({
      heading: s.heading,
      seconds: Math.round(s.durationFrames / FPS),
      visual: s.visual ?? ("text" as const),
      timelineWords: s.timeline?.length ?? 0,
    })),
  };
}

/**
 * bundle 结果模块级缓存：entryPath → Promise<serveUrl> 单例。
 * webpack 打包很重，同一 entry 只需打包一次，后续渲染直接复用。
 * 失败时从缓存移除，允许下次重试。
 */
const bundleCache = new Map<string, Promise<string>>();

function getServeUrl(entry: string): Promise<string> {
  let p = bundleCache.get(entry);
  if (!p) {
    p = bundle({ entryPoint: entry, onProgress: () => {}, publicDir: PUBLIC_ASSETS_DIR }).catch((err) => {
      bundleCache.delete(entry);
      throw err;
    });
    bundleCache.set(entry, p);
  }
  return p;
}

/** 组装视频规格：脚本 + 配音 + 时长（slides 模式画面 = 幻灯片截图，与场景一一对应） */
async function buildSpec(
  page: NonNullable<Awaited<ReturnType<typeof getPage>>>,
  orientation: Orientation,
  mode: VideoMode = "standard"
): Promise<VideoJobSpec> {
  const isSlides = mode === "slides";
  const script = isSlides ? generateSlidesScript(page) : await generateScript(page);
  // 幻灯片模式：先产出全部 PNG（chrome 截图），场景 i ↔ slide-{i}.png；单页失败时该场景回退默认布局
  const slideFiles = isSlides ? (await generateSlides(page, orientation)).slideFiles : [];
  const assetDirRel = `videos/${page.slug}-assets/${orientation}`; // public 相对路径
  const assetDir = path.join(PUBLIC_ASSETS_DIR, assetDirRel);
  await fs.mkdir(assetDir, { recursive: true });

  // 图表标题 → svg public 相对路径（如 diagrams/{slug}/{id}.svg）
  const diagramByTitle = new Map(
    (page.diagrams ?? [])
      .filter((d) => d.svgUrl)
      .map((d) => [d.title.trim(), d])
  );
  const usedDiagramIds = new Set<string>();
  const usedCodeHeadings = new Set<string>();

  /** visual=diagram 的素材解析：标题精确匹配 → 未使用的第一张图（有 svg 或 mp4） */
  function pickDiagram(scene: ScriptScene): Diagram | undefined {
    const exact = diagramByTitle.get(scene.heading.trim());
    if (exact) return exact;
    return (page.diagrams ?? []).find((d) => !usedDiagramIds.has(d.id) && (d.mp4Url || d.svgUrl));
  }

  /** visual=code 的素材解析：标题匹配章节的 code → 未使用的第一个含 code 章节 */
  function pickCode(scene: ScriptScene): NonNullable<Section["code"]> | undefined {
    const exact = page.sections.find(
      (sec) => sec.heading.trim() === scene.heading.trim() && sec.code?.content
    );
    if (exact?.code) return exact.code;
    const first = page.sections.find(
      (sec) => !usedCodeHeadings.has(sec.heading) && sec.code?.content
    );
    return first?.code;
  }

  /** visual=counter 的素材解析：metadata 里含 star/fork 的数值（优先 star），其次任意最大数值 */
  function pickCounter(): { label: string; value: number; suffix?: string } | undefined {
    const entries = Object.entries(page.metadata ?? {}).filter(
      ([, v]) => typeof v === "number" && Number.isFinite(v) && (v as number) > 0
    ) as [string, number][];
    const keyHit = entries.find(([k]) => k.toLowerCase().includes("star")) ??
      entries.find(([k]) => k.toLowerCase().includes("fork"));
    if (keyHit) return { label: keyHit[0], value: keyHit[1] };
    const big = entries.sort((a, b) => b[1] - a[1])[0];
    return big ? { label: big[0], value: big[1] } : undefined;
  }

  /** 按 LLM visual 声明结合实际素材，产出画面附加字段；素材不满足降级 text（空对象） */
  async function resolveVisual(
    scene: ScriptScene
  ): Promise<Pick<Scene, "imageFile" | "videoFile" | "code" | "counter">> {
    if (scene.visual === "diagram") {
      const d = pickDiagram(scene);
      if (d) {
        usedDiagramIds.add(d.id);
        // 动画 MP4 优先（SeeCode 逐步绘制），无则退静态 SVG
        if (d.mp4Url) return { videoFile: d.mp4Url.replace(/^\//, "") };
        if (d.svgUrl) {
          const imageFile = d.svgUrl.replace(/^\//, "");
          // 宽高比守卫：过窄的导出（如系统字体下标签竖排）不适合做视频画面
          try {
            const svgPath = path.join(PUBLIC_ASSETS_DIR, imageFile);
            const head = (await fs.readFile(svgPath, "utf8")).slice(0, 200);
            const w = Number(head.match(/width="(\d+)"/)?.[1] ?? 0);
            const h = Number(head.match(/height="(\d+)"/)?.[1] ?? 0);
            if (w && h && w / h < 0.45) {
              console.warn(`[video] 跳过窄图 ${d.id}（${w}x${h}），该场景使用纯文字画面`);
              return {};
            }
          } catch { /* 读取失败不阻塞 */ }
          return { imageFile };
        }
      }
      return {};
    }
    if (scene.visual === "code") {
      const code = pickCode(scene);
      if (code) {
        usedCodeHeadings.add(scene.heading);
        return { code: { language: code.language, content: code.content } };
      }
      return {};
    }
    if (scene.visual === "counter") {
      const c = pickCounter();
      return c ? { counter: c } : {};
    }
    return {};
  }

  const scenes: Scene[] = [];
  for (let i = 0; i < script.length; i++) {
    const s = script[i];
    const audioFile = path.join(assetDir, `scene-${i}.mp3`);
    const timelineFile = path.join(assetDir, `scene-${i}.timeline.json`);
    let audioFileRel = "";
    let durationFrames: number;
    let timeline: WordTimestamp[] = [];
    try {
      const { durationSec } = await synthesizeWithTimeline(s.narration, audioFile, timelineFile);
      audioFileRel = `${assetDirRel}/scene-${i}.mp3`;
      // 词级时间戳挂到 Scene：渲染端逐词高亮字幕 + 模板节拍对齐
      try {
        timeline = JSON.parse(await fs.readFile(timelineFile, "utf8")) as WordTimestamp[];
        if (!Array.isArray(timeline)) timeline = [];
      } catch {
        timeline = [];
      }
      durationFrames = Math.min(
        MAX_SCENE_SECONDS * FPS,
        Math.max(60, Math.ceil(durationSec * FPS))
      );
    } catch (err) {
      // TTS 失败降级：该场景静音兜底，不生成音频文件。
      // 时长按中文口播语速估算：约 4 字/秒，再加 1 秒呼吸空间。
      const len = s.narration.replace(/\s/g, "").length;
      const estSec = Math.ceil(len / 4) + 1;
      durationFrames = Math.min(
        MAX_SCENE_SECONDS * FPS,
        Math.max(60, Math.ceil(estSec * FPS))
      );
      console.warn(
        `[video] TTS 合成失败，场景 ${i} 使用静音降级（估算 ${estSec}s）:`,
        err instanceof Error ? err.message : err
      );
    }
    scenes.push({
      heading: s.heading,
      bullets: s.bullets,
      narration: s.narration,
      audioFile: audioFileRel,
      durationFrames,
      hookScene: s.hookScene,
      // 词级时间戳 + 动画模板声明（visual/beats 由脚本层产出，模板组件消费）
      ...(timeline.length ? { timeline } : {}),
      ...(isSlides ? { visual: "slide" as const } : s.visual && s.visual !== "text" ? { visual: s.visual } : {}),
      ...(s.beats?.length ? { beats: s.beats } : {}),
      // 幻灯片模式：场景 i ↔ slide-{i}.png（截图缺失的场景无 slideFile → 渲染端回退默认布局）
      ...(isSlides && slideFiles[i] ? { slideFile: slideFiles[i] } : {}),
      // LLM visual 声明 + 实际素材 → 动画视频 / 静态图 / 打字机代码 / 数字滚动 / 纯文字
      ...(!isSlides ? await resolveVisual(s) : {}),
    });
  }

  // 图标本地化：下载外部图标到资产目录，渲染时不依赖外网（失败则放弃图标）
  let icon = page.icon;
  if (icon && /^https?:\/\//.test(icon)) {
    try {
      const res = await fetch(icon, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const iconRel = `videos/${page.slug}-assets/${orientation}/icon.png`;
        await fs.writeFile(path.join(PUBLIC_ASSETS_DIR, iconRel), buf);
        icon = iconRel;
      } else {
        icon = undefined;
      }
    } catch (err) {
      console.warn(`图标下载失败，视频将不含图标: ${err instanceof Error ? err.message : err}`);
      icon = undefined;
    }
  }

  return {
    slug: page.slug,
    orientation,
    title: page.title,
    icon,
    tags: page.tags,
    scenes,
  };
}

export { DIMENSIONS };
