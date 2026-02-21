"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { getDictionary } from "@/lib/i18n";

type Locale = "en" | "sl";

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  dictionaries: Record<string, Record<string, string>>;
  loadNamespace: (ns: string) => Promise<void>;
}

const I18nContext = createContext<I18nCtx>({
  locale: "en",
  setLocale: () => {},
  dictionaries: {},
  loadNamespace: async () => {},
});

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1];
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${365 * 86400}; SameSite=Lax`;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [dictionaries, setDictionaries] = useState<Record<string, Record<string, string>>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  const loadNamespace = useCallback(
    async (ns: string) => {
      const key = `${locale}/${ns}`;
      if (loadedRef.current.has(key)) return;
      loadedRef.current.add(key);
      const dict = await getDictionary(locale, ns);
      setDictionaries((prev) => ({ ...prev, [ns]: dict }));
    },
    [locale]
  );

  // Init: read cookie, load common + nav
  useEffect(() => {
    const stored = readCookie("morana_locale") as Locale | undefined;
    const l = stored === "sl" ? "sl" : "en";
    setLocaleState(l);
  }, []);

  // Reload all loaded namespaces when locale changes
  useEffect(() => {
    loadedRef.current.clear();
    setDictionaries({});

    async function loadDefaults() {
      const [common, nav] = await Promise.all([
        getDictionary(locale, "common"),
        getDictionary(locale, "nav"),
      ]);
      loadedRef.current.add(`${locale}/common`);
      loadedRef.current.add(`${locale}/nav`);
      setDictionaries({ common, nav });
    }
    loadDefaults();
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setCookie("morana_locale", l);

    // Debounced save to API
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: l }),
      }).catch(() => {});
    }, 300);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, dictionaries, loadNamespace }}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * Hook to get a translation function for a namespace.
 * Usage: const t = useT("nav"); t("recipes") // "Recipes"
 */
export function useT(namespace: string): (key: string) => string {
  const { dictionaries, loadNamespace } = useContext(I18nContext);

  // Trigger lazy load on first use
  useEffect(() => {
    loadNamespace(namespace);
  }, [namespace, loadNamespace]);

  return useCallback(
    (key: string) => {
      const dict = dictionaries[namespace];
      if (dict && dict[key] !== undefined) return dict[key];
      return key; // fallback: return the key itself
    },
    [dictionaries, namespace]
  );
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
