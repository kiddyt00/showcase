/** 极简 Markdown 渲染（避免引入依赖）：标题/粗体/行内代码/代码块/有序+无序列表/引用块/链接 */
import React from "react";

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <>
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          // 奇数索引为代码块；去掉语言标注行
          <pre
            key={i}
            className="my-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-xs leading-relaxed text-[var(--fg)]"
          >
            <code>{block.replace(/^\w*\n/, "").replace(/^\n+|\n+$/g, "")}</code>
          </pre>
        ) : (
          <div key={i}>{renderInline(block)}</div>
        )
      )}
    </>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  // 缓冲连续的列表行（无序 / 有序），包进 <ul> / <ol>
  let listItems: { key: number; content: React.ReactNode }[] = [];
  let ordered = false;
  let nextKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    out.push(
      <ol
        key={`list-${nextKey++}`}
        className={`my-1 space-y-0.5 ${ordered ? "ml-5 list-decimal" : "ml-5 list-disc"}`}
      >
        {listItems.map((li) => (
          <li key={li.key} className="my-1 text-[15px] lg:text-base leading-[1.9] text-[var(--fg)]">
            {li.content}
          </li>
        ))}
      </ol>
    );
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const key = nextKey++;
    const line = lines[i];
    if (!line.trim()) {
      flushList();
      continue; // 段落间距交给块级 margin（#md-block），不再用固定 h-2 占位
    }
    // 列表行：先缓冲，遇到非列表行（或序号样式切换）时输出
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)/);
    if (ul || ol) {
      const isOrdered = Boolean(ol);
      if (listItems.length && isOrdered !== ordered) flushList();
      ordered = isOrdered;
      listItems.push({ key, content: formatSpans((ul ?? ol)![1]) });
      continue;
    }
    flushList();
    // 表格块：| 开头的连续行（首行表头，次行 --- 分隔）
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      let j = i;
      for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
        const cells = lines[j]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // 分隔行
        rows.push(cells);
      }
      i = j - 1;
      if (rows.length >= 2) {
        const [head, ...body] = rows;
        out.push(
          <div
            key={key}
            className="my-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]"
          >
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[var(--card)]">
                  {head.map((c, ci) => (
                    <th
                      key={ci}
                      className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--fg)]"
                    >
                      {formatSpans(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri} className="border-b border-[var(--border)]/60 last:border-b-0">
                    {r.map((c, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 align-top text-[13px] leading-relaxed text-[var(--fg)]"
                      >
                        {formatSpans(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }
    // 引用行：连续的 > 行合并为一个 blockquote
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      let j = i;
      for (; j < lines.length && /^>\s?/.test(lines[j]); j++) {
        quote.push(lines[j].replace(/^>\s?/, ""));
      }
      out.push(
        <blockquote
          key={key}
          className="my-2 border-l-2 border-[var(--accent)]/40 pl-3 text-sm leading-relaxed text-[var(--muted)]"
        >
          {renderInline(quote.join("\n"))}
        </blockquote>
      );
      i = j - 1;
      continue;
    }
    // 标题行：#/#/## → h2，###/#### → h3
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const size = h[1].length <= 2 ? "text-lg font-bold" : "text-base font-semibold";
      const Tag = h[1].length <= 2 ? "h2" : "h3";
      out.push(
        <Tag key={key} className={`${size} mt-3 mb-1 text-[var(--fg)]`}>
          {formatSpans(h[2])}
        </Tag>
      );
      continue;
    }
    out.push(
      <p key={key} className="my-3 text-[15px] lg:text-base leading-[1.9] text-[var(--fg)]">
        {formatSpans(line)}
      </p>
    );
  }
  flushList();
  return out;
}

/** 处理 **粗体**、`行内代码`、[链接](url) */
function formatSpans(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-[var(--fg)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-[var(--bg)] px-1 py-0.5 font-mono text-xs text-accent"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const link = token.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      // XSS 防护：href 必须是合法的 http/https URL，否则整段按纯文本渲染
      let safe = false;
      try {
        const parsed = new URL(link[2]);
        safe = parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        safe = false;
      }
      if (!safe) {
        parts.push(token);
      } else {
        parts.push(
          <a
            key={key++}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            {link[1]}
          </a>
        );
      }
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
