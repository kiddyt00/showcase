/** TTS 配音合成（edge-tts，免费，中文音色） */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import fs from "node:fs/promises";
import path from "node:path";

const VOICE = process.env.TTS_VOICE || "zh-CN-YunxiNeural"; // 男声，口播感强

/** 合成一段口播音频，返回 { 文件路径, 时长秒 } */
export async function synthesize(
  text: string,
  outPath: string
): Promise<{ durationSec: number }> {
  const tts = new MsEdgeTTS({ enableLogger: false });
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  // toFile(目录, 文本) 会在目录下生成 audio.mp3，之后改名为目标路径
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const { audioFilePath } = await tts.toFile(dir, text);
  if (audioFilePath !== outPath) {
    await fs.rename(audioFilePath, outPath);
  }
  const stat = await fs.stat(outPath);
  // 48kbps CBR MP3 → 由文件大小估算时长，再留 0.6s 呼吸空间。
  // 局限说明：这是按固定码率的近似估算，不解析音频流——
  // 如果编码格式/码率变化（或输出含 VBR 头），估算会偏差；
  // 与真实播放时长可能相差数百毫秒，仅用于定场景帧数够用。
  const durationSec = (stat.size * 8) / 48_000 + 0.6;
  return { durationSec };
}
