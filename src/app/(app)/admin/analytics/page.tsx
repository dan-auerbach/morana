"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";

/* ─── MORANA color tokens ─── */
const C = {
  success: "var(--green)",
  error: "var(--red)",
  warning: "var(--yellow)",
  accent: "#ff8800",
  info: "var(--cyan)",
  muted: "var(--gray)",
  text: "var(--white)",
  border: "var(--border)",
  bg: "var(--bg-panel)",
} as const;

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

/* ─── Types ─── */

interface ProviderMetrics {
  provider: string;
  runs: number;
  errors: number;
  errorRate: number;
  avgLatencyMs: number;
  totalCostCents: number;
}

interface ModelMetrics {
  model: string;
  runs: number;
  avgLatencyMs: number;
  totalCostCents: number;
}

interface ExecutionMetrics {
  total: number;
  avgDurationMs: number;
  successRate: number;
}

interface AnalyticsData {
  period: string;
  totalRuns: number;
  totalCostCents: number;
  errorRate: number;
  avgLatencyMs: number;
  byProvider: ProviderMetrics[];
  byModel: ModelMetrics[];
  executionMetrics: ExecutionMetrics;
}

type Period = "7d" | "30d" | "90d";

/* ─── Helpers ─── */

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString()} ms`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/* ─── Reusable components ─── */

function SummaryCard({
  label,
  value,
  color = C.text,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        padding: "16px 20px",
        flex: "1 1 0",
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: C.muted,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          fontFamily: MONO,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 14,
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: C.accent,
        marginBottom: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </h2>
  );
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <tr>
      {columns.map((col) => (
        <th
          key={col}
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: C.success,
            padding: "8px 12px",
            borderBottom: `1px solid ${C.border}`,
            textAlign: "left",
            fontWeight: 700,
          }}
        >
          {col}
        </th>
      ))}
    </tr>
  );
}

function TableCell({
  children,
  color = C.text,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        borderBottom: `1px solid ${C.border}`,
        color,
        fontFamily: MONO,
        fontSize: 13,
      }}
    >
      {children}
    </td>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <TableCell color={C.muted}>no data</TableCell>
      {Array.from({ length: cols - 1 }).map((_, i) => (
        <TableCell key={i}>{""}</TableCell>
      ))}
    </tr>
  );
}

/* ─── Main page ─── */

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin =
    (session?.user as Record<string, unknown> | undefined)?.role === "admin";

  const fetchAnalytics = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/admin/analytics?period=${period}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json: AnalyticsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [period]);

  /* Fetch on mount, on period change, and auto-refresh every 30s */
  useEffect(() => {
    setLoading(true);
    fetchAnalytics();

    const interval = setInterval(fetchAnalytics, 30_000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  /* ─── Auth gates ─── */

  if (status === "loading") {
    return (
      <div style={{ ...pageStyle, color: C.muted }}>
        <span style={{ fontFamily: "monospace" }}>loading session...</span>
      </div>
    );
  }

  if (!session || !isAdmin) {
    return (
      <div style={{ ...pageStyle, color: C.error }}>
        <span style={{ fontFamily: "monospace" }}>
          [ACCESS DENIED] admin role required
        </span>
      </div>
    );
  }

  /* ─── Render ─── */

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: C.accent,
            margin: 0,
            fontFamily: MONO,
          }}
        >
          [ANALYTICS]
        </h1>
        <div
          style={{
            fontSize: 13,
            color: C.muted,
            fontFamily: MONO,
            marginTop: 4,
          }}
        >
          $ analytics --admin --metrics
        </div>
      </div>

      {/* Period selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {(["7d", "30d", "90d"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontFamily: MONO,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              cursor: "pointer",
              border: `1px solid ${period === p ? C.success : C.border}`,
              borderRadius: 3,
              background: period === p ? "rgba(0,255,136,0.08)" : "transparent",
              color: period === p ? C.success : C.muted,
              transition: "all 0.15s ease",
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && !data && (
        <div
          style={{
            color: C.muted,
            fontFamily: "monospace",
            fontSize: 13,
            padding: 20,
          }}
        >
          fetching analytics...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            color: C.error,
            fontFamily: "monospace",
            fontSize: 13,
            padding: "12px 16px",
            border: `1px solid ${C.error}`,
            borderRadius: 4,
            marginBottom: 20,
          }}
        >
          [ERROR] {error}
        </div>
      )}

      {data && (
        <>
          {/* ─── Summary cards ─── */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle>Summary</SectionTitle>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <SummaryCard
                label="Total Runs"
                value={data.totalRuns.toLocaleString()}
                color={C.info}
              />
              <SummaryCard
                label="Total Cost"
                value={formatUsd(data.totalCostCents)}
                color={C.warning}
              />
              <SummaryCard
                label="Error Rate"
                value={formatPct(data.errorRate)}
                color={data.errorRate > 5 ? C.error : C.success}
              />
              <SummaryCard
                label="Avg Latency"
                value={formatMs(data.avgLatencyMs)}
                color={C.text}
              />
            </div>
          </div>

          {/* ─── Provider breakdown table ─── */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle>Provider Breakdown</SectionTitle>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <TableHeader
                    columns={[
                      "Provider",
                      "Runs",
                      "Errors",
                      "Error %",
                      "Avg Latency",
                      "Total Cost",
                    ]}
                  />
                </thead>
                <tbody>
                  {data.byProvider.length > 0 ? (
                    data.byProvider.map((row) => (
                      <tr key={row.provider}>
                        <TableCell color={C.text}>{row.provider}</TableCell>
                        <TableCell>{row.runs.toLocaleString()}</TableCell>
                        <TableCell color={row.errors > 0 ? C.error : C.text}>
                          {row.errors.toLocaleString()}
                        </TableCell>
                        <TableCell
                          color={row.errorRate > 5 ? C.error : C.success}
                        >
                          {formatPct(row.errorRate)}
                        </TableCell>
                        <TableCell>{formatMs(row.avgLatencyMs)}</TableCell>
                        <TableCell color={C.warning}>
                          {formatUsd(row.totalCostCents)}
                        </TableCell>
                      </tr>
                    ))
                  ) : (
                    <EmptyRow cols={6} />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Model breakdown table ─── */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle>Model Breakdown</SectionTitle>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <TableHeader
                    columns={["Model", "Runs", "Avg Latency", "Total Cost"]}
                  />
                </thead>
                <tbody>
                  {data.byModel.length > 0 ? (
                    data.byModel.map((row) => (
                      <tr key={row.model}>
                        <TableCell color={C.text}>{row.model}</TableCell>
                        <TableCell>{row.runs.toLocaleString()}</TableCell>
                        <TableCell>{formatMs(row.avgLatencyMs)}</TableCell>
                        <TableCell color={C.warning}>
                          {formatUsd(row.totalCostCents)}
                        </TableCell>
                      </tr>
                    ))
                  ) : (
                    <EmptyRow cols={4} />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Execution metrics ─── */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle>Execution Metrics</SectionTitle>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <SummaryCard
                label="Total Executions"
                value={data.executionMetrics.total.toLocaleString()}
                color={C.info}
              />
              <SummaryCard
                label="Avg Duration"
                value={formatDuration(data.executionMetrics.avgDurationMs)}
                color={C.text}
              />
              <SummaryCard
                label="Success Rate"
                value={formatPct(data.executionMetrics.successRate)}
                color={
                  data.executionMetrics.successRate >= 95 ? C.success : C.error
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Shared styles ─── */

const pageStyle: React.CSSProperties = {
  backgroundColor: C.bg,
  color: C.text,
  minHeight: "100vh",
  padding: "32px 40px",
  fontFamily: MONO,
  fontSize: 14,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: MONO,
};
