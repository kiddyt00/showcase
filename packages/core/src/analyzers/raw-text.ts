/** Analyzer 插件：纯文本兜底（粘贴的文章/笔记/任意行业资料） */
import { Analyzer } from "../types";

export const rawTextAnalyzer: Analyzer = {
  id: "raw-text",
  name: "通用文本/文章",
  hints: { category: "article" },

  match(): number {
    return 0.01; // 兜底：永远可匹配，但优先级最低
  },

  async collect(input: string): Promise<string> {
    return `用户提供的原始文本：\n\n${input.slice(0, 12000)}`;
  },
};
