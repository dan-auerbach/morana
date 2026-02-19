"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";

type DrupalIntegration = {
  id: string;
  workspaceId: string;
  name: string;
  baseUrl: string;
  adapterType: string;
  authType: string;
  defaultContentType: string;
  bodyFormat: string;
  fieldMap: unknown;
  isEnabled: boolean;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
};

type TestResult = {
  ok: boolean;
  latencyMs: number;
  drupalVersion?: string;
  error?: string;
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#0d1117",
  border: "1px solid #1e2a3a",
  borderRadius: "6px",
  padding: "20px",
  marginBottom: "16px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  color: "#5a6a7a",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: "4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  backgroundColor: "#0a0e14",
  border: "1px solid #1e2a3a",
  borderRadius: "4px",
  color: "#c9d1d9",
  fontFamily: "inherit",
  fontSize: "13px",
  marginBottom: "12px",
  boxSizing: "border-box" as const,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "auto" as const,
};

const btnStyle = (color: string): React.CSSProperties => ({
  padding: "8px 16px",
  backgroundColor: `rgba(${color}, 0.08)`,
  border: `1px solid rgba(${color}, 0.3)`,
  borderRadius: "4px",
  color: `rgb(${color})`,
  fontFamily: "inherit",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  marginRight: "8px",
});

