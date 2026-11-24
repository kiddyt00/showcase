/** TTS 配音合成（edge-tts，免费，中文音色）+ 词级时间戳时间线 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";

const VOICE = process.env.TTS_VOICE || "zh-CN-YunxiNeural"; // 男声，口播感强

/** 词级时间戳：一个词的起止（毫秒，音频内相对时间） */
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

/** 提取 raw 中所有平衡的 JSON 对象并解析（metadata 输出是多行 JSON 无分隔符直连，且按 chunk 截断） */
function parseJsonObjects(raw: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          /* 单对象解析失败跳过 */
        }
        start = -1;
      }
    }
  }
  return out;
}

/**
 * 从 metadataStream 原始输出解析词边界。
 * Edge TTS 每条 metadata 消息是一个多行 JSON 对象（无分隔符直连，跨 chunk 截断）：
 * {"Metadata":[{"Type":"WordBoundary","Data":{"Offset":1000000,"Duration":2750000,"text":{"Text":"这是"}}}]}
 * Offset/Duration 单位 100 纳秒 → ms = /10000。
 */
function parseWordTimeline(raw: string): WordTimestamp[] {
  const timeline: WordTimestamp[] = [];
  for (const parsed of parseJsonObjects(raw)) {
    const entries =
      (parsed as { Metadata?: unknown[] })?.Metadata ??
      (Array.isArray(parsed) ? parsed : [parsed]);
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const item = e as { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } };
      if (item?.Type !== "WordBoundary" || !item.Data) continue;
      const word = item.Data.text?.Text ?? "";
      const offset = typeof item.Data.Offset === "number" ? item.Data.Offset : NaN;
      const duration = typeof item.Data.Duration === "number" ? item.Data.Duration : NaN;
      if (!word || !Number.isFinite(offset) || !Number.isFinite(duration)) continue;
      const startMs = offset / 10_000;
      timeline.push({ word, startMs, endMs: startMs + duration / 10_000 });
    }
  }
  return timeline;
}

/**
 * 合成一段口播音频并产出词级时间戳（音画同步基础设施）。
 * 音频写入 outPath；timeline JSON 写入 timelinePath。
 * metadataStream 缺失或解析失败 → timeline 写空数组（降级，不阻塞渲染）。
 * 保留 48kbps CBR 时长估算逻辑（不解析音频流的近似值，够定场景帧数用）。
 */
export async function synthesizeWithTimeline(
  text: string,
  outPath: string,
  timelinePath: string
): Promise<{ durationSec: number; timelinePath: string }> {
  const tts = new MsEdgeTTS({ enableLogger: false });
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const { audioStream, metadataStream } = tts.toStream(text);

  // 音频流直接 pipeline 到目标文件（toStream 可自选文件名，toFile 不行）
  const audioDone = new Promise<void>((resolve, reject) => {
    const file = createWriteStream(outPath);
    audioStream.on("error", reject);
    file.on("error", reject);
    file.on("finish", () => resolve());
    audioStream.pipe(file);
  });

  // 同时收集词边界：每条消息是一行（可能不带换行，按 buffer 追加后统一解析）
  let metaRaw = "";
  const metaDone = new Promise<void>((resolve) => {
    if (!metadataStream) return resolve();
    metadataStream.on("data", (chunk: Buffer | string) => {
      metaRaw += chunk.toString();
    });
    metadataStream.on("error", () => resolve()); // 解析失败降级为空
    metadataStream.on("end", () => resolve());
    metadataStream.on("close", () => resolve());
  });

  await Promise.all([audioDone, metaDone]);
  tts.close();

  let timeline: WordTimestamp[] = [];
  try {
    timeline = metaRaw.trim() ? parseWordTimeline(metaRaw) : [];
  } catch {
    timeline = [];
  }
  if (timeline.length === 0) {
    console.warn("[video] 词级时间戳未产出（metadata 缺失/解析失败），该场景字幕退回整句样式");
  }
  await fs.writeFile(timelinePath, JSON.stringify(timeline), "utf8");

  const stat = await fs.stat(outPath);
  // 48kbps CBR MP3 → 由文件大小估算时长，再留 0.35s 呼吸空间。
  // 局限说明：这是按固定码率的近似估算，不解析音频流——
  // 如果编码格式/码率变化（或输出含 VBR 头），估算会偏差；
  // 与真实播放时长可能相差数百毫秒，仅用于定场景帧数够用。
  const durationSec = (stat.size * 8) / 48_000 + 0.35;
  return { durationSec, timelinePath };
}
