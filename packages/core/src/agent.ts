/**
 * Agent 管线：识别来源 → 抓取素材 → DeepSeek 分析 → 产出通用 PageContent
 * 这是"网页创建接口"上游的生产端，两者只通过 PageContent schema 耦合。
 */
import { Analyzer, Diagram, PageContent, AnalyzeRequest, Section } from "./types";
import { pickAnalyzer } from "./analyzers";
import { chat, extractJson } from "./deepseek";
import { uniqueSlugFrom, listPageSummaries, getPage } from "./store";
import { redactPageContent } from "./redact";
import { renderPageDiagrams } from "./diagrams";

const SYSTEM_PROMPT = `你是一个面向科普读者和技术爱好者的内容分析引擎。产出结构化中文分析报告，用于生成高质量的知识分享网页。

## 内容质量硬规则（违反任何一条即视为不合格产出）
1. 章节标题必须内容化：标题要能独立传达该章结论，如"一条命令跑起 70B 模型""为什么比 Docker Compose 快 3 倍"。严禁使用"内容概览""核心亮点与主要内容分析""适用场景与总结"这类占位模板词。
2. 每个关键论断必须带数字：stars/性能倍数/价格/版本号/用户量。科普文没有数字就没有说服力。
3. "上手/部署"类章节必须包含从素材中提取的真实命令块（code 字段），每条命令配一句预期结果说明；该章节正文 ≥300 字，是全文最详实的部分。
4. 正文用类比解释抽象概念（"Ollama 之于大模型，就像 Docker 之于应用"），每个抽象概念至少一个类比。
5. 信息价值优先：如果素材里没有 2~3 个有真实差异的同类项目，就不要硬造对比表格——空对比比没对比更伤可信度。

## 结构多样性铁律（违反 = 与站内已有文章同质，不合格）
禁止给所有文章套同一个骨架。章节结构必须由内容本身的叙事逻辑决定，而不是由 category 公式决定。写作前先问自己：这个内容最适合什么讲法？
- **有明确流程/步骤** → 按"跟着做一遍"的顺序走（但分段要跟真实步骤走，不要平均切）
- **是事件/新闻** → 按重要性倒金字塔：最先给最硬的事实和数字 → 各方反应与冲突 → 争议与反方证据 → 对读者意味着什么
- **是观点/方法论** → 先立靶子（常见误解）→ 逐条击破 → 给出替代框架
- **是对比评测** → 先给结论表 → 逐维度展开 → 明确说"什么人选什么"
- **是工具/库** → 先演示它能做什么（效果前置）→ 再讲为什么能做到 → 最后才是怎么装
- 找不到明显叙事逻辑时，用"读者最想问的 5 个问题"组织章节（每个 heading 就是一个问题）
硬性要求：
- 相邻两篇文章的结构不应雷同；不要每章都"标题：副标题"式对仗
- sections 4~6 个；每章正文 300~700 字之间波动（信息密度决定长短，不要为凑字数灌水）
- 表格/代码块/要点列表是表达工具，按需使用，不要每篇都集齐三件套
- 每章开头的第一句话直接给该章结论，不要铺垫

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
- 素材适合配图时（流程/架构/数据流有明确结构）才输出 1-2 张图表；内容是纯观点/新闻时可不输出
- type 从 architecture / flowchart / sequence / data-flow 中选择
- spec 必须是 SeeCode JSON：type、title、nodes 数组（每个节点 {id, label, sub?, row, col}）、edges 数组（每条 [fromId, toId, label?, kind?]）
- 节点 4-8 个，节点 id 唯一，row/col 用整数网格坐标表达布局
- kind 可用 primary / async / link / flow 等，按语义选择

关于章节配图（imageQuery）：
- 内容讲具体实物（产品/芯片/设备/城市/场景）时，可为该章节输出 "imageQuery": "英文搜索词（具体、可搜）"，如 "data center server room"、"graphics card closeup"
- 观点/流程/代码类章节不要配图；最多 2 个章节带 imageQuery；图片来自免费图库（Pexels），管线自动下载并回填 image 字段
- 搭配 "imageCaption"（中文图注 ≤20 字）说明图片与正文的关系

sections 至少 4 个。分析要深入、实用、面向读者落地，不要空话。`;

export interface AnalyzeResult {
  page: PageContent;
  analyzer: Analyzer;
}

