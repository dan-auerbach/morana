"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type StepResult = {
  id: string;
  stepIndex: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};

type Job = {
  id: string;
  status: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  recipe: { name: string; slug: string };
  user: { email: string };
  stepResults: StepResult[];
};

export default function JobsPage() {
  const { data: session } = useSession();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/jobs");
      const data = await resp.json();
      setJobs(data.jobs || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Poll while running jobs exist
  useEffect(() => {
    const hasRunning = jobs.some(
      (j) => j.status === "running" || j.status === "pending"
    );
    if (!hasRunning) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [jobs, load]);

  async function handleAction(jobId: string, action: "cancel" | "retry") {
    setActionLoading(jobId);
    try {
      const resp = await fetch(`/api/jobs/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await resp.json();
      if (data.newJobId) {
        setExpandedJob(data.newJobId);
      }
      load();
    } catch {
      /* ignore */
    } finally {
      setActionLoading(null);
    }
  }

  if (!session)
    return (
      <div style={{ color: "#ff4444" }}>[ERROR] Authentication required.</div>
    );

  const statusColor = (s: string) => {
    if (s === "done") return "#00ff88";
    if (s === "running" || s === "pending") return "#ffcc00";
    if (s === "error") return "#ff4444";
    if (s === "cancelled") return "#5a6a7a";
    return "#5a6a7a";
  };

  const statusIcon = (s: string) => {
    if (s === "done") return "✓";
    if (s === "running") return "⟳";
    if (s === "pending") return "◷";
    if (s === "error") return "✕";
    if (s === "cancelled") return "⊘";
    return "?";
  };

  const filteredJobs =
    filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  const counts = {
    all: jobs.length,
    running: jobs.filter((j) => j.status === "running" || j.status === "pending").length,
    done: jobs.filter((j) => j.status === "done").length,
    error: jobs.filter((j) => j.status === "error").length,
    cancelled: jobs.filter((j) => j.status === "cancelled").length,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div
          style={{
            color: "#ff8800",
            fontSize: "18px",
            fontWeight: 700,
            marginBottom: "4px",
          }}
        >
          [JOBS]
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>
          $ jobs --monitor --status
        </div>
      </div>

      {/* Summary bar */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          marginBottom: "20px",
          padding: "12px 16px",
          border: "1px solid #1e2a3a",
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "#e0e0e0", "Total"],
            ["running", "#ffcc00", "Running"],
            ["done", "#00ff88", "Done"],
            ["error", "#ff4444", "Error"],
            ["cancelled", "#5a6a7a", "Cancelled"],
          ] as [string, string, string][]
        ).map(([key, color, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              background:
                filter === key ? `rgba(${color === "#e0e0e0" ? "224,224,224" : color === "#ffcc00" ? "255,204,0" : color === "#00ff88" ? "0,255,136" : color === "#ff4444" ? "255,68,68" : "90,106,122"}, 0.1)` : "transparent",
              border:
                filter === key
                  ? `1px solid ${color}`
                  : "1px solid transparent",
              color,
              padding: "4px 12px",
              fontFamily: "inherit",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span style={{ fontSize: "16px", fontWeight: 700 }}>
              {counts[key as keyof typeof counts]}
            </span>
            <span style={{ fontSize: "10px", textTransform: "uppercase" }}>
              {label}
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div
          style={{ color: "#00ff88", fontSize: "13px", marginBottom: "12px" }}
        >
          Loading...
        </div>
      )}

      {/* Jobs list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {filteredJobs.map((job) => {
          const isExpanded = expandedJob === job.id;
          const duration =
            job.finishedAt && job.startedAt
              ? Math.round(
                  (new Date(job.finishedAt).getTime() -
                    new Date(job.startedAt).getTime()) /
                    1000
                )
              : null;

          return (
            <div
              key={job.id}
              style={{
                border: `1px solid ${isExpanded ? statusColor(job.status) : "#1e2a3a"}`,
              }}
            >
              {/* Job row */}
              <div
                onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                style={{
                  padding: "10px 16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                {/* Status icon */}
                <span
                  style={{
                    color: statusColor(job.status),
                    fontSize: "14px",
                    fontWeight: 700,
                    width: "20px",
                    textAlign: "center",
                  }}
                >
                  {statusIcon(job.status)}
                </span>

                {/* Status label */}
                <span
                  style={{
                    color: statusColor(job.status),
                    fontWeight: 700,
                    fontSize: "10px",
                    textTransform: "uppercase",
                    width: "70px",
                  }}
                >
                  {job.status}
                </span>

                {/* Recipe name */}
                <span
                  style={{ color: "#e0e0e0", fontSize: "12px", flex: 1 }}
                >
                  {job.recipe.name}
                </span>

                {/* Progress for running */}
                {(job.status === "running" || job.status === "pending") && (
                  <span style={{ color: "#ffcc00", fontSize: "10px" }}>
                    {job.progress}% — step {job.currentStep + 1}/
                    {job.totalSteps}
                  </span>
                )}

                {/* Duration */}
                {duration !== null && (
                  <span style={{ color: "#5a6a7a", fontSize: "10px" }}>
                    {duration}s
                  </span>
                )}

                {/* Timestamp */}
                <span style={{ color: "#5a6a7a", fontSize: "10px" }}>
                  {new Date(job.startedAt).toLocaleString("sl-SI", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>

                {/* Expand arrow */}
                <span
                  style={{
                    color: isExpanded ? statusColor(job.status) : "#444",
                    fontSize: "10px",
                  }}
                >
                  {isExpanded ? "▼" : "▶"}
                </span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div
                  style={{
                    padding: "0 16px 12px",
                    borderTop: "1px solid rgba(30, 42, 58, 0.5)",
                  }}
                >
                  {/* Info row */}
                  <div
                    style={{
                      display: "flex",
                      gap: "20px",
                      marginTop: "10px",
                      marginBottom: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "9px",
                          color: "#5a6a7a",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Job ID
                      </div>
                      <div style={{ fontSize: "11px", color: "#8b949e" }}>
                        {job.id.substring(0, 12)}...
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "9px",
                          color: "#5a6a7a",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        User
                      </div>
                      <div style={{ fontSize: "11px", color: "#8b949e" }}>
                        {job.user.email}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "9px",
                          color: "#5a6a7a",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Started
                      </div>
                      <div style={{ fontSize: "11px", color: "#8b949e" }}>
                        {new Date(job.startedAt).toLocaleString("sl-SI")}
                      </div>
                    </div>
                    {job.finishedAt && (
                      <div>
                        <div
                          style={{
                            fontSize: "9px",
                            color: "#5a6a7a",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Finished
                        </div>
                        <div style={{ fontSize: "11px", color: "#8b949e" }}>
                          {new Date(job.finishedAt).toLocaleString("sl-SI")}
                        </div>
                      </div>
                    )}
                    {duration !== null && (
                      <div>
                        <div
                          style={{
                            fontSize: "9px",
                            color: "#5a6a7a",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          Duration
                        </div>
                        <div style={{ fontSize: "11px", color: "#8b949e" }}>
                          {duration}s
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Progress bar for running */}
                  {(job.status === "running" || job.status === "pending") && (
                    <div style={{ marginBottom: "12px" }}>
                      <div
                        style={{
                          height: "4px",
                          backgroundColor: "#1e2a3a",
                          borderRadius: "2px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${job.progress}%`,
                            backgroundColor: "#ffcc00",
                            transition: "width 0.5s",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "#5a6a7a",
                          marginTop: "4px",
                        }}
                      >
                        Step{" "}
                        {Math.min(job.currentStep + 1, job.totalSteps)}{" "}
                        of {job.totalSteps} — {job.progress}%
                      </div>
                    </div>
                  )}

                  {/* Error message */}
                  {job.errorMessage && (
                    <div
                      style={{
                        color: "#ff4444",
                        fontSize: "11px",
                        marginBottom: "12px",
                        padding: "8px",
                        backgroundColor: "rgba(255, 68, 68, 0.05)",
                        border: "1px solid rgba(255, 68, 68, 0.2)",
                      }}
                    >
                      [ERROR] {job.errorMessage}
                    </div>
                  )}

                  {/* Step results timeline */}
                  {job.stepResults.length > 0 && (
                    <div style={{ marginBottom: "12px" }}>
                      <div
                        style={{
                          fontSize: "9px",
                          color: "#5a6a7a",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          marginBottom: "8px",
                        }}
                      >
                        Steps
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "4px",
                          flexWrap: "wrap",
                        }}
                      >
                        {job.stepResults.map((sr) => {
                          const stepDuration =
                            sr.finishedAt && sr.startedAt
                              ? Math.round(
                                  (new Date(sr.finishedAt).getTime() -
                                    new Date(sr.startedAt).getTime()) /
                                    1000
                                )
                              : null;
                          return (
                            <div
                              key={sr.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "4px 8px",
                                border: `1px solid ${statusColor(sr.status)}`,
                                backgroundColor: `rgba(${sr.status === "done" ? "0,255,136" : sr.status === "error" ? "255,68,68" : sr.status === "running" ? "255,204,0" : "90,106,122"}, 0.05)`,
                              }}
                            >
                              <span
                                style={{
                                  color: "#ffcc00",
                                  fontWeight: 700,
                                  fontSize: "9px",
                                }}
                              >
                                #{sr.stepIndex + 1}
                              </span>
                              <span
                                style={{
                                  color: statusColor(sr.status),
                                  fontWeight: 700,
                                  fontSize: "9px",
                                  textTransform: "uppercase",
                                }}
                              >
                                {sr.status}
                              </span>
                              {stepDuration !== null && (
                                <span
                                  style={{
                                    color: "#5a6a7a",
                                    fontSize: "9px",
                                  }}
                                >
                                  {stepDuration}s
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <Link
                      href={`/recipes/${job.id}`}
                      className="no-underline"
                      style={{
                        padding: "6px 14px",
                        border: "1px solid #00e5ff",
                        color: "#00e5ff",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      VIEW DETAIL
                    </Link>
                    {(job.status === "running" ||
                      job.status === "pending") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction(job.id, "cancel");
                        }}
                        disabled={actionLoading === job.id}
                        style={{
                          padding: "6px 14px",
                          background: "transparent",
                          border: "1px solid #ff4444",
                          color: "#ff4444",
                          fontFamily: "inherit",
                          fontSize: "10px",
                          fontWeight: 700,
                          cursor: "pointer",
                          textTransform: "uppercase",
                        }}
                      >
                        {actionLoading === job.id ? "..." : "CANCEL"}
                      </button>
                    )}
                    {(job.status === "error" ||
                      job.status === "cancelled") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction(job.id, "retry");
                        }}
                        disabled={actionLoading === job.id}
                        style={{
                          padding: "6px 14px",
                          background: "transparent",
                          border: "1px solid #ffcc00",
                          color: "#ffcc00",
                          fontFamily: "inherit",
                          fontSize: "10px",
                          fontWeight: 700,
                          cursor: "pointer",
                          textTransform: "uppercase",
                        }}
                      >
                        {actionLoading === job.id ? "..." : "RETRY"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {!loading && filteredJobs.length === 0 && (
          <div
            style={{
              color: "#333",
              fontSize: "12px",
              padding: "40px 20px",
              textAlign: "center",
            }}
          >
            {filter === "all"
              ? "No jobs yet. Execute a recipe to see jobs here."
              : `No ${filter} jobs.`}
          </div>
        )}
      </div>
    </div>
  );
}
