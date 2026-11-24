/** 验证脚本：真实渲染一条 superpowers 横版视频并写库（含 scenes） */
import { renderVideo } from "../packages/core/src/video/pipeline";
import { upsertVideoJob, getVideoJob } from "../packages/core/src/store";

async function main() {
  const slug = "superpowers-coding-agent-methodology";
  const orientation = "landscape" as const;
  const r = await renderVideo(slug, orientation, (p) => {
    if (p % 25 === 0) console.log(`progress ${p}%`);
  });
  const existing = getVideoJob(slug, orientation);
  upsertVideoJob({
    slug,
    orientation,
    status: "done",
    progress: 100,
    videoPath: r.path,
    scenes: r.scenes,
    error: undefined,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
  const total = r.scenes.reduce((s, x) => s + x.seconds, 0);
  console.log("RENDER_OK", r.path);
  const stat = await (await import("node:fs/promises")).stat(r.path);
  console.log("videoSizeMB:", (stat.size / 1024 / 1024).toFixed(2));
  console.log("totalSeconds:", total, "sceneCount:", r.scenes.length);
  for (const s of r.scenes) {
    console.log(
      `scene: heading=${s.heading} visual=${s.visual ?? "text"} seconds=${s.seconds} timelineWords=${s.timelineWords ?? 0}`
    );
  }
}

main().catch((e) => {
  console.error("RENDER_FAIL", e);
  process.exit(1);
});
