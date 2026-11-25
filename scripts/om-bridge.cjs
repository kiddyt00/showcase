/* OpenMotion 直连桥 v2：create / edit / export / poll 四合一 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const APP = "C:/Users/morefine/OpenMotion/app";

function call(tool, args, cb, timeoutMs = 60000) {
  const child = spawn("C:/nvm4w/nodejs/node.exe", [APP + "/run-mcp.mjs"], {
    cwd: APP, stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  child.stdout.on("data", d => buf += d);
  child.stderr.on("data", () => {});
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dsh", version: "1" } } }) + "\n");
  setTimeout(() => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"), 1200);
  setTimeout(() => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }) + "\n"), 2400);
  setTimeout(() => {
    child.kill();
    for (const l of buf.split("\n").filter(l => l.trim())) {
      try {
        const m = JSON.parse(l);
        if (m.id === 2) { cb(m.result?.content ?? [], m.result?.isError); return; }
      } catch {}
    }
    cb([{ type: "text", text: "no response" }], true);
  }, timeoutMs);
}

function getRev(pid, cb) {
  call("openmotion_get_project", { projectId: pid }, (content) => {
    let rev, vid, vnum;
    for (const c of content) {
      if (c.type !== "text") continue;
      rev = c.text.match(/"revision":"([a-f0-9]{64})"/)?.[1];
      vid = c.text.match(/"currentVersionId":"([a-f0-9-]{36})"/)?.[1];
      vnum = c.text.match(/"currentVersionNumber":(\d+)/)?.[1];
    }
    cb(rev, vid, vnum);
  });
}

module.exports = { call, getRev };
