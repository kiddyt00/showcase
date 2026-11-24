/* 测试：模拟 agent 进程里 spawn hyperframes（在项目目录 cwd） */
const { spawn } = require("node:child_process");
const path = require("node:path");
const projectDir = path.join(__dirname, "..", "public", "videos", "nvidia-57b-record-revenue-bubble-hf");
const bin = path.join(__dirname, "..", "apps", "agent", "node_modules", ".bin", "hyperframes.cmd");
console.log("bin exists:", require("fs").existsSync(bin));
const child = spawn(bin, ["render", ".", "--output", "spawn-test.mp4"], { cwd: projectDir, shell: true });
let out = "", err = "";
child.stdout.on("data", d => { out += d; });
child.stderr.on("data", d => { err += d; });
child.on("close", code => {
  console.log("exit:", code);
  console.log("stdout tail:", out.slice(-400));
  console.log("stderr tail:", err.slice(-400));
});
child.on("error", e => console.log("spawn error:", e.message));
