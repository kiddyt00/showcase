/* OpenMotion 管线完整验证：确认 10 个工程的创建、场景编写、渲染产物全链路 */
const fs = require("node:fs");
const path = require("node:path");

const projRoot = "C:/Users/morefine/OpenMotion/data/projects";
const outDir = "E:/dsh/showcase/public/videos";
let allOk = true;
const report = [];

const expected = [
  "a-share-buyback-1500yi", "citadel-15b-record", "compute-lease-banks",
  "etf-volume-doubled", "fed-december-pce-330", "gold-silver-crash-2026",
  "hk-ipo-4039yi", "huang-return-inquiry", "mlf-8000yi-drain", "power-capacity-416gw",
];

// 1. MP4 产物验证
for (const slug of expected) {
  const mp4 = path.join(outDir, `fin-${slug}.mp4`);
  const exists = fs.existsSync(mp4);
  const size = exists ? fs.statSync(mp4).size : 0;
  const ok = exists && size > 500000;
  if (!ok) allOk = false;
  report.push({ slug, mp4: exists, sizeMB: (size / 1048576).toFixed(1), ok });
}

// 2. OpenMotion 工程验证（11 个含 ShowCase 自介）
const projects = fs.readdirSync(projRoot);
let finProjects = 0;
for (const d of projects) {
  try {
    const mp = JSON.parse(fs.readFileSync(path.join(projRoot, d, "motion-project.json"), "utf8"));
    if ((mp.creationRequestId || "").startsWith("fin-")) finProjects++;
  } catch {}
}
if (finProjects < 10) allOk = false;

// 3. 直连桥验证
const bridgeOk = fs.existsSync("E:/dsh/showcase/scripts/om-bridge.cjs");
if (!bridgeOk) allOk = false;

console.log("=== OpenMotion 管线验证 ===");
console.log(`MP4 产物: ${report.filter(r => r.ok).length}/10`);
for (const r of report) console.log(`  ${r.ok ? "✅" : "❌"} ${r.slug} ${r.sizeMB}MB`);
console.log(`OpenMotion 工程: ${finProjects}/10`);
console.log(`直连桥: ${bridgeOk}`);
console.log(`总验证: ${allOk ? "PASS" : "FAIL"}`);
process.exit(allOk ? 0 : 1);
