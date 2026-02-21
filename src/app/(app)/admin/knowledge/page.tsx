"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

type KBDocument = {
  id: string;
  fileName: string;
  status: string;
  chunkCount: number;
  sizeBytes: number;
  mimeType?: string;
  errorMessage?: string | null;
  createdAt?: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  creator: { email: string };
  _count: { documents: number };
  documents: KBDocument[];
};

export default function AdminKnowledgePage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [kbs, setKBs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Create KB form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [formError, setFormError] = useState("");

  // Expanded KB
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Upload
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetKbId, setUploadTargetKbId] = useState<string>("");

  const loadKBs = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/knowledge");
      const data = await resp.json();
      if (data.error) { setError(data.error); return; }
      setKBs(data.knowledgeBases || []);
    } catch { setError("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session && isAdmin) loadKBs();
  }, [session, isAdmin, loadKBs]);

  async function handleCreateKB() {
    setFormError("");
    if (!newName.trim()) { setFormError("Name is required"); return; }
    try {
      const resp = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDesc }),
      });
      const data = await resp.json();
      if (!resp.ok) { setFormError(data.error); return; }
      setNewName(""); setNewDesc(""); setShowForm(false);
      loadKBs();
    } catch { setFormError("Failed"); }
  }

  async function handleDeleteKB(id: string) {
    if (!confirm("Delete this knowledge base and all documents?")) return;
    await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" });
    loadKBs();
  }

  async function handleDeleteDoc(kbId: string, docId: string) {
    if (!confirm("Delete this document?")) return;
    await fetch(`/api/admin/knowledge/${kbId}/documents/${docId}`, { method: "DELETE" });
    loadKBs();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetKbId) return;

    setUploading(uploadTargetKbId);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`/api/admin/knowledge/${uploadTargetKbId}/documents`, {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok && !data.document) {
        setError(data.error || "Upload failed");
      }
      loadKBs();
    } catch { setError("Upload failed"); }
    finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function triggerUpload(kbId: string) {
    setUploadTargetKbId(kbId);
    setTimeout(() => fileRef.current?.click(), 0);
  }

  if (!session) return <div style={{ color: "var(--gray)" }}><span style={{ color: "var(--red)" }}>[ERROR]</span> Authentication required.</div>;
  if (!isAdmin) return <div style={{ color: "var(--red)" }}><span style={{ fontWeight: 700 }}>[ACCESS DENIED]</span> Admin privileges required.</div>;

  const s = {
    input: { width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" },
    label: { fontSize: "11px", fontWeight: 700 as const, color: "var(--green)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "4px", display: "block" },
  };

  const statusColor = (status: string) => {
    if (status === "ready") return "var(--green)";
    if (status === "processing") return "var(--yellow)";
    if (status === "error") return "var(--red)";
    return "var(--gray)";
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.html,.csv" style={{ display: "none" }} onChange={handleUpload} />

      {/* Breadcrumb */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "var(--red)", fontSize: "18px", fontWeight: 700 }}>[ADMIN]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "var(--cyan)", fontSize: "18px", fontWeight: 700 }}>KNOWLEDGE BASE</span>
        </div>
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>$ admin --knowledge --manage</div>
      </div>

      {/* Actions */}
      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={() => { setShowForm(!showForm); setFormError(""); }}
          style={{ padding: "8px 20px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {showForm ? "[  CANCEL  ]" : "[  + NEW KB  ]"}
        </button>
        <div style={{ fontSize: "12px", color: "var(--gray)" }}>
          {kbs.length} knowledge base{kbs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{ padding: "16px", border: "1px solid var(--green)", backgroundColor: "rgba(0, 255, 136, 0.03)", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>NEW KNOWLEDGE BASE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--name *</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Novinarski standardi" style={s.input} />
            </div>
            <div>
              <label style={s.label}>--description</label>
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Short description" style={s.input} />
            </div>
          </div>
          {formError && <div style={{ color: "var(--red)", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {formError}</div>}
          <button onClick={handleCreateKB} style={{ padding: "6px 16px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>
            [  CREATE  ]
          </button>
        </div>
      )}

      {error && <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px", marginBottom: "16px" }}><span style={{ fontWeight: 700 }}>[ERROR]</span> {error}</div>}

      {/* KB list */}
      {loading ? (
        <div style={{ color: "var(--green)", fontSize: "13px" }}><span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {kbs.map((kb) => {
            const isExpanded = expandedId === kb.id;
            return (
              <div key={kb.id} style={{ border: `1px solid ${isExpanded ? "rgba(0, 229, 255, 0.3)" : "var(--border)"}`, backgroundColor: isExpanded ? "rgba(0, 229, 255, 0.02)" : "transparent" }}>
                {/* KB header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : kb.id)}
                  style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: isExpanded ? "var(--cyan)" : "#444", fontSize: "10px" }}>{isExpanded ? "▼" : "▶"}</span>
                    <div>
                      <div style={{ color: "var(--white)", fontSize: "13px", fontWeight: 600 }}>{kb.name}</div>
                      {kb.description && <div style={{ color: "var(--gray)", fontSize: "11px", marginTop: "2px" }}>{kb.description}</div>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: "var(--gray)", fontSize: "11px" }}>{kb._count.documents} doc{kb._count.documents !== 1 ? "s" : ""}</span>
                    <span style={{ color: kb.isActive ? "var(--green)" : "var(--red)", fontSize: "10px", fontWeight: 700 }}>{kb.isActive ? "ACTIVE" : "OFF"}</span>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(30, 42, 58, 0.5)" }}>
                    {/* Actions */}
                    <div style={{ display: "flex", gap: "8px", margin: "12px 0" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerUpload(kb.id); }}
                        disabled={uploading === kb.id}
                        style={{ padding: "4px 12px", background: "transparent", border: "1px solid var(--cyan)", color: "var(--cyan)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}
                      >
                        {uploading === kb.id ? "UPLOADING..." : "+ UPLOAD DOC"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteKB(kb.id); }}
                        style={{ padding: "4px 12px", background: "transparent", border: "1px solid var(--red)", color: "var(--red)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}
                      >
                        DELETE KB
                      </button>
                    </div>

                    {/* Documents */}
                    {kb.documents.length === 0 ? (
                      <div style={{ color: "#333", fontSize: "11px", padding: "8px 0" }}>No documents. Upload PDF, TXT, or MD files.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {kb.documents.map((doc) => (
                          <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "6px 8px", backgroundColor: "rgba(13, 17, 23, 0.5)", borderLeft: `2px solid ${statusColor(doc.status)}` }}>
                            <span style={{ color: statusColor(doc.status), fontSize: "10px", fontWeight: 700, textTransform: "uppercase", width: "65px" }}>{doc.status}</span>
                            <span style={{ color: "var(--white)", fontSize: "11px", flex: 1 }}>{doc.fileName}</span>
                            <span style={{ color: "var(--gray)", fontSize: "10px" }}>{doc.chunkCount} chunks</span>
                            <span style={{ color: "var(--gray)", fontSize: "10px" }}>{(doc.sizeBytes / 1024).toFixed(0)} KB</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteDoc(kb.id, doc.id); }}
                              style={{ background: "transparent", border: "none", color: "var(--dim)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", padding: "2px 4px" }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "#444"; }}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: "10px", color: "var(--gray)", marginTop: "8px" }}>
                      Created by {kb.creator.email} on {new Date(kb.createdAt).toLocaleDateString("sl-SI")}
                      <span style={{ marginLeft: "8px" }}>ID: {kb.id}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {kbs.length === 0 && (
            <div style={{ color: "#333", fontSize: "12px", textAlign: "center", padding: "20px" }}>No knowledge bases yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
