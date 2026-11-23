/** Analyzer 插件：GitHub 开源项目 */
import { Analyzer } from "../types";

export const githubAnalyzer: Analyzer = {
  id: "github",
  name: "GitHub 开源项目",
  hints: { category: "opensource" },

  match(input: string): number {
    const s = input.toLowerCase();
    // owner/repo 形式 或 github.com 链接 或 明确提到 github
    if (/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(s)) return 0.95;
    if (/^[\w.-]+\/[\w.-]+$/.test(input.trim())) return 0.85;
    if (/github|开源项目|仓库/.test(s)) return 0.4;
    return 0;
  },

  async collect(input: string): Promise<string> {
    const repo = extractRepo(input);
    if (!repo) throw new Error(`无法从输入中解析 GitHub 仓库: ${input}`);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "universal-showcase",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const [repoRes, readmeRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      }),
      fetch(`https://api.github.com/repos/${repo}/readme`, {
        headers: { ...headers, Accept: "application/vnd.github.raw" },
        signal: AbortSignal.timeout(15000),
      }),
    ]);
    if (!repoRes.ok) {
      throw new Error(`GitHub API 错误 ${repoRes.status}（仓库不存在或限流）`);
    }
    const repoData = (await repoRes.json()) as Record<string, unknown>;
    const readme = readmeRes.ok ? await readmeRes.text() : "（README 获取失败）";

    return [
      `仓库: ${repo}`,
      `描述: ${repoData.description ?? "无"}`,
      `Stars: ${repoData.stargazers_count} | Forks: ${repoData.forks_count} | Open Issues: ${repoData.open_issues_count}`,
      `主语言: ${repoData.language ?? "未知"}`,
      `Topics: ${Array.isArray(repoData.topics) ? (repoData.topics as string[]).join(", ") : "无"}`,
      `License: ${(repoData.license as Record<string, unknown>)?.spdx_id ?? "无"}`,
      `主页: ${repoData.homepage ?? "无"}`,
      ``,
      `=== README 内容（截取前 12000 字符） ===`,
      readme.slice(0, 12000),
    ].join("\n");
  },
};

/** 从输入中提取 owner/repo */
function extractRepo(input: string): string | null {
  const url = input.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (url) return `${url[1]}/${url[2].replace(/\.git$/, "")}`;
  const short = input.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return `${short[1]}/${short[2]}`;
  return null;
}
