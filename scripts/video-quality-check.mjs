/**
 * 视频质量自动检查：node scripts/video-quality-check.mjs <mp4路径> <scenes JSON路径可选>
 * 输出结构化质检报告：
 *  1. 时长与分辨率
 *  2. 音频覆盖（silencedetect，静音占比 > 30% 判 FAIL）
 *  3. 场景中点抽帧到 /tmp/vqc-frames/（供人工/模型查看画面）
 *  4. 边界帧亮度检测（相邻场景切换是否有黑屏/白屏残留）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const mp4 = process.argv[2];
const scenesJson = process.argv[3]; // 可选：[{heading, seconds}]
if (!mp4 || !fs.existsSync(mp4)) {
  console.error(JSON.stringify({ ok: false, error: "mp4 不存在: " + mp4 }));
  process.exit(1);
}

function ffprobe(args) {
  return execFileSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8" });
}
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return err.stdout ?? "";
  }
}

const duration = parseFloat(
  ffprobe(["-show_entries", "format=duration", "-of", "csv=p=0", mp4]).trim()
);
const streams = ffprobe(
  ["-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", mp4]
);
const streamInfo = JSON.parse(streams).streams ?? [];
const hasAudio = streamInfo.some((s) => s.codec_type === "audio");
const video = streamInfo.find((s) => s.codec_type === "video");

// 静音检测
const silenceOut = run("ffmpeg", [
  "-i", mp4, "-af", "silencedetect=noise=-45dB:d=2", "-f", "null", "-",
]);
const silences = [];
for (const m of silenceOut.matchAll(/silence_start: ([\d.]+)/g)) silences.push(parseFloat(m[1]));
let silentTotal = 0;
for (const m of silenceOut.matchAll(/silence_duration: ([\d.]+)/g)) silentTotal += parseFloat(m[1]);
const silentRatio = duration > 0 ? silentTotal / duration : 1;

// 场景中点抽帧
const outDir = "/tmp/vqc-frames";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const frames = [];
let scenes = [];
if (scenesJson && fs.existsSync(scenesJson)) {
  scenes = JSON.parse(fs.readFileSync(scenesJson, "utf8"));
  let acc = 0;
  scenes.forEach((s, i) => {
    const mid = acc + s.seconds / 2;
    const f = path.join(outDir, `scene-${String(i).padStart(2, "0")}-${Math.round(mid)}s.png`);
    run("ffmpeg", ["-ss", String(mid), "-i", mp4, "-frames:v", "1", "-y", f]);
    frames.push({ scene: i, heading: s.heading, at: Math.round(mid), file: f });
    acc += s.seconds;
  });
} else {
  // 无场景数据：均匀抽 6 帧
  for (let i = 0; i < 6; i++) {
    const at = Math.round(((i + 0.5) / 6) * duration);
    const f = path.join(outDir, `frame-${i}-${at}s.png`);
    run("ffmpeg", ["-ss", String(at), "-i", mp4, "-frames:v", "1", "-y", f]);
    frames.push({ scene: i, heading: "均匀抽样", at, file: f });
  }
}

// 边界亮度（黑屏检测）：每 2 秒取一帧平均亮度
const lumOut = [];
let acc2 = 0;
while (acc2 < duration - 1) {
  const t = acc2;
  const out = run("ffmpeg", [
    "-ss", String(t), "-i", mp4, "-frames:v", "1",
    "-vf", "scale=64:36", "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ]);
  if (out.length) {
    let sum = 0;
    for (const b of out) sum += b;
    lumOut.push({ t: Math.round(t), lum: Math.round(sum / out.length) });
  }
  acc2 += 2;
}
const blackFrames = lumOut.filter((l) => l.lum < 12).length;

const report = {
  ok: hasAudio && silentRatio < 0.3 && blackFrames <= 2,
  duration: Math.round(duration * 10) / 10,
  resolution: video ? `${video.width}x${video.height}` : "unknown",
  hasAudio,
  audioCodec: streamInfo.find((s) => s.codec_type === "audio")?.codec_name ?? null,
  silentSegments: silences.length,
  silentRatio: Math.round(silentRatio * 100) + "%",
  blackFrames,
  framesDir: outDir,
  frames,
};
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
