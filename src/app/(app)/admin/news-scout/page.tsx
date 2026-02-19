"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";

type Topic = {
  id: string;
  name: string;
  description: string;
  negativeFilters: string[];
  maxSourcesPerRun: number;
  model: string;
  isActive: boolean;
  createdAt: string;
  _count: { runs: number };
};

type Source = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  rssUrl: string | null;
  selectors: Record<string, string> | null;
  isActive: boolean;
  createdAt: string;
};

type RunMeta = { url: string; title: string; reason: string };
type Run = {
  id: string;
  topicId: string;
  status: string;
  resultUrls: string[] | null;
  resultMeta: RunMeta[] | null;
  logs: { ts: string; phase: string; message: string }[] | null;
  errorMessage: string | null;
  costCents: number;
  candidateCount: number;
  createdAt: string;
  finishedAt: string | null;
  topic: { name: string };
};

type Tab = "topics" | "sources" | "runs";

/* ── Shared styles ─────────────────────────────────── */
const s = {
  label: { display: "block", fontSize: "10px", color: "#5a6a7a", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: "3px" },
  input: { width: "100%", padding: "6px 8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a", borderRadius: "4px", color: "#c9d1d9", fontFamily: "inherit", fontSize: "12px" },
  btn: (color: string, bg: string, border: string): React.CSSProperties => ({
    padding: "5px 12px", backgroundColor: bg, color, border: `1px solid ${border}`,
    borderRadius: "4px", fontFamily: "inherit", fontSize: "11px", fontWeight: 600, cursor: "pointer",
  }),
  row: { display: "grid", gap: "8px", padding: "8px 12px", borderBottom: "1px solid #111820", alignItems: "center" as const, fontSize: "12px" },
  badge: (color: string): React.CSSProperties => ({
    display: "inline-block", padding: "1px 6px", borderRadius: "3px", fontSize: "10px", fontWeight: 600,
    backgroundColor: `${color}15`, color, border: `1px solid ${color}30`,
  }),
};

