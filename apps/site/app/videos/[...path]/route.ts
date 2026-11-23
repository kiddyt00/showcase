/** 视频静态服务：GET /videos/{...path} 从 public/videos 流式返回（支持 Range） */
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { PUBLIC_ASSETS_DIR } from "@showcase/core/paths";

const VIDEO_ROOT = path.join(PUBLIC_ASSETS_DIR, "videos");

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  const rel = segments.map((s) => decodeURIComponent(s)).join("/");
  const filePath = path.resolve(VIDEO_ROOT, rel);
  // 防路径穿越：相对路径必须留在 VIDEO_ROOT 内
  const relCheck = path.relative(VIDEO_ROOT, filePath);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    return new Response("Forbidden", { status: 403 });
  }
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const size = stat.size;
  const range = request.headers.get("range");
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  });

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1]) : 0;
      const end = m[2] ? Math.min(parseInt(m[2]), size - 1) : size - 1;
      if (start < size && start <= end) {
        headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
        headers.set("Content-Length", String(end - start + 1));
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers,
        });
      }
    }
  }

  headers.set("Content-Length", String(size));
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}
