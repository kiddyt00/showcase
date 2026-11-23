/**
 * SSRF 防护的安全 fetch：
 * - 仅允许 http/https
 * - 拒绝 IP 字面量与私有/链路本地/回环地址（10.x、172.16-31、192.168、127.x、169.254、::1、fc00::/7 等）
 * - redirect: "manual"，最多跟随 3 次 3xx，每次跳转前重新校验目标
 * - 超时 AbortSignal.timeout；流式读取 body，超过 maxBytes 抛错
 */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  /** 已读取且未超限的响应体文本 */
  text: string;
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4 字面量（含私有段）与 IPv4-mapped IPv6
  if (isPrivateIPv4(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // 其余公网 IPv4 字面量也拒绝（防 DNS 绕过校验困难）
  // IPv6：回环、链路本地、唯一本地（fc00::/7）、IPv4-mapped
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true; // fe80::/10
  if (/^f[cd]/.test(host)) return true; // fc00::/7
  if (host.startsWith("::ffff:")) {
    return isForbiddenHost(host.slice(7));
  }
  return false;
}

function assertUrlSafe(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`无效的 URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`不支持的协议: ${url.protocol}`);
  }
  if (isForbiddenHost(url.hostname)) {
    throw new Error(`禁止访问内网/保留地址: ${url.hostname}`);
  }
  return url;
}

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const { timeoutMs = 15000, maxBytes = 2_000_000, headers = {} } = options;

  let current = assertUrlSafe(url);
  let res: Response | null = null;

  // 手动跟随重定向，最多 3 次，每次重新校验
  for (let i = 0; i <= 3; i++) {
    res = await fetch(current, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      const next = new URL(location, current);
      // 释放上一个响应
      try {
        await res.body?.cancel();
      } catch {}
      if (i === 3) throw new Error("重定向次数过多");
      current = assertUrlSafe(next.toString());
      continue;
    }
    break;
  }
  if (!res) throw new Error("请求失败");
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {}
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    try {
      await res.body?.cancel();
    } catch {}
    throw new Error(`响应体超过大小限制 ${maxBytes} 字节`);
  }

  // 流式读取，累计字节防超限
  const reader = res.body?.getReader();
  if (!reader) return { status: res.status, contentType, text: "" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`响应体超过大小限制 ${maxBytes} 字节`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return {
    status: res.status,
    contentType,
    text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
  };
}
