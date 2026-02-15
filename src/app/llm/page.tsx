"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CostPreview from "@/app/components/CostPreview";
import { PricingInfo } from "@/lib/cost-preview";

type Model = { id: string; label: string; provider: string };
type TemplateOption = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
};
type KBOption = {
  id: string;
  name: string;
  description: string | null;
};
type ConversationSummary = {
  id: string;
  title: string;
  modelId: string;
  templateId: string | null;
  knowledgeBaseIds: string[] | null;
  updatedAt: string;
  _count: { messages: number };
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  createdAt: string;
};

export default function LLMPage() {
  const { data: session } = useSession();
  const [models, setModels] = useState<Model[]>([]);
  const [pricingMap, setPricingMap] = useState<Record<string, PricingInfo>>({});
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KBOption[]>([]);
  const [selectedKBIds, setSelectedKBIds] = useState<string[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load models + templates
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models || []);
        if (d.models?.length) setSelectedModelId(d.models[0].id);
        if (d.pricing) setPricingMap(d.pricing);
      });
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {});
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => setKnowledgeBases(d.knowledgeBases || []))
      .catch(() => {});
  }, []);

  // Load conversations
  const loadConversations = useCallback(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations || []));
  }, []);

  useEffect(() => {
    if (session) loadConversations();
  }, [session, loadConversations]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    fetch(`/api/conversations/${activeConvId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.conversation) {
          setMessages(d.conversation.messages || []);
          setSelectedModelId(d.conversation.modelId);
          setSelectedTemplateId(d.conversation.templateId || "");
          setSelectedKBIds(d.conversation.knowledgeBaseIds || []);
        }
      });
  }, [activeConvId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeConvId]);

  if (!session) {
    return (
      <div style={{ color: "#5a6a7a" }}>
        <span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required. Please sign in.
      </div>
    );
  }

  async function createConversation() {
    const resp = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: selectedModelId,
        templateId: selectedTemplateId || null,
        knowledgeBaseIds: selectedKBIds.length > 0 ? selectedKBIds : null,
      }),
    });
    const d = await resp.json();
    if (d.conversation) {
      setActiveConvId(d.conversation.id);
      setMessages([]);
      loadConversations();
    }
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
    loadConversations();
  }

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userContent = input.trim();
    setInput("");
    setError("");

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // If no conversation, create one first
    let convId = activeConvId;
    if (!convId) {
      const resp = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selectedModelId,
          templateId: selectedTemplateId || null,
        }),
      });
      const d = await resp.json();
      if (!d.conversation) {
        setError("Failed to create conversation");
        return;
      }
      convId = d.conversation.id;
      setActiveConvId(convId);
    }

    // Optimistic user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    setLoading(true);
    try {
      const resp = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userContent }),
      });
      const data = await resp.json();

      if (!resp.ok) throw new Error(data.error || "Request failed");

      // Replace temp user message and add assistant message
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        data.userMessage,
        data.assistantMessage,
      ]);

      loadConversations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleModelChange(newModelId: string) {
    setSelectedModelId(newModelId);
    if (activeConvId) {
      try {
        await fetch(`/api/conversations/${activeConvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: newModelId }),
        });
      } catch {
        // Model change failed — continue with local state
      }
    }
  }

  async function handleTemplateChange(newTemplateId: string) {
    setSelectedTemplateId(newTemplateId);
    if (activeConvId) {
      try {
        await fetch(`/api/conversations/${activeConvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: newTemplateId || null }),
        });
      } catch {
        // Template change failed — continue with local state
      }
    }
  }

  const activeConv = conversations.find((c) => c.id === activeConvId);

  // Total chars for cost preview (history + current input)
  const totalInputChars = useMemo(() => {
    const historyChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return historyChars + input.length;
  }, [messages, input]);

  return (
    <div className="page-with-sidebar" style={{ display: "flex", gap: "0", margin: "-24px -16px", height: "calc(100vh - 57px)" }}>
      {/* Sidebar */}
      <div
        className="page-sidebar"
        style={{
          width: sidebarOpen ? "260px" : "0px",
          minWidth: sidebarOpen ? "260px" : "0px",
          borderRight: sidebarOpen ? "1px solid #1e2a3a" : "none",
          backgroundColor: "#0a0e14",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "all 0.2s",
        }}
      >
        {/* New conversation button */}
        <div style={{ padding: "12px" }}>
          <button
            onClick={createConversation}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "transparent",
              border: "1px solid #00ff88",
              color: "#00ff88",
              fontFamily: "inherit",
              fontSize: "12px",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)";
              e.currentTarget.style.boxShadow = "0 0 10px rgba(0, 255, 136, 0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            + new_conversation
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              style={{
                padding: "10px 12px",
                marginBottom: "2px",
                cursor: "pointer",
                backgroundColor: c.id === activeConvId ? "rgba(0, 255, 136, 0.08)" : "transparent",
                border: c.id === activeConvId ? "1px solid rgba(0, 255, 136, 0.2)" : "1px solid transparent",
                borderRadius: "4px",
                transition: "all 0.15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                if (c.id !== activeConvId) {
                  e.currentTarget.style.backgroundColor = "rgba(0, 255, 136, 0.04)";
                }
              }}
              onMouseLeave={(e) => {
                if (c.id !== activeConvId) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: c.id === activeConvId ? "#00ff88" : "#8b949e",
                    fontSize: "12px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.title}
                </div>
                <div style={{ color: "#444", fontSize: "10px", marginTop: "2px" }}>
                  {c._count.messages} msgs
                </div>
              </div>
              <button
                onClick={(e) => deleteConversation(c.id, e)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#444",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "2px 4px",
                  fontFamily: "inherit",
                  lineHeight: 1,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#ff4444"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#444"; }}
                title="Delete conversation"
              >
                x
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <div style={{ color: "#333", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>
              No conversations yet
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="page-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Chat header */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid #1e2a3a",
            backgroundColor: "#0d1117",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: "transparent",
              border: "1px solid #1e2a3a",
              color: "#5a6a7a",
              cursor: "pointer",
              padding: "4px 8px",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>

          <span style={{ color: "#00ff88", fontSize: "14px", fontWeight: 700 }}>
            [LLM]
          </span>

          <span style={{ color: "#333" }}>|</span>

          <select
            value={selectedModelId}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{
              padding: "4px 8px",
              backgroundColor: "#111820",
              border: "1px solid #1e2a3a",
              color: "#e0e0e0",
              fontFamily: "inherit",
              fontSize: "12px",
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          {templates.length > 0 && (
            <>
              <span style={{ color: "#333" }}>|</span>
              <select
                value={selectedTemplateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                style={{
                  padding: "4px 8px",
                  backgroundColor: "#111820",
                  border: `1px solid ${selectedTemplateId ? "rgba(255, 204, 0, 0.4)" : "#1e2a3a"}`,
                  color: selectedTemplateId ? "#ffcc00" : "#5a6a7a",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  maxWidth: "180px",
                }}
                title="Prompt template"
              >
                <option value="">-- no template --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {knowledgeBases.length > 0 && (
            <>
              <span style={{ color: "#333" }}>|</span>
              <select
                value={selectedKBIds[0] || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  const newIds = val ? [val] : [];
                  setSelectedKBIds(newIds);
                  if (activeConvId) {
                    fetch(`/api/conversations/${activeConvId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ knowledgeBaseIds: newIds.length > 0 ? newIds : null }),
                    }).catch(() => {});
                  }
                }}
                style={{
                  padding: "4px 8px",
                  backgroundColor: "#111820",
                  border: `1px solid ${selectedKBIds.length > 0 ? "rgba(0, 229, 255, 0.4)" : "#1e2a3a"}`,
                  color: selectedKBIds.length > 0 ? "#00e5ff" : "#5a6a7a",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  maxWidth: "150px",
                }}
                title="Knowledge base (RAG)"
              >
                <option value="">-- no KB --</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {activeConv && (
            <>
              <span style={{ color: "#333" }}>|</span>
              <span style={{ color: "#5a6a7a", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeConv.title}
              </span>
            </>
          )}
        </div>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {messages.length === 0 && !loading && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                color: "#333",
              }}
            >
              <div style={{ fontSize: "48px", opacity: 0.3 }}>{">"}_</div>
              <div style={{ fontSize: "13px", color: "#444" }}>
                Start a conversation or select one from the sidebar
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "100%",
              }}
            >
              {/* Role label */}
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: "4px",
                  color: msg.role === "user" ? "#00e5ff" : "#00ff88",
                }}
              >
                {msg.role === "user" ? "you" : "assistant"}
              </div>

              {/* Message bubble */}
              <div
                style={{
                  maxWidth: "85%",
                  padding: "12px 16px",
                  backgroundColor: msg.role === "user" ? "rgba(0, 229, 255, 0.06)" : "rgba(0, 255, 136, 0.04)",
                  border: `1px solid ${msg.role === "user" ? "rgba(0, 229, 255, 0.15)" : "rgba(0, 255, 136, 0.12)"}`,
                  borderRadius: "4px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: "13px",
                  lineHeight: "1.6",
                  color: "#e0e0e0",
                }}
              >
                {msg.content}
              </div>

              {/* Stats for assistant messages */}
              {msg.role === "assistant" && (msg.inputTokens || msg.latencyMs) && (
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    fontSize: "10px",
                    marginTop: "4px",
                    color: "#444",
                  }}
                >
                  {msg.inputTokens != null && (
                    <span>
                      <span style={{ color: "#555" }}>in:</span> {msg.inputTokens}
                    </span>
                  )}
                  {msg.outputTokens != null && (
                    <span>
                      <span style={{ color: "#555" }}>out:</span> {msg.outputTokens}
                    </span>
                  )}
                  {msg.latencyMs != null && (
                    <span>
                      <span style={{ color: "#555" }}>latency:</span> {(msg.latencyMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: "4px",
                  color: "#00ff88",
                }}
              >
                assistant
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  backgroundColor: "rgba(0, 255, 136, 0.04)",
                  border: "1px solid rgba(0, 255, 136, 0.12)",
                  borderRadius: "4px",
                  color: "#00ff88",
                  fontSize: "13px",
                }}
              >
                <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Processing...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              margin: "0 16px",
              padding: "8px 12px",
              backgroundColor: "rgba(255, 68, 68, 0.08)",
              border: "1px solid #ff4444",
              color: "#ff4444",
              fontSize: "12px",
            }}
          >
            <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
          </div>
        )}

        {/* Cost preview + Input area */}
        {input.trim() && (
          <div style={{ padding: "4px 16px 0", flexShrink: 0 }}>
            <CostPreview
              type="llm"
              modelId={selectedModelId}
              pricing={pricingMap[selectedModelId]}
              inputChars={totalInputChars}
            />
          </div>
        )}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #1e2a3a",
            backgroundColor: "#0d1117",
            display: "flex",
            gap: "8px",
            alignItems: "flex-end",
            flexShrink: 0,
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
            style={{
              flex: 1,
              padding: "10px 12px",
              backgroundColor: "#111820",
              border: "1px solid #1e2a3a",
              color: "#e0e0e0",
              fontFamily: "inherit",
              fontSize: "13px",
              resize: "none",
              maxHeight: "120px",
              overflow: "auto",
              lineHeight: "1.5",
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.4)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#1e2a3a";
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              padding: "10px 20px",
              background: "transparent",
              border: `1px solid ${loading || !input.trim() ? "#333" : "#00ff88"}`,
              color: loading || !input.trim() ? "#333" : "#00ff88",
              fontFamily: "inherit",
              fontSize: "12px",
              fontWeight: 700,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!loading && input.trim()) {
                e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)";
                e.currentTarget.style.boxShadow = "0 0 12px rgba(0, 255, 136, 0.15)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {loading ? "..." : "SEND"}
          </button>
        </div>
      </div>
    </div>
  );
}
