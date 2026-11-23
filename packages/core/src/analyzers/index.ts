/**
 * Analyzer 注册表与调度
 *
 * 新增行业内容源只需两步：
 *   1. 在 analyzers/ 下新建文件，实现 Analyzer 接口
 *   2. 在下方数组中注册
 * 无需改动任何其它代码。
 */
import { Analyzer, AnalyzeRequest } from "../types";
import { githubAnalyzer } from "./github";
import { articleAnalyzer } from "./article";
import { rawTextAnalyzer } from "./raw-text";

const ANALYZERS: Analyzer[] = [githubAnalyzer, articleAnalyzer, rawTextAnalyzer];

export function listAnalyzers() {
  return ANALYZERS.map(({ id, name }) => ({ id, name }));
}

/** 选择 analyzer：显式指定优先，否则按置信度自动识别 */
export function pickAnalyzer(req: AnalyzeRequest): Analyzer {
  if (req.sourceType) {
    const found = ANALYZERS.find((a) => a.id === req.sourceType);
    if (!found) {
      throw new Error(
        `未知的 sourceType: ${req.sourceType}，可用: ${ANALYZERS.map((a) => a.id).join(", ")}`
      );
    }
    return found;
  }
  const scored = ANALYZERS.map((a) => ({ a, score: a.match(req.input) })).sort(
    (x, y) => y.score - x.score
  );
  if (scored[0].score === 0) {
    throw new Error(
      `无法识别内容类型，请指定 sourceType。可用: ${ANALYZERS.map((a) => a.id).join(", ")}`
    );
  }
  return scored[0].a;
}

export { rawTextAnalyzer, githubAnalyzer, articleAnalyzer };
export type { Analyzer, AnalyzeRequest };
