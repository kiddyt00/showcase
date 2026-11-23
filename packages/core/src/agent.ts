/**
 * Agent 管线：识别来源 → 抓取素材 → DeepSeek 分析 → 产出通用 PageContent
 * 这是"网页创建接口"上游的生产端，两者只通过 PageContent schema 耦合。
 */
import { Analyzer, Diagram, PageContent, AnalyzeRequest, Section } from "./types";
import { pickAnalyzer } from "./analyzers";
import { chat, extractJson } from "./deepseek";
import { uniqueSlugFrom } from "./store";
import { redactPageContent } from "./redact";
import { renderPageDiagrams } from "./diagrams";

const SYSTEM_PROMPT = `你是一个内容分析引擎。根据给定的素材，产出一份结构化的中文分析报告，用于生成介绍网页。

你必须只输出一个 JSON 对象，schema 如下：
{
  "slug": "英文 URL slug，2-5 个英文单词，kebab-case，基于内容主旨，如 superpowers-coding-agent-methodology（只允许小写字母/数字/连字符，不含中文）",
  "title": "内容标题（简洁有吸引力）",
  "summary": "一句话摘要（80 字以内）",
  "category": "内容分类，使用小写英文如 opensource/article/tutorial/news/research",
  "icon": "展示图标 URL，若素材中没有则用空字符串",
  "tags": ["3-6 个主题标签，中文或英文"],
  "sections": [
    {
      "heading": "章节标题",
      "body": "章节正文，Markdown 格式",
      "bullets": ["可选要点列表"],
      "code": { "language": "可选，如 bash", "content": "可选代码/命令" }
    }
  ],
  "metadata": { "任意键值对，如作者/日期/Stars/领域等" },
  "diagrams": [
    {
      "id": "arch",
      "title": "架构图标题",
      "type": "architecture",
      "spec": {
        "type": "architecture",
        "title": "图表标题",
        "nodes": [{ "id": "web", "label": "前端", "sub": "Next.js", "row": 0, "col": 0 }],
        "edges": [["web", "api", "调用", "primary"]]
      }
    }
  ]
}

关于 diagrams（给 SeeCode 图表渲染引擎用的 spec）：
- 额外输出 1-2 张图表，type 从 architecture / flowchart / sequence / data-flow 中选择
- spec 必须是 SeeCode JSON：type、title、nodes 数组（每个节点 {id, label, sub?, row, col}）、edges 数组（每条 [fromId, toId, label?, kind?]）
- 节点 4-8 个，节点 id 唯一，row/col 用整数网格坐标表达布局
- kind 可用 primary / async / link / flow 等，按语义选择

章节应包含（按素材类型灵活调整）：内容概览、核心亮点/主要内容分析、如何应用/使用方法、快速上手或部署指南、适用场景与总结。
分析要深入、实用、面向读者落地，不要空话。sections 至少 4 个。`;

export interface AnalyzeResult {
  page: PageContent;
  analyzer: Analyzer;
}

export async function runAnalysis(req: AnalyzeRequest): Promise<AnalyzeResult> {
  const analyzer = pickAnalyzer(req);

  // 1. 抓取素材
  const material = await analyzer.collect(req.input);

  // 2. LLM 分析，产出结构化结果
  const raw = (
    await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `内容源类型: ${analyzer.name}\n用户输入: ${req.input}\n\n=== 原始素材 ===\n${material}`,
        },
      ],
      { jsonMode: true }
    )
  ).content;

  const parsed = extractJson<{
    slug?: string;
    title: string;
    summary: string;
    category: string;
    icon?: string;
    tags: string[];
    sections: Section[];
    metadata: Record<string, string | number>;
    diagrams?: unknown[];
  }>(raw);

  if (!parsed.title || !Array.isArray(parsed.sections) || !parsed.sections.length) {
    throw new Error("LLM 分析结果不完整，缺少 title 或 sections");
  }

  const page: PageContent = {
    slug: await uniqueSlugFrom(parsed.slug, parsed.title),
    title: parsed.title,
    summary: parsed.summary || "",
    category: parsed.category || analyzer.hints.category,
    source: { type: analyzer.id, name: analyzer.name, url: extractUrl(req.input) },
    icon: parsed.icon || analyzer.hints.icon,
    tags: (parsed.tags || []).slice(0, 8),
    sections: parsed.sections,
    metadata: parsed.metadata || {},
    diagrams: validateDiagrams(parsed.diagrams),
    createdAt: new Date().toISOString(),
    generator: `${analyzer.id}@1`,
  };

  // 页面保存前渲染图表（失败不阻塞）
  await renderPageDiagrams(page);

  // 发布前敏感信息脱敏：直接使用返回的新对象
  const { page: redacted } = redactPageContent(page);

  return { page: redacted, analyzer };
}

function extractUrl(input: string): string | undefined {
  return input.match(/https?:\/\/[^\s]+/)?.[0];
}

const DIAGRAM_TYPES = new Set(["architecture", "flowchart", "sequence", "data-flow"]);

/** 图表基本校验：type 白名单、nodes/edges 为数组、节点 id 唯一；不合格的丢弃 */
function validateDiagrams(raw: unknown): Diagram[] {
  if (!Array.isArray(raw)) return [];
  const out: Diagram[] = [];
  for (const d of raw) {
    if (typeof d !== "object" || d === null) continue;
    const { id, title, type, spec } = d as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) continue;
    if (typeof title !== "string" || !title.trim()) continue;
    if (typeof type !== "string" || !DIAGRAM_TYPES.has(type)) continue;
    if (typeof spec !== "object" || spec === null) continue;
    const s = spec as Record<string, unknown>;
    if (!Array.isArray(s.nodes) || !Array.isArray(s.edges)) continue;
    if (s.nodes.length < 1 || s.nodes.length > 20) continue;
    const ids = new Set<string>();
    for (const n of s.nodes) {
      if (typeof n !== "object" || n === null) continue;
      const nid = (n as Record<string, unknown>).id;
      if (typeof nid !== "string" || !nid) continue;
      if (ids.has(nid)) continue; // 重复 id 视为不合格
      ids.add(nid);
    }
    if (ids.size !== s.nodes.length) continue;
    out.push({ id, title, type, spec });
  }
  return out.slice(0, 4);
}
