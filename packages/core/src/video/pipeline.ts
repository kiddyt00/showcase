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
import { generateScript } from "./script";
import { synthesize } from "./tts";
import { DIMENSIONS, FPS, Orientation, Scene, VideoJobSpec } from "./types";
import { CORE_ROOT, PUBLIC_ASSETS_DIR } from "../paths";

export const VIDEO_DIR = path.join(PUBLIC_ASSETS_DIR, "videos");

/** 渲染一条视频，返回 MP4 路径 */
export async function renderVideo(
  slug: string,
  orientation: Orientation,
  onProgress?: (percent: number) => void
): Promise<string> {
  const page = await getPage(slug);
  if (!page) throw new Error(`页面 ${slug} 不存在`);

  const spec = await buildSpec(page, orientation);
  const outName = `${slug}-${orientation}.mp4`;
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
  return outPath;
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

/** 组装视频规格：脚本 + 配音 + 时长 */
async function buildSpec(
  page: NonNullable<Awaited<ReturnType<typeof getPage>>>,
  orientation: Orientation
): Promise<VideoJobSpec> {
  const script = await generateScript(page);
  const assetDirRel = `videos/${page.slug}-assets/${orientation}`; // public 相对路径
  const assetDir = path.join(PUBLIC_ASSETS_DIR, assetDirRel);
  await fs.mkdir(assetDir, { recursive: true });

  // 图表标题 → svg public 相对路径（如 diagrams/{slug}/{id}.svg）
  const diagramByTitle = new Map(
    (page.diagrams ?? [])
      .filter((d) => d.svgUrl)
      .map((d) => [d.title.trim(), d])
  );

  const scenes: Scene[] = [];
  for (let i = 0; i < script.length; i++) {
    const s = script[i];
    const audioFile = path.join(assetDir, `scene-${i}.mp3`);
    let audioFileRel = "";
    let durationFrames: number;
    try {
      const { durationSec } = await synthesize(s.narration, audioFile);
      audioFileRel = `${assetDirRel}/scene-${i}.mp3`;
      durationFrames = Math.max(60, Math.ceil(durationSec * FPS));
    } catch (err) {
      // TTS 失败降级：该场景静音兜底，不生成音频文件。
      // 时长按中文口播语速估算：约 4 字/秒，再加 1 秒呼吸空间。
      const len = s.narration.replace(/\s/g, "").length;
      const estSec = Math.ceil(len / 4) + 1;
      durationFrames = Math.max(60, Math.ceil(estSec * FPS));
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
      // 页面有图表时，标题匹配到的场景用该图作为画面
      ...(await (async () => {
        const d = diagramByTitle.get(s.heading.trim());
        if (!d?.svgUrl) return {};
        // 宽高比守卫：过窄的导出（如系统字体下标签竖排）不适合做视频画面
        try {
          const svgPath = path.join(PUBLIC_ASSETS_DIR, d.svgUrl.replace(/^\//, ""));
          const head = (await fs.readFile(svgPath, "utf8")).slice(0, 200);
          const w = Number(head.match(/width="(\d+)"/)?.[1] ?? 0);
          const h = Number(head.match(/height="(\d+)"/)?.[1] ?? 0);
          if (w && h && w / h < 0.45) {
            console.warn(`[video] 跳过窄图 ${d.id}（${w}x${h}），该场景使用纯文字画面`);
            return {};
          }
        } catch { /* 读取失败不阻塞 */ }
        return { imageFile: d.svgUrl.replace(/^\//, "") };
      })()),
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
