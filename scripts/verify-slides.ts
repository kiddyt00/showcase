/** 幻灯片模式验证：DB superpowers 页 → generateSlides 产 PNG → 渲染 slides 模式 landscape 视频 */
import fs from "node:fs/promises";
import { getPage } from "../packages/core/src/store";
import { generateSlides } from "../packages/core/src/video/slides";
import { renderVideo } from "../packages/core/src/video/pipeline";
import { PUBLIC_ASSETS_DIR } from "../packages/core/src/paths";
import path from "node:path";

const SLUG = "superpowers-coding-agent-methodology";

async function main() {
  const page = getPage(SLUG);
  if (!page) throw new Error("页面不存在");

  console.log("== 1. generateSlides (landscape) ==");
  const t0 = Date.now();
  const { slideFiles, aspect } = await generateSlides(page, "landscape");
  console.log(`slides=${slideFiles.length} aspect=${aspect} cost=${Date.now() - t0}ms`);
  for (const f of slideFiles) {
    const stat = await fs.stat(path.join(PUBLIC_ASSETS_DIR, f));
    const ok = stat.size > 50 * 1024;
    console.log(`  ${f} ${(stat.size / 1024).toFixed(0)}KB ${ok ? "OK" : "TOO_SMALL"}`);
    if (!ok) throw new Error("存在疑似空白截图");
  }
  if (slideFiles.length < 5) throw new Error(`PNG 数量不足 5 张（${slideFiles.length}）`);

  console.log("== 2. renderVideo slides mode (landscape) ==");
  const r = await renderVideo(SLUG, "landscape", (p) => {
    if (p % 25 === 0) console.log(`progress ${p}%`);
  }, "slides");
  const stat = await fs.stat(r.path);
  const total = r.scenes.reduce((s, x) => s + x.seconds, 0);
  console.log("RENDER_OK", r.path);
  console.log("videoSizeMB:", (stat.size / 1024 / 1024).toFixed(2));
  console.log("totalSeconds:", total, "sceneCount:", r.scenes.length);
  for (const s of r.scenes) {
    console.log(`scene: heading=${s.heading} visual=${s.visual ?? "text"} seconds=${s.seconds}`);
  }
}

main().catch((e) => {
  console.error("VERIFY_FAIL", e);
  process.exit(1);
});