export async function runAnalysis(
  req: AnalyzeRequest,
  onStage?: (stage: string, progress: number) => void,
  signal?: AbortSignal
): Promise<AnalyzeResult> {
  const analyzer = pickAnalyzer(req);

  // 1. 抓取素材
  onStage?.("抓取素材", 5);
  const material = await analyzer.collect(req.input);
  onStage?.("AI 分析生成中", 20);

  // 2. LLM 分析，产出结构化结果；解析失败时带错误反馈重试 1 次
  // 站内已有文章的章节骨架：喂给 LLM 主动避同质（只取最近 6 篇的 heading 序列）
  let skeletonText = "";
  try {
    const recent = listPageSummaries(6);
    if (recent.length) {
      const lines = recent.map((p) => {
        const full = getPage(p.slug);
        const heads = (full?.sections ?? []).map((s) => s.heading).join(" / ");
        return `《${p.title.slice(0, 24)}》: ${heads}`;
      });
      skeletonText = `\n\n=== 站内最近文章的章节骨架（你的新文章结构不得与它们雷同，尤其第一段的处理方式） ===\n${lines.join("\n")}`;
    }
  } catch {
    /* 拿不到已有文章时跳过该约束 */
  }

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `内容源类型: ${analyzer.name}\n用户输入: ${req.input}\n\n=== 原始素材 ===\n${material}${skeletonText}`,
    },
  ];
  let parsed: {
    slug?: string;
    title: string;
    summary: string;
    category: string;
    icon?: string;
    tags: string[];
    sections: Section[];
    metadata: Record<string, string | number>;
    diagrams?: unknown[];
  };
  for (let attempt = 0; ; attempt++) {
    const raw = (await chat(messages, { jsonMode: true, signal })).content;
    try {
      parsed = extractJson<{
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
      break;
    } catch (err) {
      if (attempt >= 2) {
        // 两轮修复均失败：用素材确定性兜底（章节来自 analyzer 素材本身），不让任务直接死掉
        console.warn("[agent] 两轮 JSON 修复失败，降级为素材兜底文章:", err instanceof Error ? err.message : err);
        parsed = fallbackArticleFromMaterial(analyzer, material, req.input);
        break;
      }
      console.warn("[agent] 首轮输出不是合法 JSON，反馈重试:", err instanceof Error ? err.message : err);
      messages.push({
        role: "assistant" as const,
        content: raw.slice(0, 500),
      });
      messages.push({
        role: "user" as const,
        content:
          "你上一轮输出的是素材里的代码/命令，这不是本任务要的东西。任务：根据素材写一篇结构化文章。输出必须是且仅是一个 JSON 对象（不要 markdown 围栏、不要代码示例、不要解释）。\n\n正确输出的样子（示意，字段值必须替换为基于素材的真实内容）：\n{\"slug\":\"example-slug\",\"title\":\"示例标题\",\"summary\":\"一句话摘要\",\"category\":\"opensource\",\"icon\":\"\",\"tags\":[\"标签\"],\"sections\":[{\"heading\":\"结论式章节标题\",\"body\":\"章节正文，Markdown\"}],\"metadata\":{\"key\":\"value\"},\"diagrams\":[]}\n\n现在基于前面的原始素材，重新输出完整 JSON。",
      });
    }
  }
  const { slug: parsedSlug, title, summary, category, icon, tags, sections, metadata, diagrams } = parsed as {
    slug?: string; title: string; summary: string; category: string; icon?: string;
    tags: string[]; sections: Section[]; metadata: Record<string, string | number>; diagrams?: unknown[];
  };

  if (!title || !Array.isArray(sections) || !sections.length) {
    throw new Error("LLM 分析结果不完整，缺少 title 或 sections");
  }

  const page: PageContent = {
    slug: await uniqueSlugFrom(parsedSlug, title),
    title,
    summary: summary || "",
    category: category || analyzer.hints.category,
    source: { type: analyzer.id, name: analyzer.name, url: extractUrl(req.input) },
    icon: icon || analyzer.hints.icon,
    tags: (tags || []).slice(0, 8),
    sections,
    metadata: metadata || {},
    diagrams: validateDiagrams(diagrams),
    createdAt: new Date().toISOString(),
    generator: `${analyzer.id}@1`,
  };

  // 页面保存前渲染图表；失败回喂 LLM 修正 spec，最多重试 1 次
  onStage?.("渲染图表", 70);
  let renderResult = await renderPageDiagrams(page);
  if (renderResult.failed.length) {
    for (const f of renderResult.failed) {
      try {
        const fixRaw = (
          await chat(
            [
              {
                role: "system",
                content:
                  "你是 SeeCode 图表 spec 修正器。根据渲染错误修正 JSON spec，只输出修正后的完整 JSON 对象，不要解释。",
              },
              {
                role: "user",
                content: `渲染错误：${f.error}\n\n原始 spec：${JSON.stringify(f.diagram.spec)}\n\n请修正（常见错误：edges 引用不存在的节点 id、edges[3] kind 非法（只允许 default/primary/link/async/return/muted 等，禁止 dashed/solid 这类 CSS 值）、row/col 越界、缺少必填字段、type 拼写错误）。`,
              },
            ],
            { jsonMode: true, signal }
          )
        ).content;
        f.diagram.spec = extractJson(fixRaw);
      } catch (fixErr) {
        console.warn("[diagram] spec 修正失败:", fixErr);
      }
    }
    // 修正后整体重渲染一轮
    renderResult = await renderPageDiagrams(page);
    for (const f of renderResult.failed) {
      console.warn(`[diagram] ${f.diagram.id} 重试仍失败: ${f.error}`);
    }
  }

  // 章节配图：LLM 输出的 imageQuery → Pexels 下载 → 回填 image/imageCaption（免费图库，无 key 时跳过）
  onStage?.("抓取配图", 80);
  try {
    const { fetchStockPhotoRel } = await import("./video/stock");
    for (const sec of page.sections) {
      const q = (sec as Section & { imageQuery?: unknown }).imageQuery;
      if (typeof q !== "string" || !q.trim()) continue;
      const rel = await fetchStockPhotoRel(q, "landscape", `videos/${page.slug}-assets/img-${page.sections.indexOf(sec)}.jpg`);
      if (rel) {
        sec.image = rel;
        const cap = (sec as Section & { imageCaption?: unknown }).imageCaption;
        if (typeof cap === "string" && cap.trim()) sec.imageCaption = cap.trim().slice(0, 40);
        console.warn(`[article] 章节「${sec.heading.slice(0, 16)}」配图 ${rel}（${q}）`);
      }
    }
  } catch (err) {
    console.warn(`[article] 配图获取跳过: ${err instanceof Error ? err.message : err}`);
  }

  // 发布前敏感信息脱敏：直接使用返回的新对象
  onStage?.("发布", 90);
  const { page: redacted } = redactPageContent(page);

  return { page: redacted, analyzer };
}

