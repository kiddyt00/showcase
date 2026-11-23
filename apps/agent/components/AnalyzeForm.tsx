"use client";

import { useState } from "react";

/** Agent 交互输入框：说一句"分析 xxx"即可 */
export default function AnalyzeForm() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; title: string } | null>(
    null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失败");
      setResult({ url: data.url, title: data.page.title as string });
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='告诉 Agent 分析什么，例如：分析 vercel/next.js，或粘贴一篇文章 URL'
          aria-label="分析内容输入"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {loading ? "Agent 分析中…" : "开始分析"}
        </button>
      </form>
      {loading && (
        <p className="mt-3 text-xs text-zinc-500">
          正在识别内容源 → 抓取素材 → AI 深度分析 → 生成网页…
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">出错了：{error}</p>}
      {result && (
        <p className="mt-3 text-sm text-emerald-400">
          分析完成！
          <a href={result.url} className="ml-1 underline">
            查看生成的页面：{result.title}
          </a>
        </p>
      )}
    </div>
  );
}
