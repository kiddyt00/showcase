/**
 * 管理接口鉴权与限流
 * - requireAdmin：校验 x-admin-token header 是否等于 ADMIN_TOKEN；未配置 ADMIN_TOKEN 时默认拒绝（503），公开部署默认安全
 * - rateLimit：进程内滑动窗口限流器
 */
/** 校验管理令牌；通过返回 null，否则返回错误 Response（兼容 Request / NextRequest） */
export function requireAdmin(request: Request): Response | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return Response.json(
      { error: "管理接口未配置：请先在服务端环境变量中设置 ADMIN_TOKEN" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-admin-token");
  if (provided !== token) {
    return Response.json({ error: "无权限：管理令牌缺失或不正确" }, { status: 401 });
  }
  return null;
}

const buckets = new Map<string, number[]>();

/** 滑动窗口限流：windowMs 内最多 limit 次。返回 null 表示放行，否则返回 429 Response */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Response | null {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return Response.json(
      { error: `请求过于频繁，请 ${retryAfter} 秒后重试` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  // 简单清理：桶过大时移除过期键，防止内存无限增长
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return null;
}

/** 从请求中提取限流 key（优先真实 IP，其次 x-forwarded-for） */
export function clientKey(request: Request): string {
  const fwd =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return fwd;
}
