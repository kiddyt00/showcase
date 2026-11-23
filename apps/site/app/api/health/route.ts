/** 健康检查：供部署平台探活；不做限流、不做鉴权 */
import { NextResponse } from "next/server";
import { db } from "@showcase/core/store";

const STARTED_AT = Date.now();

export async function GET() {
  let dbStatus: "ok" | "error" = "error";
  try {
    db.prepare("SELECT 1").get();
    dbStatus = "ok";
  } catch {
    dbStatus = "error";
  }
  return NextResponse.json({
    ok: dbStatus === "ok",
    db: dbStatus,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
}