function extractUrl(input: string): string | undefined {
  return input.match(/https?:\/\/[^\s]+/)?.[0];
}

/** LLM 两轮都失败时的素材兜底文章：章节直接来自素材的原文切块，保证任务不空手而归 */
function fallbackArticleFromMaterial(
  analyzer: { id: string; name: string; hints: { category: string; icon?: string } },
  material: string,
  input: string
): {
  slug?: string;
  title: string;
  summary: string;
  category: string;
  icon?: string;
  tags: string[];
  sections: Section[];
  metadata: Record<string, string | number>;
  diagrams: unknown[];
} {
  // 从素材提取可用文本块（跳过元信息行）
  const blocks = material
    .split(/\n{2,}/)
    .map((b) => b.replace(/^=== .* ===$/gm, "").trim())
    .filter((b) => b.length > 120);
  const titleLine = material.match(/页面标题: (.+)/)?.[1] ?? material.match(/仓库: (.+)/)?.[1] ?? input.slice(0, 40);
  const sections: Section[] = blocks.slice(0, 4).map((b, i) => ({
    heading: `素材节选 ${i + 1}`,
    body: b.slice(0, 700),
  }));
  return {
    title: titleLine.slice(0, 60),
    summary: `${analyzer.name}的自动分析（AI 结构化失败，当前为素材节选版本，可让 Agent 重新生成）。`,
    category: analyzer.hints.category,
    icon: analyzer.hints.icon,
    tags: [],
    sections: sections.length ? sections : [{ heading: "原始素材", body: material.slice(0, 900) }],
    metadata: { source: input.slice(0, 80), degraded: "fallback" },
    diagrams: [],
  };
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
