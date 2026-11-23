/** 主题 API：GET 读取（可 ?theme=name 预览未持久化主题），PUT 持久化（管理令牌） */
import { requireAdmin, rateLimit, clientKey } from "@showcase/core/auth";
import { THEMES } from "@/theme/themes";
import { readStoredThemeName, themeFilePath } from "@/theme/server";
import fs from "node:fs";

/** GET /api/theme → { name, tokens }；?theme=name 时返回该主题（不校验持久化） */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("theme");
  const theme = THEMES.find((t) => t.name === requested);
  if (requested && !theme) {
    return Response.json({ error: `未知主题: ${requested}` }, { status: 404 });
  }
  const current = theme ?? THEMES.find((t) => t.name === readStoredThemeName()) ?? THEMES[0];
  return Response.json(
    { name: current.name, label: current.label, tokens: current.tokens },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** PUT /api/theme { theme } → 写入 DATA_DIR/theme.json（需 x-admin-token） */
export async function PUT(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const limited = rateLimit(`theme:${clientKey(request)}`, 10, 60_000);
  if (limited) return limited;

  let body: { theme?: string };
  try {
    body = (await request.json()) as { theme?: string };
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const theme = THEMES.find((t) => t.name === body.theme);
  if (!theme) {
    return Response.json(
      { error: `未知主题，可选: ${THEMES.map((t) => t.name).join(", ")}` },
      { status: 400 }
    );
  }
  try {
    fs.writeFileSync(themeFilePath(), JSON.stringify({ theme: theme.name }, null, 2) + "\n");
  } catch (e) {
    return Response.json(
      { error: `写入主题配置失败: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }
  return Response.json({ ok: true, name: theme.name, tokens: theme.tokens });
}
