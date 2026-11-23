/** 服务端主题读取：DATA_DIR/theme.json（无文件 / 非法值时回退默认主题） */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@showcase/core/paths";
import { getTheme, DEFAULT_THEME, tokensToStyle, type ThemeDef, type ThemeTokens } from "./themes";

const THEME_FILE = path.join(DATA_DIR, "theme.json");

export interface StoredTheme {
  theme: string;
}

export function readStoredThemeName(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(THEME_FILE, "utf8")) as StoredTheme;
    if (raw && typeof raw.theme === "string") return raw.theme;
  } catch {
    /* 无文件或解析失败 → 默认主题 */
  }
  return DEFAULT_THEME;
}

export function themeFilePath(): string {
  return THEME_FILE;
}

/** 读取完整主题定义（含 ?theme= 覆盖优先级由调用方处理） */
export function resolveTheme(override?: string | null): ThemeDef {
  return getTheme(override ?? readStoredThemeName());
}

export function themeStyle(theme: ThemeDef): Record<string, string> {
  return tokensToStyle(theme.tokens);
}

export type { ThemeTokens };
