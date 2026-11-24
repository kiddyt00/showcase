/** 主题模板系统：Token 定义 + 主题注册表 */

/** 主题视觉 Token：值即 CSS 变量值（颜色 / 字体栈 / 版式开关） */
export interface ThemeTokens {
  /** 标题字体栈（衬线感） */
  "--font-display": string;
  /** 正文字体栈 */
  "--font-body": string;
  /** 页面背景 */
  "--bg": string;
  /** 主文字色 */
  "--fg": string;
  /** 强调色 */
  "--accent": string;
  /** 次要文字色 */
  "--muted": string;
  /** 卡片背景 */
  "--card": string;
  /** 边框色 */
  "--border": string;
  /** 版式：圆角大小 */
  radius: string;
  /** 版式：标题是否用衬线字体 */
  serifHeadings: boolean;
}

export interface ThemeDef {
  name: string;
  label: string;
  tokens: ThemeTokens;
}

/** editorial：杂志编辑风（浅色、衬线大标题、细边卡片、深红强调） */
const editorial: ThemeDef = {
  name: "editorial",
  label: "Editorial · 杂志编辑",
  tokens: {
    "--font-display":
      "var(--font-playfair), 'Playfair Display', var(--font-noto-serif-sc), 'Noto Serif SC', 'Songti SC', 'STSong', Georgia, 'Times New Roman', serif",
    "--font-body":
      "var(--font-geist-sans), system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    "--bg": "#faf9f6",
    "--fg": "#1c1917",
    "--accent": "#b3452e",
    "--muted": "#78716c",
    "--card": "#ffffff",
    "--border": "#e7e2da",
    radius: "0.125rem",
    serifHeadings: true,
  },
};

/** swiss：瑞士国际主义/新粗野（纯白、近黑、国际橙、无圆角、暴露结构感） */
const swiss: ThemeDef = {
  name: "swiss",
  label: "Swiss · 瑞士国际主义",
  tokens: {
    "--font-display":
      "'Archivo', 'Helvetica Neue', var(--font-geist-sans), 'PingFang SC', 'Noto Sans SC', sans-serif",
    "--font-body":
      "var(--font-geist-mono), ui-monospace, 'PingFang SC', 'Noto Sans SC', monospace",
    "--bg": "#ffffff",
    "--fg": "#111111",
    "--accent": "#ff4d00",
    "--muted": "#6b7280",
    "--card": "#ffffff",
    "--border": "#111111",
    radius: "0rem",
    serifHeadings: false,
  },
};

/** 主题注册表：新增主题往这里加即可 */
export const THEMES: ThemeDef[] = [editorial, swiss];

export const DEFAULT_THEME = swiss.name;

export function getTheme(name: string | undefined | null): ThemeDef {
  return THEMES.find((t) => t.name === name) ?? THEMES[0];
}

/** 把 tokens 序列化为 CSSProperties 对象（<html style={{...}}> SSR 内联，无闪烁） */
export function tokensToStyle(tokens: ThemeTokens): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) {
    if (typeof v === "boolean") {
      // 版式开关映射为派生变量：serifHeadings → --heading-font
      if (k === "serifHeadings" && v) {
        style["--heading-font"] = "var(--font-display)";
      }
      continue;
    }
    if (k === "radius") {
      style["--radius"] = v;
      continue;
    }
    style[k] = v;
  }
  return style;
}
