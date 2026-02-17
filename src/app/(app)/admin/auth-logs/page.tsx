"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";

type AuthLogEntry = {
  id: string;
  email: string;
  event: string;
  provider: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  reason: string | null;
  createdAt: string;
};

type Stats = {
  totalLogs: number;
  denied24h: number;
  denied7d: number;
  uniqueIPs7d: number;
};

export default function AuthLogsPage() {
  const { data: session } = useSession();
  const [logs, setLogs] = useState<AuthLogEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterEmail, setFilterEmail] = useState("");
  const [filterEvent, setFilterEvent] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterEmail) params.set("email", filterEmail);
      if (filterEvent) params.set("event", filterEvent);
      const resp = await fetch(`/api/admin/auth-logs?${params}`);
      const data = await resp.json();
      setLogs(data.logs || []);
      setStats(data.stats || null);
    } catch { /* */ } finally {
      setLoading(false);
    }
  }, [filterEmail, filterEvent]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!session) return <div style={{ color: "#ff4444" }}>[ERROR] Authentication required.</div>;

  const eventColor = (e: string) => {
    if (e === "sign_in_ok") return "#00ff88";
    if (e === "sign_in_bootstrap") return "#00e5ff";
    if (e.includes("denied")) return "#ff4444";
    return "#ffcc00";
  };

  const eventIcon = (e: string) => {
    if (e === "sign_in_ok") return "✓";
    if (e === "sign_in_bootstrap") return "★";
    if (e.includes("denied")) return "✕";
    return "?";
  };

  // Parse short UA
  function shortUA(ua: string | null): string {
    if (!ua) return "—";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
    if (ua.includes("Edge")) return "Edge";
    if (ua.includes("bot") || ua.includes("Bot") || ua.includes("crawl")) return "Bot";
    return ua.substring(0, 30) + "...";
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ color: "#ff4444", fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
          [AUTH LOGS]
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>
          $ auth --logs --verbose --monitor
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: "16px", marginBottom: "20px", padding: "12px 16px", border: "1px solid #1e2a3a", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "9px", color: "#5a6a7a", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Logs</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#e0e0e0" }}>{stats.totalLogs}</div>
          </div>
          <div>
            <div style={{ fontSize: "9px", color: "#5a6a7a", textTransform: "uppercase", letterSpacing: "0.05em" }}>Denied 24h</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: stats.denied24h > 0 ? "#ff4444" : "#00ff88" }}>{stats.denied24h}</div>
          </div>
          <div>
            <div style={{ fontSize: "9px", color: "#5a6a7a", textTransform: "uppercase", letterSpacing: "0.05em" }}>Denied 7d</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: stats.denied7d > 0 ? "#ff4444" : "#00ff88" }}>{stats.denied7d}</div>
          </div>
          <div>
            <div style={{ fontSize: "9px", color: "#5a6a7a", textTransform: "uppercase", letterSpacing: "0.05em" }}>Unique IPs 7d</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#00e5ff" }}>{stats.uniqueIPs7d}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Filter by email..."
          value={filterEmail}
          onChange={(e) => setFilterEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={{
            padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a",
            color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px", width: "200px",
          }}
        />
        <select
          value={filterEvent}
          onChange={(e) => { setFilterEvent(e.target.value); }}
          style={{
            padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a",
            color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px",
          }}
        >
          <option value="">All events</option>
          <option value="sign_in_ok">sign_in_ok</option>
          <option value="sign_in_denied_unknown">denied_unknown</option>
          <option value="sign_in_denied_inactive">denied_inactive</option>
          <option value="sign_in_bootstrap">bootstrap</option>
        </select>
        <button
          onClick={load}
          style={{
            padding: "6px 14px", background: "transparent", border: "1px solid #00ff88",
            color: "#00ff88", fontFamily: "inherit", fontSize: "11px", cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <div style={{ color: "#00ff88", fontSize: "13px" }}>Loading...</div>}

      {/* Logs table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
              {["", "Event", "Email", "IP", "Location", "Browser", "Time"].map((h) => (
                <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: "#5a6a7a", fontWeight: 600, fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <>
                <tr
                  key={log.id}
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  style={{
                    borderBottom: "1px solid rgba(30,42,58,0.5)",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ padding: "6px", color: eventColor(log.event), fontWeight: 700, fontSize: "13px", width: "24px", textAlign: "center" }}>
                    {eventIcon(log.event)}
                  </td>
                  <td style={{ padding: "6px", color: eventColor(log.event), fontWeight: 600, fontSize: "10px" }}>
                    {log.event.replace("sign_in_", "")}
                  </td>
                  <td style={{ padding: "6px", color: "#e0e0e0" }}>{log.email}</td>
                  <td style={{ padding: "6px", color: "#8b949e", fontFamily: "monospace", fontSize: "10px" }}>{log.ip || "—"}</td>
                  <td style={{ padding: "6px", color: "#8b949e" }}>
                    {[log.city, log.country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td style={{ padding: "6px", color: "#5a6a7a" }}>{shortUA(log.userAgent)}</td>
                  <td style={{ padding: "6px", color: "#5a6a7a", whiteSpace: "nowrap" }}>
                    {new Date(log.createdAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                </tr>
                {expandedId === log.id && (
                  <tr key={`${log.id}-detail`}>
                    <td colSpan={7} style={{ padding: "8px 6px 12px 30px", backgroundColor: "rgba(0,0,0,0.2)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "10px" }}>
                        <div><span style={{ color: "#5a6a7a" }}>ID:</span> <span style={{ color: "#8b949e" }}>{log.id}</span></div>
                        <div><span style={{ color: "#5a6a7a" }}>Provider:</span> <span style={{ color: "#8b949e" }}>{log.provider}</span></div>
                        <div><span style={{ color: "#5a6a7a" }}>IP:</span> <span style={{ color: "#8b949e", fontFamily: "monospace" }}>{log.ip || "unknown"}</span></div>
                        {log.reason && (
                          <div><span style={{ color: "#5a6a7a" }}>Reason:</span> <span style={{ color: "#ff4444" }}>{log.reason}</span></div>
                        )}
                        <div><span style={{ color: "#5a6a7a" }}>User-Agent:</span> <span style={{ color: "#5a6a7a", wordBreak: "break-all" }}>{log.userAgent || "—"}</span></div>
                        <div><span style={{ color: "#5a6a7a" }}>Full time:</span> <span style={{ color: "#8b949e" }}>{new Date(log.createdAt).toLocaleString("sl-SI")}</span></div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && logs.length === 0 && (
        <div style={{ color: "#333", fontSize: "12px", padding: "40px 20px", textAlign: "center" }}>
          No auth logs found.
        </div>
      )}
    </div>
  );
}
