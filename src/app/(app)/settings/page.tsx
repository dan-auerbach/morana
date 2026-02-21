"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/app/components/ThemeProvider";
import { useLocale, useT } from "@/app/components/I18nProvider";
import { getDictionary } from "@/lib/i18n";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type ModelEntry = { id: string; label: string; provider: string };

function StatusBadge({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const map = {
    saving: { color: "var(--yellow)", text: "..." },
    saved: { color: "var(--green)", text: "\u2713 saved" },
    error: { color: "var(--red)", text: "\u2717 error" },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: "11px", color: s.color, marginLeft: "8px", fontWeight: 500 }}>
      [{s.text}]
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  padding: "20px",
  marginBottom: "16px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--green)",
  marginBottom: "12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

export default function SettingsPage() {
  const { data: session, status: authStatus } = useSession();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const [t, setTFunc] = useState<(key: string) => string>(() => (key: string) => key);

  const [themeStatus, setThemeStatus] = useState<SaveStatus>("idle");
  const [langStatus, setLangStatus] = useState<SaveStatus>("idle");
  const [defaultsStatus, setDefaultsStatus] = useState<SaveStatus>("idle");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);

  // Load settings translations
  useEffect(() => {
    getDictionary(locale, "settings").then((dict) => {
      setTFunc(() => (key: string) => dict[key] ?? key);
    });
  }, [locale]);

  // Load models
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, []);

  // Load current settings from DB
  useEffect(() => {
    if (session) {
      fetch("/api/user/settings")
        .then((r) => r.json())
        .then((d) => {
          setDefaultModelId(d.defaultLlmModelId ?? null);
        })
        .catch(() => {});
    }
  }, [session]);

  const flashStatus = useCallback((setter: (s: SaveStatus) => void, ok: boolean) => {
    setter(ok ? "saved" : "error");
    setTimeout(() => setter("idle"), 2000);
  }, []);

  function handleThemeChange(t: "system" | "dark" | "light") {
    setTheme(t);
    setThemeStatus("saving");
    // ThemeProvider already debounces the API call; we just show feedback
    setTimeout(() => flashStatus(setThemeStatus, true), 500);
  }

  function handleLocaleChange(l: "en" | "sl") {
    setLocale(l);
    setLangStatus("saving");
    setTimeout(() => flashStatus(setLangStatus, true), 500);
  }

  async function handleDefaultModel(modelId: string) {
    const value = modelId || null;
    setDefaultModelId(value);
    setDefaultsStatus("saving");
    try {
      const resp = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultLlmModelId: value }),
      });
      flashStatus(setDefaultsStatus, resp.ok);
    } catch {
      flashStatus(setDefaultsStatus, false);
    }
  }

  if (authStatus === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div style={{ color: "var(--green)" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div style={{ color: "var(--gray)" }}>Access denied. Please sign in.</div>
      </div>
    );
  }

  const themes: { value: "system" | "dark" | "light"; icon: string; labelKey: string }[] = [
    { value: "system", icon: "\u25D0", labelKey: "theme.system" },
    { value: "dark", icon: "\u263D", labelKey: "theme.dark" },
    { value: "light", icon: "\u263C", labelKey: "theme.light" },
  ];

  return (
    <div style={{ maxWidth: "600px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--green)", margin: 0 }}>
          <span style={{ color: "var(--gray)" }}>&gt;</span> {t("title")}
        </h1>
        <div style={{ fontSize: "12px", color: "var(--gray)", marginTop: "4px" }}>
          // {t("subtitle")}
        </div>
      </div>

      {/* Theme Section */}
      <div style={cardStyle}>
        <div style={sectionTitle}>
          {t("theme.title")}
          <StatusBadge status={themeStatus} />
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {themes.map((opt) => {
            const isActive = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleThemeChange(opt.value)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  border: `1px solid ${isActive ? "var(--green)" : "var(--border)"}`,
                  backgroundColor: isActive ? "rgba(0, 255, 136, 0.08)" : "transparent",
                  color: isActive ? "var(--green)" : "var(--gray)",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ marginRight: "6px" }}>{opt.icon}</span>
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Language Section */}
      <div style={cardStyle}>
        <div style={sectionTitle}>
          {t("language.title")}
          <StatusBadge status={langStatus} />
        </div>
        <select
          value={locale}
          onChange={(e) => handleLocaleChange(e.target.value as "en" | "sl")}
          style={{
            padding: "8px 12px",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--bg-input)",
            color: "var(--white)",
            fontFamily: "inherit",
            fontSize: "13px",
            cursor: "pointer",
            minWidth: "200px",
          }}
        >
          <option value="en">English</option>
          <option value="sl">Sloven\u0161\u010dina</option>
        </select>
      </div>

      {/* Defaults Section */}
      <div style={cardStyle}>
        <div style={sectionTitle}>
          {t("defaults.title")}
          <StatusBadge status={defaultsStatus} />
        </div>
        <div style={{ marginBottom: "8px" }}>
          <label style={{ fontSize: "12px", color: "var(--gray)", display: "block", marginBottom: "6px" }}>
            {t("defaults.llmModel")} <span style={{ color: "var(--yellow)", fontSize: "11px" }}>{t("defaults.comingSoon")}</span>
          </label>
          <select
            value={defaultModelId || ""}
            onChange={(e) => handleDefaultModel(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--bg-input)",
              color: "var(--white)",
              fontFamily: "inherit",
              fontSize: "13px",
              cursor: "pointer",
              minWidth: "200px",
            }}
          >
            <option value="">{t("defaults.none")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.provider})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
