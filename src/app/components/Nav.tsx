"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect, useCallback, useRef } from "react";

/* ── Link definitions ────────────────────────────────────── */

const primaryLinks = [
  { href: "/recipes", label: "Recipes" },
  { href: "/llm", label: "LLM" },
  { href: "/stt", label: "STT" },
  { href: "/tts", label: "TTS" },
  { href: "/image", label: "Image" },
  { href: "/video", label: "Video" },
];

// Overflow items — visible at wider breakpoints, collapsed into "More" on narrow
const overflowLinks = [
  { href: "/jobs", label: "Jobs" },
  { href: "/history", label: "History" },
  { href: "/usage", label: "Usage" },
];

const adminLinks = [
  { href: "/admin/recipes", label: "Recipes" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/knowledge", label: "Knowledge" },
  { href: "/admin/models", label: "Models" },
  { href: "/admin/integrations/drupal", label: "Drupal" },
  { href: "/admin/news-scout", label: "News Scout" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/auth-logs", label: "Auth Logs" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin", label: "Dashboard" },
];

type WsInfo = { id: string; name: string; slug: string; role: string };

/* ── Shared styles ───────────────────────────────────────── */

const dropdownPanel: React.CSSProperties = {
  position: "absolute", top: "100%", right: 0, marginTop: "4px",
  backgroundColor: "#0d1117", border: "1px solid #1e2a3a", borderRadius: "4px",
  minWidth: "180px", zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  padding: "4px 0",
};

const dropdownItem: React.CSSProperties = {
  display: "block", width: "100%", padding: "8px 12px", border: "none",
  backgroundColor: "transparent", color: "#8b949e",
  fontFamily: "inherit", fontSize: "12px", cursor: "pointer", textAlign: "left",
  borderBottom: "1px solid #111820",
};

const dropdownLink: React.CSSProperties = {
  display: "block", padding: "8px 12px", fontSize: "12px", fontWeight: 500,
  color: "#8b949e", borderBottom: "1px solid #111820",
};

/* ── Helper: nav link renderer ───────────────────────────── */
function NavLink({ href, label, pathname, className }: { href: string; label: string; pathname: string; className?: string }) {
  const isActive = pathname === href || pathname.startsWith(href + "/");
  const isAdminLink = href.startsWith("/admin");
  const activeColor = isAdminLink ? "#ff4444" : "#00ff88";
  return (
    <Link
      href={href}
      className={`no-underline ${className || ""}`}
      style={{
        padding: "4px 10px", borderRadius: "4px", fontSize: "13px", fontWeight: 500,
        color: isActive ? activeColor : "#6b7280",
        backgroundColor: isActive ? `rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.08)` : "transparent",
        border: isActive ? `1px solid rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.2)` : "1px solid transparent",
        transition: "all 0.15s", whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = activeColor; e.currentTarget.style.backgroundColor = `rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.05)`; } }}
      onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = "#6b7280"; e.currentTarget.style.backgroundColor = "transparent"; } }}
    >
      <span style={{ color: isActive ? (isAdminLink ? "#ff4444" : "#00e5ff") : "#444", marginRight: "2px" }}>&gt;</span>
      {label}
    </Link>
  );
}

/* ── Helper: dropdown trigger button ─────────────────────── */
function DropdownBtn({ label, isOpen, onClick, color, bgColor, borderColor, ariaLabel }: {
  label: string; isOpen: boolean; onClick: () => void;
  color: string; bgColor: string; borderColor: string; ariaLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={isOpen}
      aria-haspopup="true"
      style={{
        padding: "3px 8px", borderRadius: "4px",
        backgroundColor: bgColor, color, border: `1px solid ${borderColor}`,
        fontFamily: "inherit", fontSize: "12px", fontWeight: 600, cursor: "pointer",
        whiteSpace: "nowrap", lineHeight: "1.4",
      }}
    >
      {label}
      <span style={{ marginLeft: "4px", fontSize: "8px" }}>{isOpen ? "\u25B2" : "\u25BC"}</span>
    </button>
  );
}

/* ── Main component ──────────────────────────────────────── */

