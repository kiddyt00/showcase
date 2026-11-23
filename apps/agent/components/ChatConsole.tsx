"use client";

/**
 * Agent 管理控制台 —— DeepSeek Harness 风格深色工作台
 * 左栏：会话列表 + 快捷指令；中栏：对话主流；右栏：页面元素面板
 * 移动端（<lg）：Tab 切换「对话 / 元素」；Cmd/Ctrl+K 命令面板
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageContent } from "@showcase/core/types";
import { Markdown } from "@/components/Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  toolEvents?: ToolEvent[];
}

interface ToolEvent {
  name: string;
  result: string;
}

interface RecentPage {
  slug: string;
  title: string;
  category?: string;
}

const CATEGORIES = ["opensource", "article", "tutorial", "news", "research"];

const QUICK_PROMPTS = [
  { label: "分析仓库", prompt: "分析 vercel/next.js 并生成页面" },
  { label: "分析文章", prompt: "分析这篇文章并生成页面：" },
  { label: "加架构图", prompt: "为当前页面添加一张架构图" },
  { label: "优化标题", prompt: "把当前页面标题改得更吸引人，摘要也更精炼" },
];

const SESSIONS_KEY = "showcase-sessions";

/* ---------------- 主组件 ---------------- */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100";

export default function ChatConsole() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentSlug, setCurrentSlug] = useState<string | undefined>();
  const [page, setPage] = useState<PageContent | null>(null);
  const [saveError, setSaveError] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [mobileTab, setMobileTab] = useState<"chat" | "panel">("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /* 管理令牌 / 会话：从 localStorage 恢复 */
  useEffect(() => {
    setAdminToken(localStorage.getItem("showcase-admin-token") ?? "");
    try {
      setSessions(JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]"));
    } catch {
      setSessions([]);
    }
    let id = localStorage.getItem("showcase-session-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("showcase-session-id", id);
    }
    setSessionId(id);
  }, []);

  function persistSessions(next: string[], current: string) {
    // 最近 5 个，当前会话置顶
    const merged = [current, ...next.filter((s) => s !== current)].slice(0, 5);
    setSessions(merged);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(merged));
  }

  function saveAdminToken(value: string) {
    setAdminToken(value);
    if (value) localStorage.setItem("showcase-admin-token", value);
    else localStorage.removeItem("showcase-admin-token");
  }

  function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const token = localStorage.getItem("showcase-admin-token");
    const headers: Record<string, string> = { ...extra };
    if (token) headers["x-admin-token"] = token;
    return headers;
  }

  function newSession() {
    const id = crypto.randomUUID();
    localStorage.setItem("showcase-session-id", id);
    persistSessions(sessions, id);
    setSessionId(id);
    setMessages([]);
    setCurrentSlug(undefined);
    setPage(null);
  }

  function switchSession(id: string) {
    if (id === sessionId) return;
    localStorage.setItem("showcase-session-id", id);
    persistSessions(sessions, id);
    setSessionId(id);
    setMessages([]);
    setCurrentSlug(undefined);
    setPage(null);
  }

  /* 恢复会话历史 */
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/chat/history?sessionId=${sessionId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.messages?.length) {
          setMessages(d.messages);
          if (d.currentSlug) setCurrentSlug(d.currentSlug);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!currentSlug) return setPage(null);
    fetch(`/api/pages/${currentSlug}`)
      .then((r) => r.json())
      .then((d) => setPage(d.page ?? null))
      .catch(() => setPage(null));
  }, [currentSlug]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  /* textarea 自动增高 */
  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy || !sessionId) return;
    setInput("");
    if (taRef.current) autoGrow(taRef.current);
    setMessages((m) => [...m, { role: "user", content }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ sessionId, message: content, currentSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply,
          tools: data.toolEvents?.map((t: ToolEvent) => t.name),
          toolEvents: data.toolEvents,
        },
      ]);
      if (data.currentSlug) setCurrentSlug(data.currentSlug);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `出错了：${err instanceof Error ? err.message : "未知错误"}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function patchPage(patch: Partial<PageContent>) {
    if (!currentSlug) return;
    try {
      const res = await fetch(`/api/pages/${currentSlug}`, {
        method: "PATCH",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `保存失败（${res.status}）`);
      if (data.page) setPage(data.page);
      setSaveError("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败，请重试");
    }
  }

  async function deletePage(slug: string) {
    if (!confirm(`确定删除页面 ${slug}？`)) return;
    await fetch(`/api/pages/${slug}`, { method: "DELETE", headers: adminHeaders() });
    if (slug === currentSlug) {
      setCurrentSlug(undefined);
      setPage(null);
    }
  }

  /* 命令面板快捷键 */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const elementPanel = (
    <ElementPanel
      key={currentSlug ?? "none"}
      page={page}
      currentSlug={currentSlug}
      saveError={saveError}
      onPatch={patchPage}
      onDelete={deletePage}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 移动端 Tab */}
      <div className="flex gap-1 border-b border-[#21283a] px-3 py-2 lg:hidden">
        {(["chat", "panel"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={`rounded px-3 py-1 font-mono text-xs ${
              mobileTab === t
                ? "bg-emerald-500/15 text-emerald-400"
                : "text-[#8b96a8] hover:text-foreground"
            }`}
          >
            {t === "chat" ? "对话" : "元素"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：会话 + 快捷指令 */}
        <aside
          className={`${mobileTab === "chat" ? "hidden" : "flex"} w-full flex-col border-r border-[#21283a] lg:flex lg:w-[220px] lg:shrink-0`}
        >
          <div className="border-b border-[#21283a] p-2.5">
            <button
              onClick={newSession}
              className="w-full rounded border border-[#2a3347] px-2 py-1.5 font-mono text-xs text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/10"
            >
              + 新会话
            </button>
          </div>
          <div className="border-b border-[#21283a] py-2">
            <p className="px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-[#4d5668]">
              最近会话
            </p>
            {sessions.length === 0 && (
              <p className="px-3 text-[11px] text-[#4d5668]">暂无历史</p>
            )}
            {sessions.map((s) => (
              <button
                key={s}
                onClick={() => switchSession(s)}
                title={s}
                className={`block w-full truncate px-3 py-1.5 text-left font-mono text-[11px] ${
                  s === sessionId
                    ? "border-l-2 border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : "text-[#8b96a8] hover:bg-[#161d28] hover:text-foreground"
                }`}
              >
                {shortId(s)}
              </button>
            ))}
          </div>
          <div className="py-2">
            <p className="px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-[#4d5668]">
              快捷指令
            </p>
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                onClick={() => {
                  setMobileTab("chat");
                  if (q.label === "分析文章") {
                    setInput(q.prompt);
                    taRef.current?.focus();
                  } else {
                    send(q.prompt);
                  }
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-[12px] text-[#8b96a8] hover:bg-[#161d28] hover:text-emerald-400"
              >
                › {q.label}
              </button>
            ))}
          </div>
          <div className="mt-auto border-t border-[#21283a] p-2.5">
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#4d5668]">
                ADMIN_TOKEN
              </span>
              <input
                type="password"
                value={adminToken}
                onChange={(e) => saveAdminToken(e.target.value)}
                placeholder="粘贴管理令牌"
                className="input"
              />
            </label>
          </div>
        </aside>

        {/* 中栏：对话主流 */}
        <section
          className={`${mobileTab === "chat" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}
        >
          {/* 顶部状态条 */}
          <div className="flex items-center gap-3 border-b border-[#21283a] bg-[#10161f] px-4 py-2 font-mono text-[11px] text-[#8b96a8]">
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${busy ? "bg-yellow-400" : "bg-emerald-500"}`}
              />
              session:{" "}
              <span className="text-foreground">{sessionId ? shortId(sessionId) : "—"}</span>
            </span>
            {currentSlug && (
              <span>
                正在管理:
                <a
                  target="_blank" rel="noreferrer" href={`${SITE_URL}/show/${currentSlug}`}
                  className="ml-1 text-emerald-400 hover:underline"
                >
                  {currentSlug} ↗
                </a>
              </span>
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              className="ml-auto rounded border border-[#2a3347] px-2 py-0.5 text-[10px] text-[#4d5668] hover:text-[#8b96a8]"
            >
              ⌘K
            </button>
          </div>

          {/* 消息流 */}
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="mt-12 space-y-1.5 text-center font-mono text-xs text-[#4d5668]">
                <p className="text-[#8b96a8]">Agent 工作台就绪</p>
                <p>「分析 vercel/next.js」</p>
                <p>「把部署章节再详细一点，加上 Docker 方式」</p>
                <p>「把标题换成中文，标签加上 AI」</p>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
<div className="max-w-[92%] rounded-md border border-[#2a3347] bg-[#161d28] px-3 py-2 text-[13px] text-[#e6edf3]">
                    <Markdown text={m.content} />
                  </div>
                </div>
              ) : (
                <AssistantMsg key={i} msg={m} />
              )
            )}
            {busy && (
              <div className="flex items-center gap-2 px-1 py-1 font-mono text-[11px] text-[#8b96a8]">
                <span className="flex gap-1">
                  <span className="hop inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  <span className="hop inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  <span className="hop inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
                </span>
                agent working…
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-[#21283a] bg-[#10161f] p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={taRef}
                value={input}
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoGrow(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="给 Agent 下指令…（Enter 发送 / Shift+Enter 换行）"
                aria-label="对话输入"
                className="input max-h-40 resize-none"
                disabled={busy}
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="rounded-md bg-emerald-500 px-3.5 py-2 font-mono text-xs font-semibold text-[#0d1117] hover:bg-emerald-400 disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </div>
        </section>

        {/* 右栏：页面元素面板 */}
        <aside
          className={`${mobileTab === "panel" ? "flex" : "hidden lg:flex"} w-full flex-col overflow-y-auto border-l border-[#21283a] lg:w-[340px] lg:shrink-0`}
        >
          {elementPanel}
        </aside>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onPrompt={(p) => {
            setPaletteOpen(false);
            setMobileTab("chat");
            send(p);
          }}
          onOpenPage={(slug) => {
            setPaletteOpen(false);
            setMobileTab("panel");
            setCurrentSlug(slug);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- assistant 消息 + 工具折叠块 ---------------- */

function AssistantMsg({ msg }: { msg: Msg }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const failed = (ev: ToolEvent) => /^(错误|出错|.*失败)/.test(ev.result);
  return (
    <div className="max-w-[90%] space-y-1.5">
      {msg.tools?.length ? (
        <div className="flex flex-wrap items-center gap-1 font-mono text-[10px]">
          {msg.tools.map((t, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[#4d5668]">→</span>}
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
                {t}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {msg.toolEvents?.length ? (
        <div className="space-y-1">
          {msg.toolEvents.map((ev, i) => (
            <div key={i} className="rounded border border-[#21283a] bg-[#10161f]">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px]"
              >
                <span className={failed(ev) ? "text-red-400" : "text-emerald-400"}>
                  {failed(ev) ? "✗" : "✓"}
                </span>
                <span className="text-foreground">{ev.name}</span>
                <span className="ml-auto text-[#4d5668]">{openIdx === i ? "▾" : "▸"}</span>
              </button>
              {openIdx === i && (
                <pre className="overflow-x-auto border-t border-[#21283a] px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-[#8b96a8]">
                  {ev.result}
                </pre>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {/* 回复正文走 Markdown 渲染器（标题/列表/代码块/链接），不再纯文本 */}
      <div className="rounded-md border border-[#21283a] bg-[#10161f] px-3 py-2 text-[13px] text-[#c9d4e0] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <Markdown text={msg.content} />
      </div>
    </div>
  );
}

/* ---------------- 右栏元素面板 ---------------- */

function ElementPanel({
  page,
  currentSlug,
  saveError,
  onPatch,
  onDelete,
}: {
  page: PageContent | null;
  currentSlug?: string;
  saveError: string;
  onPatch: (patch: Partial<PageContent>) => void;
  onDelete: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-[#8b96a8]">页面元素</h2>
        {currentSlug && (
          <span className="font-mono text-[10px] text-[#4d5668]">{currentSlug}</span>
        )}
      </div>

      {saveError && (
        <p className="rounded border border-red-900 bg-red-950/60 px-2.5 py-1.5 font-mono text-[11px] text-red-300">
          ✗ {saveError}
        </p>
      )}

      {!page ? (
        <p className="text-xs leading-relaxed text-[#4d5668]">
          还没有管理中的页面。在对话里让 Agent「分析某个项目」即可生成，或按 ⌘K
          打开命令面板切换已有页面。
        </p>
      ) : (
        <>
          <Card title="基本信息">
            <Field label="标题">
              <input
                defaultValue={page.title}
                onBlur={(e) => onPatch({ title: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="摘要">
              <textarea
                defaultValue={page.summary}
                onBlur={(e) => onPatch({ summary: e.target.value })}
                rows={3}
                className="input resize-none"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="分类">
                <select
                  defaultValue={page.category}
                  onChange={(e) => onPatch({ category: e.target.value })}
                  className="input"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="图标 URL">
                <input
                  defaultValue={page.icon ?? ""}
                  onBlur={(e) => onPatch({ icon: e.target.value })}
                  className="input"
                />
              </Field>
            </div>
          </Card>

          <Card title="标签">
            <input
              defaultValue={page.tags.join(", ")}
              onBlur={(e) =>
                onPatch({
                  tags: e.target.value
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              className="input"
            />
            {page.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {page.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded border border-[#2a3347] px-1.5 py-0.5 font-mono text-[10px] text-[#8b96a8]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card title={`章节（${page.sections.length}）`}>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {page.sections.map((s, i) => (
                <SectionRow
                  key={i}
                  index={i}
                  heading={s.heading}
                  body={s.body}
                  onDelete={() =>
                    onPatch({ sections: page.sections.filter((_, j) => j !== i) })
                  }
                />
              ))}
            </div>
          </Card>

          <Card title="危险区">
            <div className="flex gap-2">
              <a
                target="_blank" rel="noreferrer" href={`${SITE_URL}/show/${page.slug}`}
                className="flex-1 rounded border border-[#2a3347] py-1.5 text-center font-mono text-[11px] text-[#8b96a8] hover:border-emerald-500/60 hover:text-emerald-400"
              >
                预览页面 ↗
              </a>
              <button
                onClick={() => onDelete(page.slug)}
                className="rounded border border-red-900/70 px-3 py-1.5 font-mono text-[11px] text-red-400 hover:bg-red-950/60"
              >
                删除页面
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[#21283a] bg-[#10161f]">
      <div className="border-b border-[#21283a] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#8b96a8]">
        {title}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-[#4d5668]">{label}</span>
      {children}
    </label>
  );
}

function SectionRow({
  index,
  heading,
  body,
  onDelete,
}: {
  index: number;
  heading: string;
  body: string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-[#21283a] bg-[#0a0f16]">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="font-mono text-[10px] text-[#4d5668]">{open ? "▾" : "▸"}</span>
          <span className="truncate text-[12px] text-[#c9d4e0]">
            {index}. {heading}
          </span>
        </button>
        <button
          onClick={onDelete}
          className="font-mono text-[10px] text-red-400 hover:text-red-300"
        >
          删除
        </button>
      </div>
      {open && (
        <p className="border-t border-[#21283a] px-2 py-1.5 text-[11px] leading-relaxed text-[#8b96a8]">
          {body.slice(0, 60)}
          {body.length > 60 ? "…" : ""}
        </p>
      )}
    </div>
  );
}

/* ---------------- 命令面板（⌘K） ---------------- */

function CommandPalette({
  onClose,
  onPrompt,
  onOpenPage,
}: {
  onClose: () => void;
  onPrompt: (prompt: string) => void;
  onOpenPage: (slug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const [pages, setPages] = useState<RecentPage[]>([]);

  useEffect(() => {
    fetch("/api/pages")
      .then((r) => r.json())
      .then((d) => setPages(d.pages ?? []))
      .catch(() => {});
  }, []);

  const items = useMemo(() => {
    const prompts: { type: "prompt"; label: string; value: string }[] = QUICK_PROMPTS.map(
      (q) => ({ type: "prompt", label: `指令 › ${q.label}`, value: q.prompt })
    );
    const pageItems: { type: "page"; label: string; value: string }[] = pages.map((p) => ({
      type: "page",
      label: `页面 › ${p.slug} — ${p.title}`,
      value: p.slug,
    }));
    const all = [...prompts, ...pageItems];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((it) => it.label.toLowerCase().includes(q));
  }, [query, pages]);

  function run(i: number) {
    const it = items[i];
    if (!it) return;
    if (it.type === "prompt") onPrompt(it.value);
    else onOpenPage(it.value);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="palette-in w-full max-w-lg rounded-lg border border-[#2a3347] bg-[#10161f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              run(idx);
            }
          }}
          placeholder="搜索指令或页面…（↑↓ 选择，Enter 执行）"
          className="w-full border-b border-[#21283a] bg-transparent px-4 py-3 font-mono text-sm text-foreground outline-none placeholder:text-[#4d5668]"
        />
        <div className="max-h-72 overflow-y-auto py-1">
          {items.length === 0 && (
            <p className="px-4 py-3 font-mono text-xs text-[#4d5668]">无匹配项</p>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.type}-${it.value}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(i)}
              className={`block w-full truncate px-4 py-2 text-left font-mono text-xs ${
                i === idx ? "bg-emerald-500/10 text-emerald-400" : "text-[#8b96a8]"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function shortId(id: string) {
  return id.slice(0, 8);
}
