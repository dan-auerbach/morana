"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useT } from "@/app/components/I18nProvider";

type UsageEvent = {
  id: string;
  provider: string;
  model: string;
  costEstimate: number;
  latencyMs: number;
  unitsJson: Record<string, number>;
  createdAt: string;
  user: { email: string; name: string | null };
};

type Summary = {
  totalEvents: number;
  totalCost: number;
  totalLatencyMs: number;
  byModel: Record<string, { count: number; cost: number }>;
};

type RecipeExec = {
  id: string;
  recipeName: string;
  totalCost: number;
  startedAt: string;
};

type RecipeSummary = {
  totalExecutions: number;
  totalCost: number;
};

export default function UsagePage() {
  const { data: session } = useSession();
  const t = useT("usage");
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recipeExecs, setRecipeExecs] = useState<RecipeExec[]>([]);
  const [recipeSummary, setRecipeSummary] = useState<RecipeSummary | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [provider, setProvider] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [error, setError] = useState("");

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (provider) params.set("provider", provider);
      const resp = await fetch(`/api/usage?${params}`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await resp.json();
      if (data.error) setError(data.error);
      setEvents(data.events || []);
      setSummary(data.summary || null);
      setRecipeExecs(data.recipeExecutions || []);
      setRecipeSummary(data.recipeSummary || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load usage data";
      setError(msg.includes("abort") ? "Request timed out" : msg);
      setEvents([]);
      setSummary(null);
      setRecipeExecs([]);
      setRecipeSummary(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, provider]);

  useEffect(() => {
    if (session) fetchUsage();
  }, [session, fetchUsage]);

  if (!session) {
    return (
      <div style={{ color: "var(--gray)" }}>
        <span style={{ color: "var(--red)" }}>{t("error")}</span> {t("authRequired")}
      </div>
    );
  }

  return (
    <div>
      {/* Terminal header */}
      <div style={{ marginBottom: "24px" }}>
        <div
          style={{
            color: "var(--green)",
            fontSize: "18px",
            fontWeight: 700,
            marginBottom: "4px",
          }}
        >
          {t("title")}
        </div>
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>
          {t("cmd").replace("{filter}", provider ? `--provider ${provider}` : "--all")}
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "12px",
          marginBottom: "24px",
          paddingBottom: "12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--green)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {t("from")}
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{
              padding: "6px 12px",
              backgroundColor: "var(--bg-input)",
              border: "1px solid var(--border)",
              color: "var(--white)",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
          />
        </div>
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--green)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {t("to")}
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{
              padding: "6px 12px",
              backgroundColor: "var(--bg-input)",
              border: "1px solid var(--border)",
              color: "var(--white)",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
          />
        </div>
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--green)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {t("provider")}
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{
              padding: "6px 12px",
              backgroundColor: "var(--bg-input)",
              border: "1px solid var(--border)",
              color: "var(--white)",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
          >
            <option value="">{t("all")}</option>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="gemini">gemini</option>
            <option value="fal">fal</option>
            <option value="soniox">soniox</option>
            <option value="elevenlabs">elevenlabs</option>
          </select>
        </div>
        <button
          onClick={fetchUsage}
          style={{
            padding: "6px 16px",
            background: "transparent",
            border: "1px solid var(--green)",
            color: "var(--green)",
            fontFamily: "inherit",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)";
            e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {t("filter")}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "12px", marginBottom: "16px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px" }}>
          <span style={{ fontWeight: 700 }}>{t("error")}</span> {error}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div
          className="grid gap-4 sm:grid-cols-3"
          style={{ marginBottom: "24px" }}
        >
          {/* Total runs */}
          <div
            style={{
              border: "1px solid var(--green)",
              backgroundColor: "var(--bg-panel)",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--green)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              {t("totalRuns")}
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "var(--green)",
                textShadow: "0 0 15px rgba(0, 255, 136, 0.4)",
              }}
            >
              {summary.totalEvents}
            </div>
          </div>

          {/* Estimated cost */}
          <div
            style={{
              border: "1px solid var(--yellow)",
              backgroundColor: "var(--bg-panel)",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--yellow)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              {t("estCost")}
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "var(--yellow)",
                textShadow: "0 0 15px rgba(255, 204, 0, 0.4)",
              }}
            >
              ${summary.totalCost.toFixed(4)}
            </div>
          </div>

          {/* Total latency */}
          <div
            style={{
              border: "1px solid var(--cyan)",
              backgroundColor: "var(--bg-panel)",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--cyan)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              {t("totalLatency")}
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "var(--cyan)",
                textShadow: "0 0 15px rgba(0, 229, 255, 0.4)",
              }}
            >
              {(summary.totalLatencyMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}

      {/* By model breakdown */}
      {summary?.byModel && (
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--yellow)",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: "12px",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {t("breakdownByModel")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(summary.byModel).map(([key, val]) => (
              <div
                key={key}
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-panel)",
                  padding: "12px",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--green)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <div style={{ color: "var(--white)", fontWeight: 700, fontSize: "13px" }}>
                  {key}
                </div>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>
                  <span style={{ color: "var(--cyan)" }}>{val.count}</span>{" "}
                  <span style={{ color: "var(--gray)" }}>{t("runs")}</span>
                  <span style={{ color: "var(--gray)" }}> | </span>
                  <span style={{ color: "var(--yellow)" }}>${val.cost.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recipe executions breakdown */}
      {recipeSummary && recipeSummary.totalExecutions > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#ff8800",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: "12px",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {t("recipeExecs").replace("{count}", String(recipeSummary.totalExecutions)).replace("{cost}", recipeSummary.totalCost.toFixed(4))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {recipeExecs.map((re) => (
              <a
                key={re.id}
                href={`/recipes/${re.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 12px",
                  backgroundColor: "rgba(13, 17, 23, 0.5)",
                  border: "1px solid var(--border)",
                  borderLeft: "3px solid #ff8800",
                  textDecoration: "none",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff8800"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = "#ff8800"; }}
              >
                <span style={{ color: "var(--white)", fontSize: "12px", flex: 1 }}>{re.recipeName}</span>
                <span style={{ color: "var(--yellow)", fontSize: "11px", fontWeight: 700 }}>${re.totalCost.toFixed(4)}</span>
                <span style={{ color: "var(--gray)", fontSize: "10px" }}>
                  {new Date(re.startedAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Events table */}
      {loading ? (
        <div style={{ color: "var(--green)", fontSize: "13px" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> {t("querying")}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              fontSize: "12px",
              borderCollapse: "collapse",
              fontFamily: "inherit",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--green)",
                  textAlign: "left",
                }}
              >
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "var(--green)",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t("colProvider")}
                </th>
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "var(--green)",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t("colModel")}
                </th>
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "var(--green)",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t("colCost")}
                </th>
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "var(--green)",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t("colLatency")}
                </th>
                {isAdmin && (
                  <th
                    style={{
                      padding: "8px 16px 8px 0",
                      color: "var(--green)",
                      fontWeight: 700,
                      fontSize: "11px",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {t("colUser")}
                  </th>
                )}
                <th
                  style={{
                    padding: "8px 0",
                    color: "var(--green)",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t("colDate")}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  style={{
                    borderBottom: "1px solid rgba(30, 42, 58, 0.5)",
                    transition: "background-color 0.15s",
                  }}
                  onMouseEnter={(ev) => {
                    ev.currentTarget.style.backgroundColor = "rgba(0, 255, 136, 0.03)";
                  }}
                  onMouseLeave={(ev) => {
                    ev.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <td style={{ padding: "8px 16px 8px 0", color: "var(--white)" }}>
                    {e.provider}
                  </td>
                  <td style={{ padding: "8px 16px 8px 0", color: "var(--gray)" }}>
                    {e.model}
                  </td>
                  <td style={{ padding: "8px 16px 8px 0", color: "var(--yellow)" }}>
                    ${e.costEstimate.toFixed(4)}
                  </td>
                  <td style={{ padding: "8px 16px 8px 0", color: "var(--cyan)" }}>
                    {(e.latencyMs / 1000).toFixed(1)}s
                  </td>
                  {isAdmin && (
                    <td style={{ padding: "8px 16px 8px 0", color: "var(--gray)" }}>
                      {e.user?.email}
                    </td>
                  )}
                  <td style={{ padding: "8px 0", color: "var(--gray)" }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
