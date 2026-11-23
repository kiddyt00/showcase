/**
 * Agent 页面管理工具集
 * Agent 作为"页面管理者"，通过这些结构化工具操作网页的各个元素。
 * 每个工具执行后返回操作结果（含更新后的页面状态摘要），供 Agent 继续推理。
 */
import { runAnalysis } from "./agent";
import { startRender } from "./video/queue";
import { renderDiagram } from "./diagrams";
import {
  savePage,
  getPage,
  listPages,
  deletePage,
  slugExists,
  uniqueSlugify,
} from "./store";
import type { PageContent, Section } from "./types";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolContext {
  sessionId: string;
  /** 当前会话正在管理的页面 slug */
  currentSlug?: string;
}

/** 工具定义（OpenAI 兼容格式，DeepSeek 支持） */
export const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "analyze_source",
      description:
        "分析一个内容源并生成新页面。input 可以是 GitHub 仓库（owner/repo 或 URL）、任意文章 URL，或粘贴的原始文本。",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "要分析的内容源" },
          sourceType: {
            type: "string",
            description: "可选，强制指定源类型：github | article | raw-text",
          },
        },
        required: ["input"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_page",
      description:
        "更新当前页面的基本信息元素：标题、摘要、分类、图标、标签。不传的字段保持不变。",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "可选，目标页面 slug，默认当前页面" },
          title: { type: "string" },
          summary: { type: "string" },
          category: {
            type: "string",
            description: "分类，决定渲染模板：opensource/article/tutorial/news/research",
          },
          icon: { type: "string", description: "图标 URL" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_section",
      description: "改写当前页面的某个章节（按索引定位）。可用于按用户要求深化/精简某部分。",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "章节索引，从 0 开始" },
          heading: { type: "string" },
          body: { type: "string", description: "正文，Markdown" },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_section",
      description: "在当前页面新增一个章节。",
      parameters: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          code: {
            type: "object",
            properties: {
              language: { type: "string" },
              content: { type: "string" },
            },
          },
        },
        required: ["heading", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_section",
      description: "删除当前页面的某个章节。",
      parameters: {
        type: "object",
        properties: { index: { type: "integer" } },
        required: ["index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_metadata",
      description: "设置当前页面的元信息键值对，如 stars、作者、领域、发布日期等。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_diagram",
      description:
        "为当前页面新增一张图表（架构图/流程图等），spec 用 SeeCode JSON（type/title/nodes[{id,label,sub?,row,col}]/edges[[from,to,label?,kind?]]），节点 4-8 个、id 唯一。渲染成功后展示在页面\"架构与流程图\"区块。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "图表标题" },
          type: {
            type: "string",
            description: "图表类型：architecture | flowchart | sequence | data-flow",
          },
          spec: {
            type: "object",
            description: "SeeCode spec JSON：{ type, title, nodes: [{id,label,sub?,row,col}], edges: [[from,to,label?,kind?]] }",
          },
          slug: { type: "string", description: "可选，目标页面 slug，默认当前页面" },
        },
        required: ["title", "type", "spec"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pages",
      description: "列出已发布的所有页面（slug + 标题）。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "open_page",
      description: "切换会话当前管理的页面。",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_page",
      description: "删除一个已发布的页面。",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
];

/** 工具执行器：name + JSON 参数 → 结果（返回给 LLM 的文本） */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ result: string; currentSlug?: string; page?: PageContent }> {
  switch (name) {
    case "analyze_source": {
      const { page } = await runAnalysis({
        input: String(args.input),
        sourceType: args.sourceType as string | undefined,
      });
      savePage(page);
      // 自动排队解说视频渲染（横版+竖版，后台执行，完成后详情页直接展示）
      void (async () => {
        for (const o of ["landscape", "portrait"] as const) {
          const r = await startRender(page.slug, o);
          if (r === "busy") await new Promise((r2) => setTimeout(r2, 2000));
          await startRender(page.slug, o);
        }
      })().catch(() => {});
      return {
        result: `已分析并创建页面。slug=${page.slug}，标题="${page.title}"，分类=${page.category}，章节数=${page.sections.length}。解说视频已在后台自动生成，稍后可在详情页查看。已设为当前管理页面。`,
        currentSlug: page.slug,
        page,
      };
    }

    case "update_page": {
      const target = (args.slug as string) ?? ctx.currentSlug;
      const page = requirePage(target);
      if (args.title !== undefined) page.title = String(args.title);
      if (args.summary !== undefined) page.summary = String(args.summary);
      if (args.category !== undefined) page.category = String(args.category);
      if (args.icon !== undefined) page.icon = String(args.icon) || undefined;
      if (Array.isArray(args.tags)) page.tags = args.tags.map(String).slice(0, 8);
      savePage(page);
      return {
        result: `页面 ${page.slug} 信息已更新：${JSON.stringify({ title: page.title, category: page.category, tags: page.tags })}`,
        currentSlug: page.slug,
        page,
      };
    }

    case "update_section": {
      const page = requirePage(ctx.currentSlug);
      const i = Number(args.index);
      if (!page.sections[i]) return { result: `错误：章节索引 ${i} 不存在（共 ${page.sections.length} 个）` };
      const s = page.sections[i];
      if (args.heading !== undefined) s.heading = String(args.heading);
      if (args.body !== undefined) s.body = String(args.body);
      if (args.bullets !== undefined) s.bullets = (args.bullets as string[]).map(String);
      savePage(page);
      return { result: `章节 ${i}「${s.heading}」已更新。`, currentSlug: page.slug, page };
    }

    case "add_section": {
      const page = requirePage(ctx.currentSlug);
      const section: Section = {
        heading: String(args.heading),
        body: String(args.body ?? ""),
        ...(Array.isArray(args.bullets) ? { bullets: (args.bullets as string[]).map(String) } : {}),
        ...(args.code
          ? {
              code: {
                language: String((args.code as Record<string, unknown>).language ?? "bash"),
                content: String((args.code as Record<string, unknown>).content ?? ""),
              },
            }
          : {}),
      };
      page.sections.push(section);
      savePage(page);
      return {
        result: `已新增章节「${section.heading}」，当前共 ${page.sections.length} 个章节。`,
        currentSlug: page.slug,
        page,
      };
    }

    case "delete_section": {
      const page = requirePage(ctx.currentSlug);
      const i = Number(args.index);
      if (!page.sections[i]) return { result: `错误：章节索引 ${i} 不存在` };
      const [removed] = page.sections.splice(i, 1);
      savePage(page);
      return { result: `已删除章节「${removed.heading}」。`, currentSlug: page.slug, page };
    }

    case "set_metadata": {
      const page = requirePage(ctx.currentSlug);
      page.metadata[String(args.key)] = String(args.value);
      savePage(page);
      return { result: `元信息 ${args.key}=${args.value} 已设置。`, currentSlug: page.slug, page };
    }

    case "add_diagram": {
      const page = requirePage((args.slug as string) ?? ctx.currentSlug);
      const title = String(args.title ?? "").trim();
      const type = String(args.type ?? "").trim();
      if (!title || !DIAGRAM_TYPES.has(type)) {
        return { result: `错误：title 必填，type 必须是 ${[...DIAGRAM_TYPES].join("/")}` };
      }
      const spec = args.spec;
      const check = validateDiagramSpec(spec);
      if (!check.ok) return { result: `错误：spec 不合格（${check.reason}）` };
      const existing = page.diagrams ?? [];
      let id = type === "architecture" ? "arch" : type;
      let n = 2;
      while (existing.some((d) => d.id === id)) id = `${type}-${n++}`;
      const diagram = await renderDiagram(page.slug, { id, title, type, spec });
      page.diagrams = [...existing, diagram];
      savePage(page);
      return {
        result: diagram.svgUrl
          ? `图表「${title}」已添加并渲染成功（${diagram.svgUrl}），页面共 ${page.diagrams.length} 张图表。`
          : `图表「${title}」已保存，但渲染失败（页面稍后显示占位提示）。`,
        currentSlug: page.slug,
        page,
      };
    }

    case "list_pages": {
      const pages = listPages(50);
      return {
        result: pages.length
          ? pages.map((p) => `${p.slug} | ${p.title} | ${p.category}`).join("\n")
          : "还没有任何页面。",
      };
    }

    case "open_page": {
      const page = getPage(String(args.slug));
      if (!page) return { result: `错误：页面 ${args.slug} 不存在` };
      return { result: `已切换到页面 ${page.slug}（${page.title}）。`, currentSlug: page.slug, page };
    }

    case "delete_page": {
      const slug = String(args.slug ?? ctx.currentSlug);
      const ok = deletePage(slug);
      return ok
        ? { result: `页面 ${slug} 已删除。`, currentSlug: ctx.currentSlug === slug ? undefined : ctx.currentSlug }
        : { result: `错误：页面 ${slug} 不存在` };
    }

    default:
      return { result: `未知工具：${name}` };
  }
}

function requirePage(slug?: string): PageContent {
  if (!slug) throw new Error("当前没有管理的页面，请先用 analyze_source 或 open_page 指定");
  const page = getPage(slug);
  if (!page) throw new Error(`页面 ${slug} 不存在`);
  return page;
}

const DIAGRAM_TYPES = new Set(["architecture", "flowchart", "sequence", "data-flow"]);

interface SpecCheck {
  ok: boolean;
  reason?: string;
}

/** SeeCode spec 基本校验 */
function validateDiagramSpec(spec: unknown): SpecCheck {
  if (typeof spec !== "object" || spec === null) return { ok: false, reason: "spec 必须是对象" };
  const s = spec as Record<string, unknown>;
  if (!Array.isArray(s.nodes) || !s.nodes.length) return { ok: false, reason: "nodes 必须是非空数组" };
  if (!Array.isArray(s.edges)) return { ok: false, reason: "edges 必须是数组" };
  const ids = new Set<string>();
  for (const n of s.nodes) {
    const id = typeof n === "object" && n !== null ? (n as Record<string, unknown>).id : undefined;
    if (typeof id !== "string" || !id) return { ok: false, reason: "每个节点需要字符串 id" };
    if (ids.has(id)) return { ok: false, reason: `节点 id 重复：${id}` };
    ids.add(id);
  }
  for (const e of s.edges) {
    if (!Array.isArray(e) || e.length < 2) return { ok: false, reason: "每条边是 [from, to, ...]" };
    if (!ids.has(String(e[0])) || !ids.has(String(e[1]))) {
      return { ok: false, reason: `边引用了不存在的节点：${e[0]} → ${e[1]}` };
    }
  }
  return { ok: true };
}

export { slugExists, uniqueSlugify };