export default function DrupalIntegrationPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [integration, setIntegration] = useState<DrupalIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Form state
  const [form, setForm] = useState({
    name: "Drupal",
    baseUrl: "",
    adapterType: "jsonapi",
    authType: "bearer_token",
    defaultContentType: "article",
    bodyFormat: "full_html",
    token: "",
    username: "",
    password: "",
  });

  const loadIntegration = useCallback(async () => {
    try {
      const resp = await fetch("/api/integrations/drupal");
      const data = await resp.json();
      if (data.integrations?.length > 0) {
        const int = data.integrations[0];
        setIntegration(int);
        setForm({
          name: int.name || "Drupal",
          baseUrl: int.baseUrl || "",
          adapterType: int.adapterType || "jsonapi",
          authType: int.authType || "bearer_token",
          defaultContentType: int.defaultContentType || "article",
          bodyFormat: int.bodyFormat || "full_html",
          token: "",
          username: "",
          password: "",
        });
      }
    } catch {
      setError("Failed to load integration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session && isAdmin) loadIntegration();
  }, [session, isAdmin, loadIntegration]);

  if (!session) {
    return (
      <div style={{ padding: "40px 20px", color: "#5a6a7a", fontFamily: "var(--font-geist-mono), monospace" }}>
        [ERROR] Authentication required.
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div style={{ padding: "40px 20px", color: "#ff4444", fontFamily: "var(--font-geist-mono), monospace" }}>
        [ACCESS DENIED] Admin privileges required.
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setWarnings([]);

    try {
      const credentials: Record<string, string> = {};
      if (form.authType === "bearer_token" && form.token) {
        credentials.token = form.token;
      } else if (form.authType === "basic") {
        if (form.username) credentials.username = form.username;
        if (form.password) credentials.password = form.password;
      }

      const body = {
        name: form.name,
        baseUrl: form.baseUrl,
        adapterType: form.adapterType,
        authType: form.authType,
        defaultContentType: form.defaultContentType,
        bodyFormat: form.bodyFormat,
        ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
      };

      let resp: Response;
      if (integration) {
        resp = await fetch(`/api/integrations/drupal/${integration.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        resp = await fetch("/api/integrations/drupal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Failed to save");
        return;
      }

      setIntegration(data.integration);
      setSuccess(integration ? "Integration updated" : "Integration created");
      if (data.warnings?.length) setWarnings(data.warnings);

      // Clear credential inputs after save
      setForm((prev) => ({ ...prev, token: "", username: "", password: "" }));
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!integration) return;
    setTesting(true);
    setTestResult(null);

    try {
      const resp = await fetch("/api/integrations/drupal/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: integration.id }),
      });
      const data = await resp.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, latencyMs: 0, error: "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!integration) return;
    try {
      const resp = await fetch(`/api/integrations/drupal/${integration.id}`, {
        method: "DELETE",
      });
      if (resp.ok) {
        setIntegration(null);
        setSuccess("Integration deleted");
        setShowDelete(false);
        setForm({
          name: "Drupal",
          baseUrl: "",
          adapterType: "jsonapi",
          authType: "bearer_token",
          defaultContentType: "article",
          bodyFormat: "full_html",
          token: "",
          username: "",
          password: "",
        });
      }
    } catch {
      setError("Failed to delete");
    }
  }

  async function handleToggle() {
    if (!integration) return;
    try {
      const resp = await fetch(`/api/integrations/drupal/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !integration.isEnabled }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setIntegration(data.integration);
      }
    } catch {
      setError("Failed to toggle");
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "40px 20px", color: "#5a6a7a", fontFamily: "var(--font-geist-mono), monospace" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "24px 16px", fontFamily: "var(--font-geist-mono), monospace" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "10px", color: "#ff4444", letterSpacing: "0.1em", marginBottom: "4px" }}>
          [ADMIN] / INTEGRATIONS / DRUPAL
        </div>
        <h1 style={{ fontSize: "18px", color: "#c9d1d9", margin: 0, fontWeight: 700 }}>
          Drupal Integration
        </h1>
        <p style={{ fontSize: "12px", color: "#5a6a7a", marginTop: "4px" }}>
          Connect to a Drupal instance to automatically publish articles from recipe pipelines.
        </p>
      </div>

      {/* Status messages */}
      {error && (
        <div style={{ ...cardStyle, borderColor: "#ff4444", color: "#ff4444", padding: "12px 16px", fontSize: "12px" }}>
          [ERROR] {error}
        </div>
      )}
      {success && (
        <div style={{ ...cardStyle, borderColor: "#00ff88", color: "#00ff88", padding: "12px 16px", fontSize: "12px" }}>
          [OK] {success}
        </div>
      )}
      {warnings.map((w, i) => (
        <div key={i} style={{ ...cardStyle, borderColor: "#ff8800", color: "#ff8800", padding: "12px 16px", fontSize: "12px" }}>
          {w}
        </div>
      ))}

      {/* HTTP Warning */}
      {form.baseUrl.startsWith("http://") && (
        <div style={{ ...cardStyle, borderColor: "#ff8800", padding: "12px 16px" }}>
          <span style={{ color: "#ff8800", fontSize: "12px", fontWeight: 600 }}>
            WARNING: HTTP connection — credentials will be transmitted in plaintext.
            Use HTTPS for production environments.
          </span>
        </div>
      )}

      {/* Current integration status */}
      {integration && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "12px", color: "#c9d1d9" }}>
              <span style={{ color: "#5a6a7a" }}>status:</span>{" "}
              <span style={{ color: integration.isEnabled ? "#00ff88" : "#ff4444" }}>
                {integration.isEnabled ? "ENABLED" : "DISABLED"}
              </span>
            </span>
            <button onClick={handleToggle} style={btnStyle(integration.isEnabled ? "255, 68, 68" : "0, 255, 136")}>
              {integration.isEnabled ? "Disable" : "Enable"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
            <div>
              <span style={{ color: "#5a6a7a" }}>url:</span>{" "}
              <span style={{ color: "#c9d1d9" }}>{integration.baseUrl}</span>
            </div>
            <div>
              <span style={{ color: "#5a6a7a" }}>adapter:</span>{" "}
              <span style={{ color: "#c9d1d9" }}>{integration.adapterType}</span>
            </div>
            <div>
              <span style={{ color: "#5a6a7a" }}>auth:</span>{" "}
              <span style={{ color: "#c9d1d9" }}>{integration.authType}</span>
            </div>
            <div>
              <span style={{ color: "#5a6a7a" }}>content_type:</span>{" "}
              <span style={{ color: "#c9d1d9" }}>{integration.defaultContentType}</span>
            </div>
            <div>
              <span style={{ color: "#5a6a7a" }}>credentials:</span>{" "}
              <span style={{ color: integration.hasCredentials ? "#00ff88" : "#ff4444" }}>
                {integration.hasCredentials ? "configured" : "missing"}
              </span>
            </div>
          </div>

          {/* Test Connection */}
          <div style={{ marginTop: "16px", borderTop: "1px solid #1e2a3a", paddingTop: "12px" }}>
            <button onClick={handleTest} disabled={testing} style={btnStyle("0, 229, 255")}>
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {testResult && (
              <span style={{ fontSize: "12px", marginLeft: "8px", color: testResult.ok ? "#00ff88" : "#ff4444" }}>
                {testResult.ok
                  ? `OK (${testResult.latencyMs}ms)${testResult.drupalVersion ? ` — ${testResult.drupalVersion}` : ""}`
                  : `FAILED: ${testResult.error}`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Form */}
      <div style={cardStyle}>
        <div style={{ fontSize: "13px", color: "#c9d1d9", fontWeight: 600, marginBottom: "16px" }}>
          {integration ? "Update Configuration" : "Create Integration"}
        </div>

        <label style={labelStyle}>Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          style={inputStyle}
          placeholder="Drupal"
        />

        <label style={labelStyle}>Base URL *</label>
        <input
          type="url"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          style={inputStyle}
          placeholder="https://drupal.example.com"
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={labelStyle}>Adapter Type</label>
            <select
              value={form.adapterType}
              onChange={(e) => setForm({ ...form, adapterType: e.target.value })}
              style={selectStyle}
            >
              <option value="jsonapi">JSON:API (standard)</option>
              <option value="custom_rest">Custom REST (/morana)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Auth Type</label>
            <select
              value={form.authType}
              onChange={(e) => setForm({ ...form, authType: e.target.value })}
              style={selectStyle}
            >
              <option value="bearer_token">Bearer Token</option>
              <option value="basic">Basic Auth</option>
            </select>
          </div>
        </div>

        {/* Credentials */}
        <div style={{ borderTop: "1px solid #1e2a3a", marginTop: "8px", paddingTop: "12px" }}>
          <div style={{ fontSize: "11px", color: "#5a6a7a", marginBottom: "8px" }}>
            CREDENTIALS{integration?.hasCredentials ? " (leave empty to keep existing)" : ""}
          </div>

          {form.authType === "bearer_token" ? (
            <>
              <label style={labelStyle}>API Token</label>
              <input
                type="password"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                style={inputStyle}
                placeholder={integration?.hasCredentials ? "***configured***" : "Enter Drupal API token"}
              />
            </>
          ) : (
            <>
              <label style={labelStyle}>Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                style={inputStyle}
                placeholder={integration?.hasCredentials ? "***configured***" : "Drupal username"}
              />
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                style={inputStyle}
                placeholder={integration?.hasCredentials ? "***configured***" : "Drupal password"}
              />
            </>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={labelStyle}>Default Content Type</label>
            <input
              type="text"
              value={form.defaultContentType}
              onChange={(e) => setForm({ ...form, defaultContentType: e.target.value })}
              style={inputStyle}
              placeholder="article"
            />
          </div>

          <div>
            <label style={labelStyle}>Body Format</label>
            <input
              type="text"
              value={form.bodyFormat}
              onChange={(e) => setForm({ ...form, bodyFormat: e.target.value })}
              style={inputStyle}
              placeholder="full_html"
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", marginTop: "8px" }}>
          <button onClick={handleSave} disabled={saving || !form.baseUrl} style={btnStyle("0, 255, 136")}>
            {saving ? "Saving..." : integration ? "Update" : "Create"}
          </button>

          {integration && (
            <>
              {showDelete ? (
                <>
                  <span style={{ fontSize: "12px", color: "#ff4444", marginRight: "8px" }}>
                    Delete integration? This cannot be undone.
                  </span>
                  <button onClick={handleDelete} style={btnStyle("255, 68, 68")}>
                    Confirm Delete
                  </button>
                  <button onClick={() => setShowDelete(false)} style={{ ...btnStyle("90, 106, 122"), marginLeft: "4px" }}>
                    Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setShowDelete(true)} style={btnStyle("255, 68, 68")}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
