/**
 * 免费素材获取：Pexels 视频（空镜）/ 图片，全部免费可商用。
 * 需要 PEXELS_API_KEY（https://www.pexels.com/api/ 免费申请）。
 * 无 key 或网络失败时静默降级（返回 undefined），不阻塞视频渲染。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PUBLIC_ASSETS_DIR } from "../paths";

const API_KEY = process.env.PEXELS_API_KEY || "";
const TIMEOUT_MS = 15_000;
let warnedNoKey = false;

export interface StockQuery {
  /** 搜索关键词（场景 keyword/heading） */
  query: string;
  orientation: "landscape" | "portrait";
  /** 场景时长（秒），选比它长的素材避免播到黑屏 */
  minDurationSec?: number;
  /** 下载目标：public 相对路径（videos/{slug}-assets/{o}/stock-N.mp4） */
  destRel: string;
}

/** 从 Pexels 视频搜索结果里挑一个合适的文件（分辨率达标的最小文件） */
function pickVideoFile(
  video: {
    duration: number;
    video_files: { link: string; file_type: string; width: number | null; height: number | null }[];
  },
  orientation: "landscape" | "portrait",
  minDurationSec: number
): string | undefined {
  if (video.duration < minDurationSec) return undefined;
  const minSide = orientation === "landscape" ? 1280 : 1080;
  const candidates = video.video_files
    .filter((f) => f.file_type === "video/mp4")
    .filter((f) =>
      orientation === "landscape" ? (f.width ?? 0) >= minSide : (f.height ?? 0) >= minSide
    )
    .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0));
  return candidates[0]?.link;
}

/** 搜索并下载一段 Pexels 空镜视频，成功返回 public 相对路径 */
export async function fetchStockVideo(q: StockQuery): Promise<string | undefined> {
  if (!API_KEY) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn("[stock] 未配置 PEXELS_API_KEY，空镜素材功能停用（pexels.com/api 免费申请）");
    }
    return undefined;
  }
  try {
    const url = new URL("https://api.pexels.com/videos/search");
    url.searchParams.set("query", q.query);
    url.searchParams.set("orientation", q.orientation);
    url.searchParams.set("per_page", "8");
    const res = await fetch(url, {
      headers: { Authorization: API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[stock] Pexels 视频搜索失败 ${res.status}: ${q.query}`);
      return undefined;
    }
    const data = (await res.json()) as {
      videos?: {
        duration: number;
        video_files: { link: string; file_type: string; width: number | null; height: number | null }[];
      }[];
    };
    const min = Math.max(6, Math.ceil(q.minDurationSec ?? 8));
    const videos = (data.videos ?? []).filter((v) => v.duration >= min);
    for (const v of videos) {
      const link = pickVideoFile(v, q.orientation, min);
      if (!link) continue;
      const ok = await download(link, q.destRel);
      if (ok) return q.destRel;
    }
    return undefined;
  } catch (err) {
    console.warn(`[stock] 空镜获取失败（${q.query}）: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

/** 搜索并下载一张 Pexels 图片，成功返回 public 相对路径（空镜视频的降级） */
export async function fetchStockPhoto(q: Omit<StockQuery, "minDurationSec">): Promise<string | undefined> {
  return fetchStockPhotoRel(q.query, q.orientation, q.destRel);
}

/** 独立的图片搜索下载（文章配图 / 分镜 photo 层用）：query 英文搜索词 */
export async function fetchStockPhotoRel(
  query: string,
  orientation: "landscape" | "portrait",
  destRel: string
): Promise<string | undefined> {
  if (!API_KEY || !query.trim()) return undefined;
  try {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query.trim().slice(0, 60));
    url.searchParams.set("orientation", orientation);
    url.searchParams.set("per_page", "4");
    const res = await fetch(url, {
      headers: { Authorization: API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { photos?: { src?: { large2x?: string; large?: string } }[] };
    const link = data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large;
    if (!link) return undefined;
    const ok = await download(link, destRel);
    return ok ? destRel : undefined;
  } catch (err) {
    console.warn(`[stock] 图片获取失败（${query}）: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

async function download(link: string, destRel: string): Promise<boolean> {
  try {
    const res = await fetch(link, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50_000) return false; // 太小视为坏数据
    const abs = path.join(PUBLIC_ASSETS_DIR, destRel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    return true;
  } catch {
    return false;
  }
}

/** 背景音乐：public/videos/bgm.mp3 存在则使用（用户自备免费曲目），否则不混音 */
export function findBgmFile(): string | undefined {
  const p = "videos/bgm.mp3";
  try {
    // 同步探测足够小；用 existsSync 避免 async 传染
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsSync = require("node:fs") as typeof import("node:fs");
    return fsSync.existsSync(path.join(PUBLIC_ASSETS_DIR, p)) ? p : undefined;
  } catch {
    return undefined;
  }
}
