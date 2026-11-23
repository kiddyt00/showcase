/** Analyzer 插件：通用网页文章（任意行业） */
import { Analyzer } from "../types";
import { safeFetch } from "../safe-fetch";

export const articleAnalyzer: Analyzer = {
  id: "article",
  name: "网页文章",
  hints: { category: "article" },

  match(input: string): number {
    if (/^https?:\/\/[^\s]+$/.test(input.trim())) return 0.9;
    if (/https?:\/\//.test(input)) return 0.5;
    return 0;
  },

  async collect(input: string): Promise<string> {
    const url = input.trim().match(/https?:\/\/[^\s]+/)?.[0];
    if (!url) throw new Error(`无法从输入中提取 URL: ${input}`);
    const { contentType, text } = await safeFetch(url, {
      timeoutMs: 15000,
      maxBytes: 2_000_000,
      headers: { "User-Agent": "universal-showcase" },
    });
    if (contentType.includes("application/json")) {
      return `URL: ${url}\n\n=== JSON 内容（截取前 12000 字符） ===\n${text.slice(0, 12000)}`;
    }
    const html = text;
    const title =
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? url;
    const body = htmlToText(html);
    return `URL: ${url}\n页面标题: ${title}\n\n=== 正文纯文本（截取前 12000 字符） ===\n${body.slice(0, 12000)}`;
  },
};

/** 极简 HTML → 纯文本（去 script/style/标签） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}
