/**
 * 栏目（collections）：栏目 = PageContent.category
 * - 有 DATA_DIR/collections.json 时按配置（id/名称/描述/顺序）
 * - 无配置时从现有页面 category 自动聚合（内置常见分类中文名）
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@showcase/core/paths";
import { listPageSummaries } from "@showcase/core/store";

export interface Collection {
  id: string;
  name: string;
  description?: string;
  order: number;
}

const COLLECTIONS_FILE = path.join(DATA_DIR, "collections.json");

/** 常见分类的展示名（自动聚合模式用） */
const CATEGORY_LABELS: Record<string, string> = {
  opensource: "开源项目",
  article: "文章解析",
  tutorial: "教程",
  news: "资讯",
  research: "研究",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function getCollections(): Collection[] {
  // 1) 配置文件优先
  try {
    const raw = JSON.parse(fs.readFileSync(COLLECTIONS_FILE, "utf8")) as Array<{
      id?: string;
      name?: string;
      description?: string;
      order?: number;
    }>;
    if (Array.isArray(raw) && raw.length) {
      return raw
        .filter((c) => typeof c.id === "string" && c.id)
        .map((c, i) => ({
          id: c.id!,
          name: c.name || categoryLabel(c.id!),
          description: c.description,
          order: typeof c.order === "number" ? c.order : i,
        }))
        .sort((a, b) => a.order - b.order);
    }
  } catch {
    /* 无配置文件 → 自动聚合 */
  }
  // 2) 从现有页面 category 聚合，按首次出现顺序
  const seen: string[] = [];
  for (const p of listPageSummaries(500)) {
    if (!seen.includes(p.category)) seen.push(p.category);
  }
  return seen.map((id, i) => ({ id, name: categoryLabel(id), order: i }));
}

/** 把页面摘要按栏目分组（保持栏目顺序） */
export function groupByCollection<T extends { category: string }>(
  pages: T[],
  collections: Collection[]
): Array<{ collection: Collection; pages: T[] }> {
  return collections
    .map((collection) => ({
      collection,
      pages: pages.filter((p) => p.category === collection.id),
    }))
    .filter((g) => g.pages.length > 0);
}

/** 阅读时长估算：正文字数 / 400 字每分钟，最少 1 分钟 */
export function readMinutes(sections: Array<{ heading?: string; body?: string; bullets?: string[] }>): number {
  const chars = sections.reduce(
    (n, s) => n + (s.body?.length ?? 0) + (s.bullets?.join("").length ?? 0),
    0
  );
  return Math.max(1, Math.round(chars / 400));
}
