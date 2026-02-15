"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import StatusBadge from "../components/StatusBadge";

type Run = {
  id: string;
  type: string;
  status: string;
  provider: string;
  model: string;
  createdAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  user: { email: string; name: string | null };
  preview?: string;
};

type RunDetail = {
  id: string;
  type: string;
  status: string;
  provider: string;
  model: string;
  createdAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
};

export default function HistoryPage() {
  const { data: session } = useSession();
  const [runs, setRuns] = useState<Run[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (typeFilter) params.set("type", typeFilter);
    const resp = await fetch(`/api/history?${params}`);
    const data = await resp.json();
    setRuns(data.runs || []);
    setPages(data.pages || 1);
    setLoading(false);
  }, [page, typeFilter]);

  useEffect(() => {
    if (session) fetchRuns();
  }, [session, fetchRuns]);

  async function toggleExpand(runId: string) {
    if (expandedId === runId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(runId);

    if (!details[runId]) {
      setLoadingDetail(runId);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout
        const resp = await fetch(`/api/runs/${runId}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({ error: "Failed to load" }));
          setDetails((prev) => ({
            ...prev,
            [runId]: {
              id: runId,
              type: "unknown",
              status: "error",
              provider: "",
              model: "",
              createdAt: "",
              finishedAt: null,
              errorMessage: errData.error || `HTTP ${resp.status}`,
              input: null,
              output: null,
            },
          }));
        } else {
          const data = await resp.json();
          setDetails((prev) => ({ ...prev, [runId]: data }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load details";
        setDetails((prev) => ({
          ...prev,
          [runId]: {
            id: runId,
            type: "unknown",
            status: "error",
            provider: "",
            model: "",
            createdAt: "",
            finishedAt: null,
            errorMessage: message.includes("abort") ? "Request timed out" : message,
            input: null,
            output: null,
          },
        }));
      } finally {
        setLoadingDetail(null);
      }
    }
  }

  if (!session) {
    return (
      <div style={{ color: "#5a6a7a" }}>
        <span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required. Please sign in.
      </div>
    );
  }

  function renderInputOutput(detail: RunDetail) {
    const input = detail.input as Record<string, string> | null;
    const output = detail.output as Record<string, string | number> | null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Input section */}
        {input && (
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#ffcc00",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "6px",
              }}
            >
              INPUT:
            </div>
            {detail.type === "llm" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {input.prompt && (
                  <div>
                    <span style={{ color: "#00ff88", fontSize: "11px" }}>--prompt </span>
                    <div
                      style={{
                        marginTop: "4px",
                        padding: "8px 12px",
                        backgroundColor: "#111820",
                        border: "1px solid #1e2a3a",
                        fontSize: "12px",
                        color: "#e0e0e0",
                        whiteSpace: "pre-wrap",
                        maxHeight: "200px",
                        overflow: "auto",
                      }}
                    >
                      {String(input.prompt)}
                    </div>
                  </div>
                )}
                {input.sourceText && (
                  <div>
                    <span style={{ color: "#00ff88", fontSize: "11px" }}>--source </span>
                    <div
                      style={{
                        marginTop: "4px",
                        padding: "8px 12px",
                        backgroundColor: "#111820",
                        border: "1px solid #1e2a3a",
                        fontSize: "12px",
                        color: "#5a6a7a",
                        whiteSpace: "pre-wrap",
                        maxHeight: "150px",
                        overflow: "auto",
                      }}
                    >
                      {String(input.sourceText).slice(0, 500)}
                      {String(input.sourceText).length > 500 && "..."}
                    </div>
                  </div>
                )}
              </div>
            )}
            {detail.type === "tts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {input.text && (
                  <div>
                    <span style={{ color: "#00ff88", fontSize: "11px" }}>--text </span>
                    <div
                      style={{
                        marginTop: "4px",
                        padding: "8px 12px",
                        backgroundColor: "#111820",
                        border: "1px solid #1e2a3a",
                        fontSize: "12px",
                        color: "#e0e0e0",
                        whiteSpace: "pre-wrap",
                        maxHeight: "150px",
                        overflow: "auto",
                      }}
                    >
                      {String(input.text)}
                    </div>
                  </div>
                )}
                {input.voiceId && (
                  <div style={{ fontSize: "11px", color: "#5a6a7a", marginTop: "4px" }}>
                    <span style={{ color: "#00ff88" }}>--voice</span> {String(input.voiceId)}
                  </div>
                )}
              </div>
            )}
            {detail.type === "stt" && (
              <div style={{ fontSize: "12px", color: "#5a6a7a" }}>
                {input.language && (
                  <span>
                    <span style={{ color: "#00ff88" }}>--lang</span> {String(input.language)}{" "}
                  </span>
                )}
                {input.mimeType && (
                  <span>
                    <span style={{ color: "#00ff88" }}>--mime</span> {String(input.mimeType)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Output section */}
        {output && (
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#00ff88",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "6px",
              }}
            >
              OUTPUT:
            </div>
            {detail.type === "llm" && output.text && (
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#0d1117",
                  border: "1px solid rgba(0, 255, 136, 0.2)",
                  fontSize: "12px",
                  color: "#e0e0e0",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                  maxHeight: "300px",
                  overflow: "auto",
                }}
              >
                {String(output.text)}
              </div>
            )}
            {detail.type === "stt" && output.text && (
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#0d1117",
                  border: "1px solid rgba(0, 255, 136, 0.2)",
                  fontSize: "12px",
                  color: "#e0e0e0",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                  maxHeight: "300px",
                  overflow: "auto",
                }}
              >
                {String(output.text)}
              </div>
            )}
            {/* Stats row */}
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginTop: "8px",
                fontSize: "11px",
              }}
            >
              {output.inputTokens != null && (
                <span>
                  <span style={{ color: "#ffcc00" }}>IN:</span>{" "}
                  <span style={{ color: "#00e5ff" }}>{String(output.inputTokens)}</span>{" "}
                  <span style={{ color: "#5a6a7a" }}>tokens</span>
                </span>
              )}
              {output.outputTokens != null && (
                <span>
                  <span style={{ color: "#ffcc00" }}>OUT:</span>{" "}
                  <span style={{ color: "#00e5ff" }}>{String(output.outputTokens)}</span>{" "}
                  <span style={{ color: "#5a6a7a" }}>tokens</span>
                </span>
              )}
              {output.latencyMs != null && (
                <span>
                  <span style={{ color: "#ffcc00" }}>LATENCY:</span>{" "}
                  <span style={{ color: "#00e5ff" }}>
                    {(Number(output.latencyMs) / 1000).toFixed(1)}s
                  </span>
                </span>
              )}
              {output.chars != null && (
                <span>
                  <span style={{ color: "#ffcc00" }}>CHARS:</span>{" "}
                  <span style={{ color: "#00e5ff" }}>{String(output.chars)}</span>
                </span>
              )}
              {output.durationSeconds != null && (
                <span>
                  <span style={{ color: "#ffcc00" }}>DURATION:</span>{" "}
                  <span style={{ color: "#00e5ff" }}>
                    {Number(output.durationSeconds).toFixed(1)}s
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {detail.errorMessage && (
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: "rgba(255, 68, 68, 0.08)",
              border: "1px solid rgba(255, 68, 68, 0.3)",
              fontSize: "12px",
              color: "#ff4444",
            }}
          >
            <span style={{ fontWeight: 700 }}>[ERROR]</span> {detail.errorMessage}
          </div>
        )}

        {/* Timing */}
        {detail.finishedAt && (
          <div style={{ fontSize: "11px", color: "#5a6a7a" }}>
            <span style={{ color: "#00ff88" }}>FINISHED:</span>{" "}
            {new Date(detail.finishedAt).toLocaleString()}
          </div>
        )}
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
          [HISTORY]
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>
          $ query runs --page {page} {typeFilter ? `--type ${typeFilter}` : "--all"}{" "}
          <span style={{ color: "#5a6a7a", opacity: 0.5 }}>// click row to expand</span>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "20px",
          paddingBottom: "12px",
          borderBottom: "1px solid #1e2a3a",
        }}
      >
        <label
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#00ff88",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          --type
        </label>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
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
          <option value="llm">llm</option>
          <option value="stt">stt</option>
          <option value="tts">tts</option>
          <option value="image">image</option>
        </select>
        {isAdmin && (
          <span style={{ fontSize: "11px", color: "#ffcc00" }}>
            [ADMIN] viewing all users
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: "#00ff88", fontSize: "13px" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Querying database...
        </div>
      ) : runs.length === 0 ? (
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>
          [INFO] No runs found matching query.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isAdmin
                ? "60px 80px 90px 140px 1fr 160px"
                : "60px 80px 90px 1fr 160px",
              borderBottom: "1px solid #00ff88",
              padding: "8px 0",
              gap: "8px",
            }}
          >
            {["TYPE", "STATUS", "PROVIDER", ...(isAdmin ? ["USER"] : ["PREVIEW"]), "CREATED"].map(
              (h) => (
                <div
                  key={h}
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#00ff88",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {h}
                </div>
              )
            )}
          </div>

          {/* Rows */}
          {runs.map((r) => {
            const isExpanded = expandedId === r.id;
            const detail = details[r.id];
            const isLoadingThis = loadingDetail === r.id;

            return (
              <div key={r.id}>
                {/* Row */}
                <div
                  onClick={() => toggleExpand(r.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isAdmin
                      ? "60px 80px 90px 140px 1fr 160px"
                      : "60px 80px 90px 1fr 160px",
                    padding: "8px 0",
                    gap: "8px",
                    borderBottom: isExpanded
                      ? "1px solid rgba(0, 255, 136, 0.2)"
                      : "1px solid rgba(30, 42, 58, 0.5)",
                    cursor: "pointer",
                    transition: "background-color 0.15s",
                    backgroundColor: isExpanded ? "rgba(0, 255, 136, 0.03)" : "transparent",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => {
                    if (!isExpanded) {
                      e.currentTarget.style.backgroundColor = "rgba(0, 255, 136, 0.03)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isExpanded) {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  <div
                    style={{
                      textTransform: "uppercase",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#ffcc00",
                    }}
                  >
                    <span style={{ color: isExpanded ? "#00ff88" : "#444", marginRight: "4px" }}>
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    {r.type}
                  </div>
                  <div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div style={{ fontSize: "12px", color: "#e0e0e0" }}>{r.provider}</div>
                  {isAdmin ? (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#5a6a7a",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.user?.email}
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#8b949e",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.preview || r.model}
                    </div>
                  )}
                  <div style={{ fontSize: "12px", color: "#5a6a7a" }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div
                    style={{
                      padding: "16px",
                      backgroundColor: "rgba(13, 17, 23, 0.8)",
                      borderBottom: "1px solid rgba(0, 255, 136, 0.15)",
                      borderLeft: "2px solid #00ff88",
                      marginLeft: "8px",
                    }}
                  >
                    {isLoadingThis ? (
                      <div style={{ color: "#00ff88", fontSize: "12px" }}>
                        <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading
                        run details...
                      </div>
                    ) : detail ? (
                      renderInputOutput(detail)
                    ) : (
                      <div style={{ color: "#5a6a7a", fontSize: "12px" }}>
                        [INFO] No details available.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            paddingTop: "12px",
            borderTop: "1px solid #1e2a3a",
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid #1e2a3a",
              color: page === 1 ? "#5a6a7a" : "#00ff88",
              fontFamily: "inherit",
              fontSize: "12px",
              cursor: page === 1 ? "not-allowed" : "pointer",
              opacity: page === 1 ? 0.5 : 1,
            }}
          >
            [PREV]
          </button>
          <span style={{ fontSize: "12px", color: "#5a6a7a" }}>
            <span style={{ color: "#ffcc00" }}>PAGE:</span>{" "}
            <span style={{ color: "#e0e0e0" }}>{page}</span> / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            style={{
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid #1e2a3a",
              color: page === pages ? "#5a6a7a" : "#00ff88",
              fontFamily: "inherit",
              fontSize: "12px",
              cursor: page === pages ? "not-allowed" : "pointer",
              opacity: page === pages ? 0.5 : 1,
            }}
          >
            [NEXT]
          </button>
        </div>
      )}
    </div>
  );
}