export default function Nav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [menuOpen, setMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WsInfo[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [wsOpen, setWsOpen] = useState(false);

  // Refs for click-outside
  const adminRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      const resp = await fetch("/api/workspaces");
      const data = await resp.json();
      setWorkspaces(data.workspaces || []);
      setActiveWsId(data.activeWorkspaceId || null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (session) loadWorkspaces();
  }, [session, loadWorkspaces]);

  // Close all dropdowns on route change
  useEffect(() => {
    setMenuOpen(false);
    setAdminOpen(false);
    setUserOpen(false);
    setMoreOpen(false);
    setWsOpen(false);
  }, [pathname]);

  // Click-outside handler for all dropdowns
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (adminRef.current && !adminRef.current.contains(t)) setAdminOpen(false);
      if (userRef.current && !userRef.current.contains(t)) setUserOpen(false);
      if (moreRef.current && !moreRef.current.contains(t)) setMoreOpen(false);
      if (wsRef.current && !wsRef.current.contains(t)) setWsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function switchWs(wsId: string) {
    try {
      await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: wsId }),
      });
      setActiveWsId(wsId);
      setWsOpen(false);
      window.location.reload();
    } catch { /* ignore */ }
  }

  const activeWs = workspaces.find((w) => w.id === activeWsId);

  // Derive display name for user dropdown
  const userName = session?.user?.name;
  const userEmail = session?.user?.email || "";
  const userLabel = userName
    ? userName.split(" ")[0] // first name
    : userEmail.split("@")[0].slice(0, 16); // local part, max 16 chars

  const isAdminRoute = pathname.startsWith("/admin");

  return (
    <nav
      style={{
        borderBottom: "1px solid #1a1f2b",
        backgroundColor: "#0d1117",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        position: "relative",
        zIndex: 100,
      }}
    >
      <div style={{ maxWidth: "1024px", margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "48px" }}>
          {/* ── Left: logo ── */}
          <Link
            href="/"
            className="no-underline"
            style={{ color: "#00ff88", letterSpacing: "0.05em", fontSize: "18px", fontWeight: 700, flexShrink: 0 }}
          >
            <span style={{ color: "#555" }}>[</span>MORANA<span style={{ color: "#555" }}>]</span>
          </Link>

          {/* ── Center: primary nav links — desktop only ── */}
          {session && (
            <div className="nav-links-desktop" style={{ display: "flex", gap: "2px", alignItems: "center" }}>
              <span style={{ color: "#555", fontSize: "12px", marginRight: "4px" }}>//</span>

              {/* Primary links — always visible on desktop */}
              {primaryLinks.map((l) => (
                <NavLink key={l.href} href={l.href} label={l.label} pathname={pathname} />
              ))}

              {/* Overflow links — visible at wider breakpoints */}
              {overflowLinks.map((l) => (
                <NavLink key={l.href} href={l.href} label={l.label} pathname={pathname} className="nav-overflow-link" />
              ))}

              {/* "More" dropdown — visible only at narrow desktop widths */}
              <div ref={moreRef} style={{ position: "relative" }} className="nav-more-btn">
                <DropdownBtn
                  label="More"
                  isOpen={moreOpen}
                  onClick={() => { setMoreOpen(!moreOpen); setAdminOpen(false); }}
                  color="#6b7280"
                  bgColor="transparent"
                  borderColor="transparent"
                  ariaLabel="More navigation links"
                />
                {moreOpen && (
                  <div style={dropdownPanel} role="menu">
                    {overflowLinks.map((l) => {
                      const isActive = pathname === l.href || pathname.startsWith(l.href + "/");
                      return (
                        <Link
                          key={l.href}
                          href={l.href}
                          className="no-underline"
                          role="menuitem"
                          style={{
                            ...dropdownLink,
                            color: isActive ? "#00ff88" : "#8b949e",
                            backgroundColor: isActive ? "rgba(0, 255, 136, 0.08)" : "transparent",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0, 255, 136, 0.05)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isActive ? "rgba(0, 255, 136, 0.08)" : "transparent"; }}
                        >
                          <span style={{ color: isActive ? "#00e5ff" : "#444", marginRight: "6px" }}>&gt;</span>
                          {l.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Right: admin dropdown + workspace + user dropdown + hamburger ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            {session ? (
              <>
                {/* Admin dropdown — desktop only */}
                {isAdmin && (
                  <div ref={adminRef} style={{ position: "relative" }} className="nav-admin-desktop">
                    <DropdownBtn
                      label="Admin"
                      isOpen={adminOpen}
                      onClick={() => { setAdminOpen(!adminOpen); setUserOpen(false); setMoreOpen(false); setWsOpen(false); }}
                      color={isAdminRoute ? "#ff4444" : "#ff4444"}
                      bgColor={isAdminRoute ? "rgba(255, 68, 68, 0.12)" : "rgba(255, 68, 68, 0.06)"}
                      borderColor="rgba(255, 68, 68, 0.3)"
                      ariaLabel="Admin menu"
                    />
                    {adminOpen && (
                      <div style={dropdownPanel} role="menu">
                        {adminLinks.map((l) => {
                          const isActive = pathname === l.href || (l.href !== "/admin" && pathname.startsWith(l.href + "/"));
                          return (
                            <Link
                              key={l.href}
                              href={l.href}
                              className="no-underline"
                              role="menuitem"
                              style={{
                                ...dropdownLink,
                                color: isActive ? "#ff4444" : "#8b949e",
                                backgroundColor: isActive ? "rgba(255, 68, 68, 0.08)" : "transparent",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 68, 68, 0.05)"; e.currentTarget.style.color = "#ff4444"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isActive ? "rgba(255, 68, 68, 0.08)" : "transparent"; e.currentTarget.style.color = isActive ? "#ff4444" : "#8b949e"; }}
                            >
                              <span style={{ color: isActive ? "#ff4444" : "#555", marginRight: "6px" }}>&gt;</span>
                              {l.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Workspace switcher — desktop only */}
                {workspaces.length > 1 && (
                  <div ref={wsRef} style={{ position: "relative" }} className="nav-ws-desktop">
                    <DropdownBtn
                      label={activeWs?.name || "Workspace"}
                      isOpen={wsOpen}
                      onClick={() => { setWsOpen(!wsOpen); setAdminOpen(false); setUserOpen(false); setMoreOpen(false); }}
                      color="#ff8800"
                      bgColor="rgba(255, 136, 0, 0.08)"
                      borderColor="rgba(255, 136, 0, 0.3)"
                      ariaLabel="Switch workspace"
                    />
                    {wsOpen && (
                      <div style={dropdownPanel} role="menu">
                        {workspaces.map((ws) => (
                          <button
                            key={ws.id}
                            onClick={() => switchWs(ws.id)}
                            role="menuitem"
                            style={{
                              ...dropdownItem,
                              backgroundColor: ws.id === activeWsId ? "rgba(255, 136, 0, 0.1)" : "transparent",
                              color: ws.id === activeWsId ? "#ff8800" : "#8b949e",
                            }}
                          >
                            {ws.id === activeWsId && <span style={{ marginRight: "4px" }}>*</span>}
                            {ws.name}
                            <span style={{ float: "right", fontSize: "9px", color: "#5a6a7a" }}>{ws.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* User dropdown — desktop only */}
                <div ref={userRef} style={{ position: "relative" }} className="nav-user-desktop">
                  <DropdownBtn
                    label={userLabel}
                    isOpen={userOpen}
                    onClick={() => { setUserOpen(!userOpen); setAdminOpen(false); setMoreOpen(false); setWsOpen(false); }}
                    color="#00ff88"
                    bgColor="rgba(0, 255, 136, 0.06)"
                    borderColor="rgba(0, 255, 136, 0.25)"
                    ariaLabel="User menu"
                  />
                  {userOpen && (
                    <div style={dropdownPanel} role="menu">
                      {/* Email display */}
                      <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a" }}>
                        <div style={{ fontSize: "10px", color: "#5a6a7a", marginBottom: "2px" }}>signed in as</div>
                        <div style={{ fontSize: "11px", color: "#8b949e", wordBreak: "break-all" }}>{userEmail}</div>
                      </div>
                      <button
                        onClick={() => signOut()}
                        role="menuitem"
                        style={{
                          ...dropdownItem,
                          color: "#ffcc00", borderBottom: "none",
                          marginTop: "2px",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 204, 0, 0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <span style={{ color: "#666", marginRight: "6px" }}>&gt;</span>
                        sign_out
                      </button>
                    </div>
                  )}
                </div>

                {/* Hamburger — mobile only */}
                <button
                  className="nav-hamburger"
                  onClick={() => setMenuOpen(!menuOpen)}
                  aria-label="Menu"
                  aria-expanded={menuOpen}
                  style={{
                    background: "transparent", border: "1px solid #1e2a3a",
                    color: menuOpen ? "#00ff88" : "#6b7280", padding: "6px 8px",
                    fontFamily: "inherit", fontSize: "18px", cursor: "pointer", lineHeight: 1,
                  }}
                >
                  {menuOpen ? "\u2715" : "\u2261"}
                </button>
              </>
            ) : (
              <button
                onClick={() => signIn("google")}
                style={{
                  padding: "6px 14px", borderRadius: "4px",
                  backgroundColor: "rgba(0, 255, 136, 0.08)", color: "#00ff88",
                  border: "1px solid rgba(0, 255, 136, 0.4)", fontFamily: "inherit",
                  fontSize: "13px", fontWeight: 500, cursor: "pointer",
                }}
              >
                <span style={{ color: "#00e5ff" }}>&gt; </span>sign_in --google
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile dropdown menu ── */}
      {menuOpen && session && (
        <div style={{ backgroundColor: "#0a0e14", borderTop: "1px solid #1e2a3a", padding: "8px 16px 12px" }}>
          {/* Section: Tools */}
          <div style={{ marginBottom: "8px" }}>
            <div style={{ fontSize: "10px", color: "#5a6a7a", textTransform: "uppercase", letterSpacing: "0.1em", padding: "4px 12px", marginBottom: "2px" }}>
              // tools
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {[...primaryLinks, ...overflowLinks].map((l) => {
                const isActive = pathname === l.href || pathname.startsWith(l.href + "/");
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="no-underline"
                    style={{
                      padding: "10px 12px", borderRadius: "4px", fontSize: "14px", fontWeight: 500,
                      color: isActive ? "#00ff88" : "#8b949e",
                      backgroundColor: isActive ? "rgba(0, 255, 136, 0.08)" : "transparent",
                      borderLeft: isActive ? "2px solid #00ff88" : "2px solid transparent",
                    }}
                  >
                    <span style={{ color: isActive ? "#00e5ff" : "#444", marginRight: "6px" }}>&gt;</span>
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Section: Admin (only for admins) */}
          {isAdmin && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", color: "rgba(255, 68, 68, 0.6)", textTransform: "uppercase", letterSpacing: "0.1em", padding: "4px 12px", marginBottom: "2px", borderTop: "1px solid #1e2a3a", paddingTop: "8px" }}>
                // admin
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {adminLinks.map((l) => {
                  const isActive = pathname === l.href || (l.href !== "/admin" && pathname.startsWith(l.href + "/"));
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="no-underline"
                      style={{
                        padding: "10px 12px", borderRadius: "4px", fontSize: "14px", fontWeight: 500,
                        color: isActive ? "#ff4444" : "#8b949e",
                        backgroundColor: isActive ? "rgba(255, 68, 68, 0.08)" : "transparent",
                        borderLeft: isActive ? "2px solid #ff4444" : "2px solid transparent",
                      }}
                    >
                      <span style={{ color: isActive ? "#ff4444" : "#555", marginRight: "6px" }}>&gt;</span>
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section: Account */}
          <div style={{ borderTop: "1px solid #1e2a3a", marginTop: "4px", paddingTop: "8px" }}>
            <div style={{ fontSize: "10px", color: "#5a6a7a", textTransform: "uppercase", letterSpacing: "0.1em", padding: "4px 12px", marginBottom: "4px" }}>
              // account
            </div>
            {/* Workspace switcher in mobile */}
            {workspaces.length > 1 && (
              <div style={{ padding: "4px 12px 8px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => switchWs(ws.id)}
                    style={{
                      padding: "4px 10px", borderRadius: "4px", border: "1px solid",
                      borderColor: ws.id === activeWsId ? "rgba(255, 136, 0, 0.4)" : "#1e2a3a",
                      backgroundColor: ws.id === activeWsId ? "rgba(255, 136, 0, 0.1)" : "transparent",
                      color: ws.id === activeWsId ? "#ff8800" : "#5a6a7a",
                      fontFamily: "inherit", fontSize: "11px", cursor: "pointer",
                    }}
                  >
                    {ws.id === activeWsId && "* "}{ws.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 12px" }}>
              <span style={{ fontSize: "11px", color: "#5a6a7a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {userEmail}
              </span>
              <button
                onClick={() => signOut()}
                style={{
                  padding: "6px 12px", backgroundColor: "transparent", color: "#ffcc00",
                  border: "1px solid rgba(255, 204, 0, 0.3)", fontFamily: "inherit",
                  fontSize: "12px", cursor: "pointer", flexShrink: 0, borderRadius: "4px",
                }}
              >
                sign_out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
