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
      "var(--font-playfair), 'Playfair Display', Georgia, 'Times New Roman', 'Songti SC', 'STSong', serif",
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

/** 主题注册表：新增主题往这里加即可 */
export const THEMES: ThemeDef[] = [editorial];

export const DEFAULT_THEME = editorial.name;

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
