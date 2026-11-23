"use client";

/**
 * 主题运行时 Context：
 * - SSR 由 layout 直接内联 CSS 变量到 <html style>（无闪烁）
 * - 客户端支持 ?theme=name 预览覆盖（优先于已持久化的主题）
 * - PUT /api/theme 切换后注入新 tokens 并刷新页面
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { tokensToStyle, type ThemeTokens } from "./themes";

interface ThemeContextValue {
  /** 当前（含预览覆盖）主题名 */
  themeName: string;
  /** 当前生效 tokens */
  tokens: ThemeTokens;
  /** 切换主题：持久化（persist=true）或仅本地预览 */
  setTheme: (name: string, opts?: { persist?: boolean }) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ProviderProps {
  children: ReactNode;
  /** 服务端渲染时的主题（持久化值） */
  initialName: string;
  initialTokens: ThemeTokens;
}

export function ThemeProvider({ children, initialName, initialTokens }: ProviderProps) {
  const [state, setState] = useState({
    name: initialName,
    tokens: initialTokens,
  });

  // ?theme= 预览覆盖（读 window.location，避免 useSearchParams 阻断静态预渲染）
  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get("theme");
    if (!preview || preview === initialName) return;
    let cancelled = false;
    fetch(`/api/theme?theme=${encodeURIComponent(preview)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.tokens) return;
        setState({ name: data.name as string, tokens: data.tokens as ThemeTokens });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialName]);

  // tokens 变化时注入 CSS 变量
  useEffect(() => {
    const el = document.documentElement;
    for (const [k, v] of Object.entries(tokensToStyle(state.tokens))) {
      el.style.setProperty(k, v);
    }
  }, [state.tokens]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeName: state.name,
      tokens: state.tokens,
      setTheme: async (name, opts) => {
        const persist = opts?.persist ?? true;
        if (persist) {
          const res = await fetch("/api/theme", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme: name }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(data?.error || `切换失败（${res.status}）`);
          }
          const data = (await res.json()) as { name: string; tokens: ThemeTokens };
          setState({ name: data.name, tokens: data.tokens });
        } else {
          const res = await fetch(`/api/theme?theme=${encodeURIComponent(name)}`);
          if (!res.ok) throw new Error("主题不存在");
          const data = (await res.json()) as { name: string; tokens: ThemeTokens };
          setState({ name: data.name, tokens: data.tokens });
        }
      },
    }),
    [state]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
