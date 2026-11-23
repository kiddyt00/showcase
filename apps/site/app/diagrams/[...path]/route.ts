/** 图表静态服务：GET /diagrams/{...path} 从 public/diagrams 返回 SVG（生产 next start 不动态供给 public 新增文件时的兜底） */
import fsp from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { PUBLIC_ASSETS_DIR } from "@showcase/core/paths";

const DIAGRAM_ROOT = path.join(PUBLIC_ASSETS_DIR, "diagrams");

export async function GET(_request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  const rel = segments.map((s) => decodeURIComponent(s)).join("/");
  const filePath = path.resolve(DIAGRAM_ROOT, rel);
  // 防路径穿越：相对路径必须留在 DIAGRAM_ROOT 内
  const relCheck = path.relative(DIAGRAM_ROOT, filePath);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return new Response("Forbidden", { status: 403 });
  }
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });

  const data = await fsp.readFile(filePath);
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": filePath.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "image/svg+xml",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
