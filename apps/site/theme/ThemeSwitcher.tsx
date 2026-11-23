/** 主题切换器：页脚小链接，点开 <details> 下拉，低调不抢眼 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/theme/ThemeContext";

interface ThemeOption {
  name: string;
  label: string;
}

export default function ThemeSwitcher({ themes }: { themes: ThemeOption[] }) {
  const { themeName, setTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function pick(name: string) {
    if (name === themeName || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 有管理令牌时持久化（与 VideoSection 同一约定：localStorage 存 token）
      const token = localStorage.getItem("showcase-admin-token");
      let persisted = false;
      if (token) {
        const res = await fetch("/api/theme", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-admin-token": token },
          body: JSON.stringify({ theme: name }),
        });
        if (!res.ok) throw new Error("切换失败（无权限或主题不存在）");
        persisted = true;
      }
      await setTheme(name, { persist: false }); // 注入 tokens（持久化后同样适用）
      if (!persisted) setError("无管理权限，仅本地预览（刷新后还原）");
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <details
      className="relative"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]">
        主题: {themeName}
      </summary>
      <div className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
        {themes.map((t) => (
          <button
            key={t.name}
            onClick={() => pick(t.name)}
            disabled={busy}
            className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-[var(--bg)] hover:text-[var(--accent)] disabled:opacity-50 ${
              t.name === themeName ? "font-semibold text-[var(--accent)]" : "text-[var(--fg)]"
            }`}
          >
            {t.label}
          </button>
        ))}
        <p className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--muted)]">
          预览可加 <Link className="underline" href="/?theme=editorial">?theme=</Link> 参数
        </p>
      </div>
      {error && (
        <p className="absolute bottom-full left-1/2 mb-8 w-56 -translate-x-1/2 text-center text-[10px] text-[var(--accent)]">
          {error}
        </p>
      )}
    </details>
  );
}