export default function NewsScoutPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [tab, setTab] = useState<Tab>("topics");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Topic form ──
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [topicForm, setTopicForm] = useState({ name: "", description: "", model: "gpt-5-mini", negativeFilters: "", maxSourcesPerRun: "100" });

  // ── Source form ──
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState({ name: "", type: "rss", baseUrl: "", rssUrl: "", selectors: "" });

  // ── Run detail ──
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // ── Data loading ──
  const loadTopics = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/news-scout/topics");
      const data = await resp.json();
      setTopics(data.topics || []);
    } catch { setError("Failed to load topics"); }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/news-scout/sources");
      const data = await resp.json();
      setSources(data.sources || []);
    } catch { setError("Failed to load sources"); }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/news-scout/runs");
      const data = await resp.json();
      setRuns(data.runs || []);
    } catch { setError("Failed to load runs"); }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    await Promise.all([loadTopics(), loadSources(), loadRuns()]);
    setLoading(false);
  }, [loadTopics, loadSources, loadRuns]);

  useEffect(() => {
    if (session && isAdmin) loadAll();
  }, [session, isAdmin, loadAll]);

  if (!session) return <div style={{ padding: "40px", color: "#8b949e" }}>Authentication required.</div>;
  if (!isAdmin) return <div style={{ padding: "40px", color: "#ff4444" }}>[ACCESS DENIED] Admin privileges required.</div>;

  // ── Topic CRUD ──
  function resetTopicForm() {
    setTopicForm({ name: "", description: "", model: "gpt-5-mini", negativeFilters: "", maxSourcesPerRun: "100" });
    setEditingTopicId(null);
    setShowTopicForm(false);
  }

  function editTopic(t: Topic) {
    setTopicForm({
      name: t.name,
      description: t.description,
      model: t.model,
      negativeFilters: (t.negativeFilters || []).join(", "),
      maxSourcesPerRun: String(t.maxSourcesPerRun),
    });
    setEditingTopicId(t.id);
    setShowTopicForm(true);
  }

  async function saveTopic() {
    const negFilters = topicForm.negativeFilters.split(",").map((s) => s.trim()).filter(Boolean);
    const body = {
      name: topicForm.name,
      description: topicForm.description,
      model: topicForm.model,
      negativeFilters: negFilters,
      maxSourcesPerRun: parseInt(topicForm.maxSourcesPerRun) || 100,
    };

    const url = editingTopicId ? `/api/admin/news-scout/topics/${editingTopicId}` : "/api/admin/news-scout/topics";
    const method = editingTopicId ? "PATCH" : "POST";

    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json();
    if (data.error) { setError(data.error); return; }
    resetTopicForm();
    loadTopics();
  }

  async function deleteTopic(id: string) {
    if (!confirm("Delete this topic and all its runs?")) return;
    await fetch(`/api/admin/news-scout/topics/${id}`, { method: "DELETE" });
    loadTopics();
    loadRuns();
  }

  async function toggleTopic(t: Topic) {
    await fetch(`/api/admin/news-scout/topics/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !t.isActive }),
    });
    loadTopics();
  }

  async function triggerRun(topicId: string) {
    setError("");
    const resp = await fetch("/api/admin/news-scout/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId }),
    });
    const data = await resp.json();
    if (data.error) { setError(data.error); return; }
    setTab("runs");
    loadRuns();
  }

  // ── Source CRUD ──
  function resetSourceForm() {
    setSourceForm({ name: "", type: "rss", baseUrl: "", rssUrl: "", selectors: "" });
    setEditingSourceId(null);
    setShowSourceForm(false);
  }

  function editSource(src: Source) {
    setSourceForm({
      name: src.name,
      type: src.type,
      baseUrl: src.baseUrl,
      rssUrl: src.rssUrl || "",
      selectors: src.selectors ? JSON.stringify(src.selectors, null, 2) : "",
    });
    setEditingSourceId(src.id);
    setShowSourceForm(true);
  }

  async function saveSource() {
    let selectors = null;
    if (sourceForm.selectors.trim()) {
      try { selectors = JSON.parse(sourceForm.selectors); }
      catch { setError("Invalid JSON in selectors"); return; }
    }

    const body = {
      name: sourceForm.name,
      type: sourceForm.type,
      baseUrl: sourceForm.baseUrl,
      rssUrl: sourceForm.rssUrl || null,
      selectors,
    };

    const url = editingSourceId ? `/api/admin/news-scout/sources/${editingSourceId}` : "/api/admin/news-scout/sources";
    const method = editingSourceId ? "PATCH" : "POST";

    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json();
    if (data.error) { setError(data.error); return; }
    resetSourceForm();
    loadSources();
  }

  async function deleteSource(id: string) {
    if (!confirm("Delete this source?")) return;
    await fetch(`/api/admin/news-scout/sources/${id}`, { method: "DELETE" });
    loadSources();
  }

  async function toggleSource(src: Source) {
    await fetch(`/api/admin/news-scout/sources/${src.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !src.isActive }),
    });
    loadSources();
  }

  // ── Status helpers ──
  function statusColor(status: string) {
    if (status === "done") return "#00ff88";
    if (status === "error") return "#ff4444";
    return "#00e5ff";
  }

  function formatDuration(start: string, end: string | null) {
    if (!end) return "...";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // ── Tab buttons ──
  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      style={{
        padding: "6px 16px", border: "1px solid", borderRadius: "4px",
        fontFamily: "inherit", fontSize: "12px", fontWeight: 600, cursor: "pointer",
        backgroundColor: tab === t ? "rgba(255, 68, 68, 0.12)" : "transparent",
        color: tab === t ? "#ff4444" : "#5a6a7a",
        borderColor: tab === t ? "rgba(255, 68, 68, 0.3)" : "#1e2a3a",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", color: "#5a6a7a", marginBottom: "4px" }}>
          <span style={{ color: "#ff4444" }}>[ADMIN]</span> / <span style={{ color: "#ff8800" }}>[NEWS SCOUT]</span>
        </div>
        <div style={{ fontSize: "13px", color: "#6b7280" }}>$ news-scout --manage --admin</div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", marginBottom: "12px", backgroundColor: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: "4px", color: "#ff4444", fontSize: "12px" }}>
          {error}
          <button onClick={() => setError("")} style={{ float: "right", background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontFamily: "inherit" }}>x</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {tabBtn("topics", `Topics (${topics.length})`)}
        {tabBtn("sources", `Sources (${sources.length})`)}
        {tabBtn("runs", `Runs (${runs.length})`)}
        <button onClick={loadAll} style={{ ...s.btn("#5a6a7a", "transparent", "#1e2a3a"), marginLeft: "auto" }}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {/* ═══════════ TOPICS TAB ═══════════ */}
      {tab === "topics" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", color: "#5a6a7a" }}>{topics.length} topics | {topics.filter((t) => t.isActive).length} active</span>
            <button onClick={() => { resetTopicForm(); setShowTopicForm(!showTopicForm); }} style={s.btn("#ff4444", "rgba(255,68,68,0.08)", "rgba(255,68,68,0.3)")}>
              {showTopicForm ? "Cancel" : "+ New Topic"}
            </button>
          </div>

          {showTopicForm && (
            <div style={{ padding: "12px", marginBottom: "12px", border: "1px solid #1e2a3a", borderRadius: "4px", backgroundColor: "#0a0e14" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div>
                  <label style={s.label}>Name</label>
                  <input style={s.input} value={topicForm.name} onChange={(e) => setTopicForm({ ...topicForm, name: e.target.value })} placeholder="e.g. Longevity" />
                </div>
                <div>
                  <label style={s.label}>Model</label>
                  <input style={s.input} value={topicForm.model} onChange={(e) => setTopicForm({ ...topicForm, model: e.target.value })} placeholder="gpt-5-mini" />
                </div>
              </div>
              <div style={{ marginBottom: "8px" }}>
                <label style={s.label}>Description (used as search query for Google News)</label>
                <input style={s.input} value={topicForm.description} onChange={(e) => setTopicForm({ ...topicForm, description: e.target.value })} placeholder="e.g. longevity anti-aging research" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div>
                  <label style={s.label}>Negative filters (comma-separated)</label>
                  <input style={s.input} value={topicForm.negativeFilters} onChange={(e) => setTopicForm({ ...topicForm, negativeFilters: e.target.value })} placeholder="ad, sponsored, press release" />
                </div>
                <div>
                  <label style={s.label}>Max sources/run</label>
                  <input style={s.input} type="number" value={topicForm.maxSourcesPerRun} onChange={(e) => setTopicForm({ ...topicForm, maxSourcesPerRun: e.target.value })} />
                </div>
              </div>
              <button onClick={saveTopic} style={s.btn("#00ff88", "rgba(0,255,136,0.08)", "rgba(0,255,136,0.3)")}>
                {editingTopicId ? "Update" : "Create"} Topic
              </button>
            </div>
          )}

          {/* Topics table */}
          <div style={{ border: "1px solid #1e2a3a", borderRadius: "4px" }}>
            <div style={{ ...s.row, gridTemplateColumns: "2fr 2fr 1fr 1fr 1fr 120px", color: "#5a6a7a", borderBottom: "1px solid #1e2a3a", fontSize: "10px", textTransform: "uppercase" }}>
              <span>Name</span><span>Description</span><span>Model</span><span>Active</span><span>Runs</span><span>Actions</span>
            </div>
            {topics.map((t) => (
              <div key={t.id} style={{ ...s.row, gridTemplateColumns: "2fr 2fr 1fr 1fr 1fr 120px", color: t.isActive ? "#c9d1d9" : "#5a6a7a" }}>
                <span style={{ fontWeight: 600 }}>{t.name}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</span>
                <span style={s.badge("#00e5ff")}>{t.model}</span>
                <span>
                  <button onClick={() => toggleTopic(t)} style={{ ...s.btn(t.isActive ? "#00ff88" : "#5a6a7a", "transparent", t.isActive ? "rgba(0,255,136,0.3)" : "#1e2a3a"), fontSize: "10px", padding: "2px 8px" }}>
                    {t.isActive ? "ON" : "OFF"}
                  </button>
                </span>
                <span>{t._count.runs}</span>
                <span style={{ display: "flex", gap: "4px" }}>
                  <button onClick={() => triggerRun(t.id)} style={{ ...s.btn("#00e5ff", "rgba(0,229,255,0.08)", "rgba(0,229,255,0.3)"), fontSize: "10px", padding: "2px 6px" }}>Run</button>
                  <button onClick={() => editTopic(t)} style={{ ...s.btn("#ff8800", "transparent", "rgba(255,136,0,0.3)"), fontSize: "10px", padding: "2px 6px" }}>Edit</button>
                  <button onClick={() => deleteTopic(t.id)} style={{ ...s.btn("#ff4444", "transparent", "rgba(255,68,68,0.3)"), fontSize: "10px", padding: "2px 6px" }}>Del</button>
                </span>
              </div>
            ))}
            {topics.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "#5a6a7a", fontSize: "12px" }}>No topics yet. Create one to get started.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ SOURCES TAB ═══════════ */}
      {tab === "sources" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", color: "#5a6a7a" }}>{sources.length} sources | {sources.filter((src) => src.isActive).length} active</span>
            <button onClick={() => { resetSourceForm(); setShowSourceForm(!showSourceForm); }} style={s.btn("#ff4444", "rgba(255,68,68,0.08)", "rgba(255,68,68,0.3)")}>
              {showSourceForm ? "Cancel" : "+ New Source"}
            </button>
          </div>

          {showSourceForm && (
            <div style={{ padding: "12px", marginBottom: "12px", border: "1px solid #1e2a3a", borderRadius: "4px", backgroundColor: "#0a0e14" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div>
                  <label style={s.label}>Name</label>
                  <input style={s.input} value={sourceForm.name} onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })} placeholder="e.g. Nature" />
                </div>
                <div>
                  <label style={s.label}>Type</label>
                  <select style={s.input} value={sourceForm.type} onChange={(e) => setSourceForm({ ...sourceForm, type: e.target.value })}>
                    <option value="rss">RSS</option>
                    <option value="google_news">Google News</option>
                    <option value="html">HTML</option>
                    <option value="x">X (Twitter)</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div>
                  <label style={s.label}>Base URL</label>
                  <input style={s.input} value={sourceForm.baseUrl} onChange={(e) => setSourceForm({ ...sourceForm, baseUrl: e.target.value })} placeholder="https://example.com" />
                </div>
                {(sourceForm.type === "rss" || sourceForm.type === "google_news") && (
                  <div>
                    <label style={s.label}>RSS URL (optional, overrides base)</label>
                    <input style={s.input} value={sourceForm.rssUrl} onChange={(e) => setSourceForm({ ...sourceForm, rssUrl: e.target.value })} placeholder="https://example.com/feed.xml" />
                  </div>
                )}
              </div>
              {sourceForm.type === "html" && (
                <div style={{ marginBottom: "8px" }}>
                  <label style={s.label}>Selectors (JSON)</label>
                  <textarea
                    style={{ ...s.input, minHeight: "60px", resize: "vertical" }}
                    value={sourceForm.selectors}
                    onChange={(e) => setSourceForm({ ...sourceForm, selectors: e.target.value })}
                    placeholder={'{"listSelector":"article","titleSelector":"h2","linkSelector":"a","dateSelector":"time"}'}
                  />
                </div>
              )}
              <button onClick={saveSource} style={s.btn("#00ff88", "rgba(0,255,136,0.08)", "rgba(0,255,136,0.3)")}>
                {editingSourceId ? "Update" : "Create"} Source
              </button>
            </div>
          )}

          {/* Sources table */}
          <div style={{ border: "1px solid #1e2a3a", borderRadius: "4px" }}>
            <div style={{ ...s.row, gridTemplateColumns: "2fr 1fr 3fr 1fr 100px", color: "#5a6a7a", borderBottom: "1px solid #1e2a3a", fontSize: "10px", textTransform: "uppercase" }}>
              <span>Name</span><span>Type</span><span>URL</span><span>Active</span><span>Actions</span>
            </div>
            {sources.map((src) => (
              <div key={src.id} style={{ ...s.row, gridTemplateColumns: "2fr 1fr 3fr 1fr 100px", color: src.isActive ? "#c9d1d9" : "#5a6a7a" }}>
                <span style={{ fontWeight: 600 }}>{src.name}</span>
                <span style={s.badge("#ff8800")}>{src.type}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" }}>{src.rssUrl || src.baseUrl}</span>
                <span>
                  <button onClick={() => toggleSource(src)} style={{ ...s.btn(src.isActive ? "#00ff88" : "#5a6a7a", "transparent", src.isActive ? "rgba(0,255,136,0.3)" : "#1e2a3a"), fontSize: "10px", padding: "2px 8px" }}>
                    {src.isActive ? "ON" : "OFF"}
                  </button>
                </span>
                <span style={{ display: "flex", gap: "4px" }}>
                  <button onClick={() => editSource(src)} style={{ ...s.btn("#ff8800", "transparent", "rgba(255,136,0,0.3)"), fontSize: "10px", padding: "2px 6px" }}>Edit</button>
                  <button onClick={() => deleteSource(src.id)} style={{ ...s.btn("#ff4444", "transparent", "rgba(255,68,68,0.3)"), fontSize: "10px", padding: "2px 6px" }}>Del</button>
                </span>
              </div>
            ))}
            {sources.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "#5a6a7a", fontSize: "12px" }}>No sources yet. Add RSS feeds, Google News, or HTML scrapers.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ RUNS TAB ═══════════ */}
      {tab === "runs" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", color: "#5a6a7a" }}>{runs.length} runs</span>
            <button onClick={loadRuns} style={s.btn("#5a6a7a", "transparent", "#1e2a3a")}>Refresh</button>
          </div>

          <div style={{ border: "1px solid #1e2a3a", borderRadius: "4px" }}>
            <div style={{ ...s.row, gridTemplateColumns: "2fr 1fr 3fr 1fr 1fr 1fr", color: "#5a6a7a", borderBottom: "1px solid #1e2a3a", fontSize: "10px", textTransform: "uppercase" }}>
              <span>Topic</span><span>Status</span><span>Results</span><span>Candidates</span><span>Cost</span><span>Duration</span>
            </div>
            {runs.map((run) => (
              <div key={run.id}>
                <div
                  style={{ ...s.row, gridTemplateColumns: "2fr 1fr 3fr 1fr 1fr 1fr", cursor: "pointer" }}
                  onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                >
                  <span style={{ fontWeight: 600, color: "#c9d1d9" }}>{run.topic.name}</span>
                  <span>
                    <span style={{
                      ...s.badge(statusColor(run.status)),
                      ...(run.status === "running" ? { animation: "blink 1s infinite" } : {}),
                    }}>
                      {run.status}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {run.resultMeta?.map((r, i) => (
                      <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                        style={{ color: "#00e5ff", fontSize: "11px", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}
                        onClick={(e) => e.stopPropagation()}
                        title={r.title}
                      >
                        {r.title}
                      </a>
                    )) || (run.status === "running" ? <span style={{ color: "#5a6a7a" }}>...</span> : <span style={{ color: "#5a6a7a" }}>-</span>)}
                  </span>
                  <span style={{ color: "#8b949e" }}>{run.candidateCount}</span>
                  <span style={{ color: "#8b949e" }}>{run.costCents > 0 ? `${(run.costCents / 100).toFixed(3)}$` : "-"}</span>
                  <span style={{ color: "#8b949e" }}>{formatDuration(run.createdAt, run.finishedAt)}</span>
                </div>

                {/* Expanded detail */}
                {expandedRunId === run.id && (
                  <div style={{ padding: "8px 12px", backgroundColor: "#0a0e14", borderBottom: "1px solid #1e2a3a" }}>
                    {run.errorMessage && (
                      <div style={{ marginBottom: "8px", padding: "6px 8px", backgroundColor: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: "4px", color: "#ff4444", fontSize: "11px" }}>
                        {run.errorMessage}
                      </div>
                    )}

                    {run.resultMeta && run.resultMeta.length > 0 && (
                      <div style={{ marginBottom: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#5a6a7a", textTransform: "uppercase", marginBottom: "4px" }}>Results</div>
                        {run.resultMeta.map((r, i) => (
                          <div key={i} style={{ marginBottom: "4px" }}>
                            <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: "#00e5ff", fontSize: "12px", textDecoration: "none" }}>
                              {i + 1}. {r.title}
                            </a>
                            <div style={{ color: "#5a6a7a", fontSize: "11px", marginLeft: "16px" }}>{r.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {run.logs && run.logs.length > 0 && (
                      <div>
                        <div style={{ fontSize: "10px", color: "#5a6a7a", textTransform: "uppercase", marginBottom: "4px" }}>Logs</div>
                        <div style={{ maxHeight: "200px", overflow: "auto", fontFamily: "monospace", fontSize: "10px", lineHeight: "1.6", color: "#6b7280" }}>
                          {run.logs.map((l, i) => (
                            <div key={i}>
                              <span style={{ color: "#5a6a7a" }}>{new Date(l.ts).toLocaleTimeString()}</span>{" "}
                              <span style={{ color: "#ff8800" }}>[{l.phase}]</span>{" "}
                              <span>{l.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {runs.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "#5a6a7a", fontSize: "12px" }}>No runs yet. Trigger a run from the Topics tab.</div>
            )}
          </div>
        </div>
      )}

      {/* Blink animation for running status */}
      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
