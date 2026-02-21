"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import StatusBadge from "@/app/components/StatusBadge";
import { useT } from "@/app/components/I18nProvider";

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
  const t = useT("history");
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
      <div style={{ color: "var(--gray)" }}>
        <span style={{ color: "var(--red)" }}>{t("errorLabel")}</span> {t("authRequired")}
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
                color: "var(--yellow)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "6px",
              }}
            >
              {t("input")}
            </div>
            {detail.type === "llm" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {input.prompt && (
                  <div>
                    <span style={{ color: "var(--green)", fontSize: "11px" }}>{t("prompt")} </span>
                    <div
                      style={{
                        marginTop: "4px",
                        padding: "8px 12px",
                        backgroundColor: "var(--bg-input)",
                        border: "1px solid var(--border)",
                        fontSize: "12px",
                        color: "var(--white)",
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
                    <span style={{ color: "var(--green)", fontSize: "11px" }}>{t("source")} </span>
                    <div
                      style={{
                        marginTop: "4px",
                        padding: "8px 12px",
                        backgroundColor: "var(--bg-input)",
                        border: "1px solid var(--border)",
                        fontSize: "12px",
                        color: "var(--gray)",
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
                    <span style={{ color: "var(--green)", fontSize: "11px" }}>{t("text")} </span>
                    <div
                      style={{
                        marginTop: "4px",
                        padding: "8px 12px",
                        backgroundColor: "var(--bg-input)",
                        border: "1px solid var(--border)",
                        fontSize: "12px",
                        color: "var(--white)",
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
                  <div style={{ fontSize: "11px", color: "var(--gray)", marginTop: "4px" }}>
                    <span style={{ color: "var(--green)" }}>{t("voiceLabel")}</span> {String(input.voiceId)}
                  </div>
                )}
              </div>
            )}
            {detail.type === "stt" && (
              <div style={{ fontSize: "12px", color: "var(--gray)" }}>
                {input.language && (
                  <span>
                    <span style={{ color: "var(--green)" }}>{t("lang")}</span> {String(input.language)}{" "}
                  </span>
                )}
                {input.mimeType && (
                  <span>
                    <span style={{ color: "var(--green)" }}>{t("mime")}</span> {String(input.mimeType)}
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
                color: "var(--green)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "6px",
              }}
            >
              {t("output")}
            </div>
            {detail.type === "llm" && output.text && (
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid rgba(0, 255, 136, 0.2)",
                  fontSize: "12px",
                  color: "var(--white)",
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
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid rgba(0, 255, 136, 0.2)",
                  fontSize: "12px",
                  color: "var(--white)",
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
                  <span style={{ color: "var(--yellow)" }}>IN:</span>{" "}
                  <span style={{ color: "var(--cyan)" }}>{String(output.inputTokens)}</span>{" "}
                  <span style={{ color: "var(--gray)" }}>{t("tokens")}</span>
                </span>
              )}
              {output.outputTokens != null && (
                <span>
                  <span style={{ color: "var(--yellow)" }}>OUT:</span>{" "}
                  <span style={{ color: "var(--cyan)" }}>{String(output.outputTokens)}</span>{" "}
                  <span style={{ color: "var(--gray)" }}>{t("tokens")}</span>
                </span>
              )}
              {output.latencyMs != null && (
                <span>
                  <span style={{ color: "var(--yellow)" }}>LATENCY:</span>{" "}
                  <span style={{ color: "var(--cyan)" }}>
                    {(Number(output.latencyMs) / 1000).toFixed(1)}s
                  </span>
                </span>
              )}
              {output.chars != null && (
                <span>
                  <span style={{ color: "var(--yellow)" }}>{t("charsLabel")}</span>{" "}
                  <span style={{ color: "var(--cyan)" }}>{String(output.chars)}</span>
                </span>
              )}
              {output.durationSeconds != null && (
                <span>
                  <span style={{ color: "var(--yellow)" }}>{t("durationLabel")}</span>{" "}
                  <span style={{ color: "var(--cyan)" }}>
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
              color: "var(--red)",
            }}
          >
            <span style={{ fontWeight: 700 }}>{t("errorLabel")}</span> {detail.errorMessage}
          </div>
        )}

        {/* Timing */}
        {detail.finishedAt && (
          <div style={{ fontSize: "11px", color: "var(--gray)" }}>
            <span style={{ color: "var(--green)" }}>{t("finished")}</span>{" "}
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
            color: "var(--green)",
            fontSize: "18px",
            fontWeight: 700,
            marginBottom: "4px",
          }}
        >
          {t("title")}
        </div>
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>
          {t("cmd").replace("{page}", String(page)).replace("{filter}", typeFilter ? `--type ${typeFilter}` : "--all")}{" "}
          <span style={{ color: "var(--gray)", opacity: 0.5 }}>{t("clickToExpand")}</span>
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
          borderBottom: "1px solid var(--border)",
        }}
      >
        <label
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "var(--green)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {t("type")}
        </label>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
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
          <option value="llm">llm</option>
          <option value="stt">stt</option>
          <option value="tts">tts</option>
          <option value="image">image</option>
        </select>
        {isAdmin && (
          <span style={{ fontSize: "11px", color: "var(--yellow)" }}>
            {t("adminViewing")}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: "var(--green)", fontSize: "13px" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> {t("querying")}
        </div>
      ) : runs.length === 0 ? (
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>
          {t("noRuns")}
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
              borderBottom: "1px solid var(--green)",
              padding: "8px 0",
              gap: "8px",
            }}
          >
            {[t("colType"), t("colStatus"), t("colProvider"), ...(isAdmin ? [t("colUser")] : [t("colPreview")]), t("colCreated")].map(
              (h) => (
                <div
                  key={h}
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--green)",
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
                      color: "var(--yellow)",
                    }}
                  >
                    <span style={{ color: isExpanded ? "var(--green)" : "#444", marginRight: "4px" }}>
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    {r.type}
                  </div>
                  <div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--white)" }}>{r.provider}</div>
                  {isAdmin ? (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--gray)",
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
                        color: "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.preview || r.model}
                    </div>
                  )}
                  <div style={{ fontSize: "12px", color: "var(--gray)" }}>
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
                      borderLeft: "2px solid var(--green)",
                      marginLeft: "8px",
                    }}
                  >
                    {isLoadingThis ? (
                      <div style={{ color: "var(--green)", fontSize: "12px" }}>
                        <span style={{ animation: "blink 1s step-end infinite" }}>_</span> {t("loadingDetails")}
                      </div>
                    ) : detail ? (
                      renderInputOutput(detail)
                    ) : (
                      <div style={{ color: "var(--gray)", fontSize: "12px" }}>
                        {t("noDetails")}
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
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: page === 1 ? "var(--gray)" : "var(--green)",
              fontFamily: "inherit",
              fontSize: "12px",
              cursor: page === 1 ? "not-allowed" : "pointer",
              opacity: page === 1 ? 0.5 : 1,
            }}
          >
            {t("prev")}
          </button>
          <span style={{ fontSize: "12px", color: "var(--gray)" }}>
            <span style={{ color: "var(--yellow)" }}>{t("page")}</span>{" "}
            <span style={{ color: "var(--white)" }}>{page}</span> / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            style={{
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: page === pages ? "var(--gray)" : "var(--green)",
              fontFamily: "inherit",
              fontSize: "12px",
              cursor: page === pages ? "not-allowed" : "pointer",
              opacity: page === pages ? 0.5 : 1,
            }}
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}
