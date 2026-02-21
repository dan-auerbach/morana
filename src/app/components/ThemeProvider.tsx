"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

type Theme = "system" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

interface ThemeCtx {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolve(t: Theme): ResolvedTheme {
  return t === "system" ? getSystemTheme() : t;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1];
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${365 * 86400}; SameSite=Lax`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>("dark");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize from cookie on mount
  useEffect(() => {
    const stored = (readCookie("morana_theme") || "system") as Theme;
    setThemeState(stored);
    const r = resolve(stored);
    setResolved(r);
    document.documentElement.className = r;
  }, []);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    function onChange() {
      if (theme === "system") {
        const r = getSystemTheme();
        setResolved(r);
        document.documentElement.className = r;
      }
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    const r = resolve(t);
    setResolved(r);
    document.documentElement.className = r;
    setCookie("morana_theme", t);

    // Debounced save to API
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: t }),
      }).catch(() => {});
    }, 300);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
