/**
 * 通用内容 PageContent Schema
 *
 * 设计原则：不绑定任何特定内容源（GitHub 只是其中一种）。
 * 行业差异通过 category（分类）和 metadata（自由扩展字段）承载。
 */

/** 一个内容章节 */
export interface Section {
  /** 章节标题，如 "如何快速部署"、"核心概念解析" */
  heading: string;
  /** 章节正文，支持 Markdown */
  body: string;
  /** 可选：章节内的要点列表 */
  bullets?: string[];
  /** 可选：代码块（部署命令等） */
  code?: { language: string; content: string };
  /** 可选：章节配图（管线按 imageQuery 从 Pexels 下载后填充），本地路径如 videos/{slug}-assets/img-{i}.jpg */
  image?: string;
  /** 可选：配图说明（渲染为图注） */
  imageCaption?: string;
  /** 分析输入：英文图片搜索词（管线下载后转成 image 字段，不落库） */
  imageQuery?: string;
}

/** 一张图表：spec 存 SeeCode JSON，htmlUrl 为交互式 HTML（iframe 嵌入），svgUrl 为静态 SVG（视频用）；渲染失败时均缺省 */
export interface Diagram {
  id: string;
  title: string;
  type: string;
  /** SeeCode 图表引擎的 spec JSON */
  spec: unknown;
  /** 渲染产物 SVG 路径，如 /diagrams/{slug}/{id}.svg */
  svgUrl?: string;
  /** 动画 MP4 路径（SeeCode 逐步绘制导出），如 /diagrams/{slug}/{id}.mp4；导出失败时缺省 */
  mp4Url?: string;
  htmlUrl?: string;
}

/** 通用页面内容 —— Agent 分析产出的标准结构 */
export interface PageContent {
  /** 唯一 slug，URL 路径 /show/{slug} */
  slug: string;
  /** 内容标题 */
  title: string;
  /** 一句话摘要 */
  summary: string;
  /** 内容分类，决定渲染模板，如 "opensource" | "article" | "tutorial" | "news" */
  category: string;
  /** 来源信息 */
  source: {
    /** 源类型标识，对应 analyzer 的 id，如 "github" | "article" */
    type: string;
    /** 原始来源 URL */
    url?: string;
    /** 来源名称，如 "GitHub" */
    name?: string;
  };
  /** 展示图标 URL（项目 logo / 网站图标），可为空则用默认图标 */
  icon?: string;
  /** 技术栈/主题标签 */
  tags: string[];
  /** 正文章节 */
  sections: Section[];
  /** 图表列表（架构图/流程图等，由 SeeCode 引擎渲染） */
  diagrams?: Diagram[];
  /** 历史 slug 别名（如迁移前的中文 slug），用于 308 永久重定向保 SEO 权重 */
  aliases?: string[];
  /** 自由扩展元信息（stars、作者、发布日期等，各行业自定义） */
  metadata: Record<string, string | number | undefined>;
  /** 生成时间 */
  createdAt: string;
  /** 由哪个 analyzer 版本生成 */
  generator: string;
}

/** Agent 分析请求 */
export interface AnalyzeRequest {
  /** 用户输入，如 "分析一下 vercel/next.js" 或一段文章内容/URL */
  input: string;
  /** 强制指定 analyzer（可选），不传则自动识别 */
  sourceType?: string;
}

/** Analyzer 插件接口 —— 新行业只需实现并注册 */
export interface Analyzer {
  /** 插件标识 */
  id: string;
  /** 人类可读名称 */
  name: string;
  /** 判断输入是否属于本源（用于自动识别），返回 0~1 置信度 */
  match(input: string): number;
  /** 抓取/整理原始素材，供 LLM 分析 */
  collect(input: string): Promise<string>;
  /** 本源建议的 category 与 metadata 约定 */
  hints: {
    category: string;
    icon?: string;
  };
}

/** 存储记录 */
export interface StoredPage extends PageContent {}
