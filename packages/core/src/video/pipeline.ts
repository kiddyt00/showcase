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
import { fetchStockVideo, fetchStockPhoto, fetchStockPhotoRel, findBgmFile } from "./stock";
import { DIMENSIONS, FPS, Orientation, Scene, SceneSummary, VideoJobSpec, VideoMode } from "./types";
import { CORE_ROOT, PUBLIC_ASSETS_DIR } from "../paths";
import type { Diagram, Section } from "../types";
import type { ScriptScene } from "./script";

export const VIDEO_DIR = path.join(PUBLIC_ASSETS_DIR, "videos");

/** 场景时长硬上限（秒）：脚本层超长 narration 已截断，这里再兜底 */
const MAX_SCENE_SECONDS = 22;

/** 单条视频最多使用的空镜/图片素材数（控制 Pexels API 调用量与下载时间） */
const MAX_STOCK_SCENES = 5;

/** 空镜搜索词清洗：去掉英文虚词，避免 Pexels 搜出无关结果 */
function stockQuery(s: { keyword?: string; heading?: string }): string {
  const raw = (s.keyword || s.heading || "").trim();
  return raw.replace(/[，。、！？:："'（）()]/g, " ").slice(0, 40);
}

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

  // bundle 的 publicDir 是打包时快照：本次渲染新下载的资产（stock/音频/图标）不在其中。
  // 渲染前把本页资产目录同步进 bundle 的 public/videos/{slug}-assets，OffthreadVideo/Img 才能取到。
  try {
    const bundlePublic = path.join(serveUrl, "public");
    const assetSrc = path.join(PUBLIC_ASSETS_DIR, "videos", `${slug}-assets`);
    const assetDest = path.join(bundlePublic, "videos", `${slug}-assets`);
    await fs.mkdir(path.dirname(assetDest), { recursive: true });
    await fs.cp(assetSrc, assetDest, { recursive: true, force: true });
    // bgm 同步
    const bgmSrc = path.join(PUBLIC_ASSETS_DIR, "videos", "bgm.mp3");
    if (await fs.stat(bgmSrc).then(() => true).catch(() => false)) {
      await fs.cp(bgmSrc, path.join(bundlePublic, "videos", "bgm.mp3"), { force: true });
    }
  } catch (err) {
    console.warn(`[video] 资产同步进 bundle 失败（可能影响画面素材）: ${err instanceof Error ? err.message : err}`);
  }

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
      keyword: s.keyword,
      note: s.note,
      narrationChars: s.narration.replace(/\s/g, "").length,
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

/** 组装视频规格：脚本 + 配音 + 时长（slides 模式画面 = 幻灯片截图，与场景一一对应）。HyperFrames 管线复用 */
export async function buildSpec(
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
    const exact = diagramByTitle.get((scene.heading ?? scene.keyword ?? "").trim());
    if (exact) return exact;
    return (page.diagrams ?? []).find((d) => !usedDiagramIds.has(d.id) && (d.mp4Url || d.svgUrl));
  }

  /** visual=code 的素材解析：标题匹配章节的 code → 未使用的第一个含 code 章节 */
  function pickCode(scene: ScriptScene): NonNullable<Section["code"]> | undefined {
    const exact = page.sections.find(
      (sec) => sec.heading.trim() === (scene.heading ?? scene.keyword ?? "").trim() && sec.code?.content
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
        usedCodeHeadings.add(scene.heading ?? scene.keyword ?? "");
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
  let stockUsed = 0;
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
      heading: s.keyword || s.heading || "untitled",
      keyword: s.keyword,
      note: s.note,
      bullets: s.bullets,
      narration: s.narration,
      audioFile: audioFileRel,
      durationFrames,
      hookScene: s.hookScene,
      // 词级时间戳 + 动画模板声明（visual/beats 由脚本层产出，模板组件消费）
      ...(timeline.length ? { timeline } : {}),
      ...(isSlides ? { visual: "slide" as const } : s.visual && s.visual !== "text" ? { visual: s.visual } : {}),
      ...(s.beats?.length ? { beats: s.beats } : {}),
      // v5 分镜：LLM 设计的原语组合，存在时渲染端走 StoryboardRenderer
      ...(s.storyboard ? { storyboard: s.storyboard } : {}),
      // 幻灯片模式：场景 i ↔ slide-{i}.png（截图缺失的场景无 slideFile → 渲染端回退默认布局）
      ...(isSlides && slideFiles[i] ? { slideFile: slideFiles[i] } : {}),
      // LLM visual 声明 + 实际素材 → 动画视频 / 静态图 / 打字机代码 / 数字滚动 / 纯文字
      ...(!isSlides ? await resolveVisual(s) : {}),
    });

    // 免费空镜/图片补充（Pexels，免费可商用）：
    // - 开场场景：全屏空镜做标题背景（电影感）
    // - 中间纯文字场景（无图表/代码/数字/模板）：空镜视频替代，图片降级
    // 限量 MAX_STOCK_SCENES 防刷；跳过幻灯片模式与模板场景
    const last = scenes[scenes.length - 1];
    const isIntroScene = i === 0;
    const isEndCard = i === script.length - 1;
    const hasTemplate = !!last.visual; // flowpath/terminal/compare 等动效模板场景不用空镜
    const midCandidate =
      !last.videoFile && !last.imageFile && !last.code && !last.counter && !hasTemplate;
    if (!isSlides && stockUsed < MAX_STOCK_SCENES && (isIntroScene || (midCandidate && !isEndCard))) {
      stockUsed++;
      const query = stockQuery(s) || page.tags[0] || page.title.slice(0, 30);
      const seconds = durationFrames / FPS;
      const stockRel = `videos/${page.slug}-assets/${orientation}/stock-${i}`;
      const clip =
        (await fetchStockVideo({
          query,
          orientation,
          minDurationSec: seconds,
          destRel: `${stockRel}.mp4`,
        })) ??
        (await fetchStockPhoto({ query, orientation, destRel: `${stockRel}.jpg` }));
      if (clip?.endsWith(".mp4")) {
        last.videoFile = clip;
        console.warn(`[stock] 场景 ${i}「${query}」使用空镜视频 ${clip}`);
      } else if (clip) {
        last.imageFile = clip;
        console.warn(`[stock] 场景 ${i}「${query}」使用图片素材 ${clip}`);
      }
    }
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

  // 分镜 photo/clip 层：LLM 只写搜索意图（query），管线真实下载后回填 src
  for (const scene of scenes) {
    const layers = scene.storyboard?.layers;
    if (!layers) continue;
    for (const l of layers) {
      if ((l.type === "photo" || l.type === "clip") && !("src" in l && l.src)) {
        const q = (l as { query: string }).query;
        const rel = `videos/${page.slug}-assets/${orientation}/media-${layers.indexOf(l)}.`;
        const src =
          l.type === "clip"
            ? await fetchStockVideo({ query: q, orientation, minDurationSec: 5, destRel: `${rel}mp4` })
            : (await fetchStockPhotoRel(q, orientation, `${rel}jpg`)) ??
              (await fetchStockVideo({ query: q, orientation, minDurationSec: 5, destRel: `${rel}mp4` }));
        if (src) (l as { src?: string }).src = src;
        console.warn(`[stock] 分镜 ${l.type}「${q}」${src ? "素材已下载 " + src : "未找到素材，层已移除"}`);
      }
    }
    // 未解析到素材的 photo/clip 层剔除（渲染端无 src 会挂）
    scene.storyboard!.layers = layers.filter(
      (l) => !(l.type === "photo" || l.type === "clip") || ("src" in l && !!l.src)
    );
  }

  return {
    slug: page.slug,
    orientation,
    title: page.title,
    icon,
    tags: page.tags,
    scenes,
    // 免费背景音乐：用户放置 public/videos/bgm.mp3 即自动混入（低音量循环）
    bgmFile: findBgmFile(),
  };
}

export { DIMENSIONS };
