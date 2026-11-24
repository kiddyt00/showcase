/**
 * v3 升级验证（一次性脚本）：
 * 1. 重渲染 superpowers 页图表（含动画 MP4 导出）并回写 DB
 * 2. 删除旧 video_jobs 行 → startRender 重渲染 landscape
 * 3. 轮询任务状态直到 done/failed，打印场景结构
 */
import { getPage, getVideoJob, db } from "../packages/core/src/store";
import { renderPageDiagrams } from "../packages/core/src/diagrams";
import { startRender } from "../packages/core/src/video/queue";
import { PUBLIC_ASSETS_DIR } from "../packages/core/src/paths";
import path from "node:path";
import fs from "node:fs";

const SLUG = "superpowers-coding-agent-methodology";

async function main() {
  const page = getPage(SLUG);
  if (!page) throw new Error("页面不存在");

  console.log("== 1. 重渲染图表（含 mp4 动画导出） ==");
  const t0 = Date.now();
  const { failed } = await renderPageDiagrams(page);
  console.log(`图表渲染完成 ${Date.now() - t0}ms，失败数=${failed.length}`);
  for (const f of failed) console.warn(`  失败: ${f.diagram.id}: ${f.error}`);
  for (const d of page.diagrams ?? []) {
    console.log(`  ${d.id}: svgUrl=${d.svgUrl ?? "-"} mp4Url=${d.mp4Url ?? "-"}`);
  }
  db.prepare("UPDATE pages SET diagrams = ? WHERE slug = ?").run(
    JSON.stringify(page.diagrams ?? []),
    SLUG
  );

  if (page.diagrams?.some((d) => d.mp4Url)) {
    for (const d of page.diagrams) {
      if (!d.mp4Url) continue;
      const p = path.join(PUBLIC_ASSETS_DIR, d.mp4Url.replace(/^\//, ""));
      const st = fs.statSync(p);
      console.log(`  mp4 ${d.id}: ${(st.size / 1024).toFixed(0)} KB`);
    }
  }

  console.log("== 2. 删除旧任务并发起 landscape 重渲染 ==");
  db.prepare("DELETE FROM video_jobs WHERE slug = ? AND orientation = ?").run(SLUG, "landscape");
  const r = await startRender(SLUG, "landscape");
  if (r !== "started") throw new Error(`startRender=${r}`);
  console.log("渲染已发起，轮询中…");

  const t1 = Date.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 10000));
    const job = getVideoJob(SLUG, "landscape");
    if (!job) throw new Error("任务丢失");
    console.log(`  progress=${job.progress ?? 0}%  t=${Math.round((Date.now() - t1) / 1000)}s`);
    if (job.status === "done" || job.status === "failed") {
      console.log(`最终状态: ${job.status} ${job.error ?? ""}`);
      console.log("场景:", JSON.stringify(job.scenes));
      if (job.status === "failed") process.exit(1);
      break;
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("验证失败:", err);
  process.exit(1);
});
