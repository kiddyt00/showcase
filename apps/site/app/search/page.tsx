"use client";

/** 搜索页：输入框 + 结果列表（命中词高亮） */
import { useCallback, useEffect, useRef, useState } from "react";

interface Hit {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  tags: string[];
  createdAt: string;
  matchedIn: string[];
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={key++} className="bg-transparent font-semibold text-[var(--accent)] underline decoration-[var(--accent)]/60 decoration-2 underline-offset-2">
        {text.slice(at, at + q.length)}
      </mark>
    );
    i = at + q.length;
  }
  return <>{parts}</>;
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (query: string) => {
    if (!query.trim()) {
      setHits(null);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as { hits: Hit[] };
      setHits(data.hits);
    } catch {
      setHits(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // URL ?q= 直达（可被外部搜索框链接）
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl) {
      setQ(fromUrl);
      run(fromUrl);
    }
    inputRef.current?.focus();
  }, [run]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight">搜索</h1>
      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
      >
        <input
          ref={inputRef}
          className="input"
          type="search"
          placeholder="搜索标题、摘要或正文…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索关键词"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-4 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
      </form>

      <div className="mt-8">
        {error ? (
          <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-6 text-center text-sm text-muted">
            搜索服务暂时不可用，请稍后重试。
          </p>
        ) : hits === null ? (
          <p className="text-sm text-muted">输入关键词开始搜索。</p>
        ) : hits.length === 0 ? (
          <p className="text-sm text-muted">没有找到与「{q}」相关的内容。</p>
        ) : (
          <>
            <p className="mb-4 text-xs text-muted">
              找到 {hits.length} 条与「<span className="text-[var(--fg)]">{q}</span>」相关的结果
            </p>
            <ul className="space-y-4">
              {hits.map((h) => (
                <li key={h.slug}>
                  <a
                    href={`/show/${h.slug}`}
                    className="group block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--accent)]"
                  >
                    <h2 className="font-heading text-lg font-bold group-hover:text-[var(--accent)]">
                      <Highlight text={h.title} q={q} />
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                      {h.matchedIn.join(" / ")} 命中 · {h.createdAt.slice(0, 10)}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">
                      <Highlight text={h.excerpt} q={q} />
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
