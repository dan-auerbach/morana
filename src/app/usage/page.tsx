"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";

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

export default function UsagePage() {
  const { data: session } = useSession();
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load usage data";
      setError(msg.includes("abort") ? "Request timed out" : msg);
      setEvents([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, provider]);

  useEffect(() => {
    if (session) fetchUsage();
  }, [session, fetchUsage]);

  if (!session) {
    return (
      <div style={{ color: "#5a6a7a" }}>
        <span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required. Please sign in.
      </div>
    );
  }

  return (
    <div>
      {/* Terminal header */}
      <div style={{ marginBottom: "24px" }}>
        <div
          style={{
            color: "#00ff88",
            fontSize: "18px",
            fontWeight: 700,
            marginBottom: "4px",
          }}
        >
          [USAGE]
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>
          $ stats --costs --usage {provider ? `--provider ${provider}` : "--all"}
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
          borderBottom: "1px solid #1e2a3a",
        }}
      >
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "11px",
              fontWeight: 700,
              color: "#00ff88",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            --from
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{
              padding: "6px 12px",
              backgroundColor: "#111820",
              border: "1px solid #1e2a3a",
              color: "#e0e0e0",
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
              color: "#00ff88",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            --to
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{
              padding: "6px 12px",
              backgroundColor: "#111820",
              border: "1px solid #1e2a3a",
              color: "#e0e0e0",
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
              color: "#00ff88",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            --provider
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{
              padding: "6px 12px",
              backgroundColor: "#111820",
              border: "1px solid #1e2a3a",
              color: "#e0e0e0",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
          >
            <option value="">all</option>
            <option value="anthropic">anthropic</option>
            <option value="gemini">gemini</option>
            <option value="soniox">soniox</option>
            <option value="elevenlabs">elevenlabs</option>
          </select>
        </div>
        <button
          onClick={fetchUsage}
          style={{
            padding: "6px 16px",
            background: "transparent",
            border: "1px solid #00ff88",
            color: "#00ff88",
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
          [FILTER]
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "12px", marginBottom: "16px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid #ff4444", color: "#ff4444", fontSize: "13px" }}>
          <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
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
              border: "1px solid #00ff88",
              backgroundColor: "#0d1117",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#00ff88",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              TOTAL RUNS
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "#00ff88",
                textShadow: "0 0 15px rgba(0, 255, 136, 0.4)",
              }}
            >
              {summary.totalEvents}
            </div>
          </div>

          {/* Estimated cost */}
          <div
            style={{
              border: "1px solid #ffcc00",
              backgroundColor: "#0d1117",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#ffcc00",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              EST. COST
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "#ffcc00",
                textShadow: "0 0 15px rgba(255, 204, 0, 0.4)",
              }}
            >
              ${summary.totalCost.toFixed(4)}
            </div>
          </div>

          {/* Total latency */}
          <div
            style={{
              border: "1px solid #00e5ff",
              backgroundColor: "#0d1117",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#00e5ff",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              TOTAL LATENCY
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "#00e5ff",
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
              color: "#ffcc00",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: "12px",
              paddingBottom: "8px",
              borderBottom: "1px solid #1e2a3a",
            }}
          >
            Breakdown by Model
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(summary.byModel).map(([key, val]) => (
              <div
                key={key}
                style={{
                  border: "1px solid #1e2a3a",
                  backgroundColor: "#0d1117",
                  padding: "12px",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#00ff88";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#1e2a3a";
                }}
              >
                <div style={{ color: "#e0e0e0", fontWeight: 700, fontSize: "13px" }}>
                  {key}
                </div>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>
                  <span style={{ color: "#00e5ff" }}>{val.count}</span>{" "}
                  <span style={{ color: "#5a6a7a" }}>runs</span>
                  <span style={{ color: "#5a6a7a" }}> | </span>
                  <span style={{ color: "#ffcc00" }}>${val.cost.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Events table */}
      {loading ? (
        <div style={{ color: "#00ff88", fontSize: "13px" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Querying usage data...
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
                  borderBottom: "1px solid #00ff88",
                  textAlign: "left",
                }}
              >
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "#00ff88",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  PROVIDER
                </th>
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "#00ff88",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  MODEL
                </th>
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "#00ff88",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  COST
                </th>
                <th
                  style={{
                    padding: "8px 16px 8px 0",
                    color: "#00ff88",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  LATENCY
                </th>
                {isAdmin && (
                  <th
                    style={{
                      padding: "8px 16px 8px 0",
                      color: "#00ff88",
                      fontWeight: 700,
                      fontSize: "11px",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    USER
                  </th>
                )}
                <th
                  style={{
                    padding: "8px 0",
                    color: "#00ff88",
                    fontWeight: 700,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  DATE
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
                  <td style={{ padding: "8px 16px 8px 0", color: "#e0e0e0" }}>
                    {e.provider}
                  </td>
                  <td style={{ padding: "8px 16px 8px 0", color: "#5a6a7a" }}>
                    {e.model}
                  </td>
                  <td style={{ padding: "8px 16px 8px 0", color: "#ffcc00" }}>
                    ${e.costEstimate.toFixed(4)}
                  </td>
                  <td style={{ padding: "8px 16px 8px 0", color: "#00e5ff" }}>
                    {(e.latencyMs / 1000).toFixed(1)}s
                  </td>
                  {isAdmin && (
                    <td style={{ padding: "8px 16px 8px 0", color: "#5a6a7a" }}>
                      {e.user?.email}
                    </td>
                  )}
                  <td style={{ padding: "8px 0", color: "#5a6a7a" }}>
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
