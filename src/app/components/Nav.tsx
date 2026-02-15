"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect } from "react";

const baseLinks = [
  { href: "/llm", label: "LLM" },
  { href: "/stt", label: "STT" },
  { href: "/tts", label: "TTS" },
  { href: "/image", label: "Image" },
  { href: "/history", label: "History" },
  { href: "/usage", label: "Usage" },
];

export default function Nav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";
  const links = isAdmin ? [...baseLinks, { href: "/admin", label: "Admin" }] : baseLinks;
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "48px" }}>
          {/* Left: logo */}
          <Link
            href="/"
            className="no-underline"
            style={{ color: "#00ff88", letterSpacing: "0.05em", fontSize: "18px", fontWeight: 700, flexShrink: 0 }}
          >
            <span style={{ color: "#555" }}>[</span>MORANA<span style={{ color: "#555" }}>]</span>
          </Link>

          {/* Center: nav links — desktop only */}
          {session && (
            <div className="nav-links-desktop">
              <span style={{ color: "#555", fontSize: "12px", marginRight: "4px" }}>//</span>
              {links.map((l) => {
                const isActive = pathname === l.href;
                const isAdminLink = l.href === "/admin";
                const activeColor = isAdminLink ? "#ff4444" : "#00ff88";
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="no-underline"
                    style={{
                      padding: "4px 10px",
                      borderRadius: "4px",
                      fontSize: "13px",
                      fontWeight: 500,
                      color: isActive ? activeColor : "#6b7280",
                      backgroundColor: isActive ? `rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.08)` : "transparent",
                      border: isActive ? `1px solid rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.2)` : "1px solid transparent",
                      transition: "all 0.15s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = activeColor; e.currentTarget.style.backgroundColor = `rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.05)`; } }}
                    onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = "#6b7280"; e.currentTarget.style.backgroundColor = "transparent"; } }}
                  >
                    <span style={{ color: isActive ? (isAdminLink ? "#ff4444" : "#00e5ff") : "#444", marginRight: "2px" }}>&gt;</span>
                    {l.label}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Right: user + hamburger */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {session ? (
              <>
                <span className="nav-email" style={{ fontSize: "13px", color: "#00ff88", opacity: 0.8 }}>
                  <span style={{ color: "#555" }}>user@</span>{session.user?.email}
                </span>
                <button
                  onClick={() => signOut()}
                  className="nav-signout-desktop"
                  style={{
                    padding: "4px 10px", borderRadius: "4px", backgroundColor: "transparent",
                    color: "#ffcc00", border: "1px solid rgba(255, 204, 0, 0.3)",
                    fontFamily: "inherit", fontSize: "12px", fontWeight: 500, cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 204, 0, 0.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  sign_out
                </button>
                <button
                  className="nav-hamburger"
                  onClick={() => setMenuOpen(!menuOpen)}
                  style={{
                    background: "transparent", border: "1px solid #1e2a3a",
                    color: menuOpen ? "#00ff88" : "#6b7280", padding: "6px 8px",
                    fontFamily: "inherit", fontSize: "18px", cursor: "pointer", lineHeight: 1,
                  }}
                >
                  {menuOpen ? "✕" : "≡"}
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

      {/* Mobile dropdown menu */}
      {menuOpen && session && (
        <div style={{ backgroundColor: "#0a0e14", borderTop: "1px solid #1e2a3a", padding: "8px 16px 12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {links.map((l) => {
              const isActive = pathname === l.href;
              const isAdminLink = l.href === "/admin";
              const activeColor = isAdminLink ? "#ff4444" : "#00ff88";
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className="no-underline"
                  style={{
                    padding: "10px 12px", borderRadius: "4px", fontSize: "14px", fontWeight: 500,
                    color: isActive ? activeColor : "#8b949e",
                    backgroundColor: isActive ? `rgba(${isAdminLink ? "255, 68, 68" : "0, 255, 136"}, 0.08)` : "transparent",
                    borderLeft: isActive ? `2px solid ${activeColor}` : "2px solid transparent",
                  }}
                >
                  <span style={{ color: isActive ? (isAdminLink ? "#ff4444" : "#00e5ff") : "#444", marginRight: "6px" }}>&gt;</span>
                  {l.label}
                </Link>
              );
            })}
          </div>
          <div style={{ borderTop: "1px solid #1e2a3a", marginTop: "8px", paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#5a6a7a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {session.user?.email}
            </span>
            <button
              onClick={() => signOut()}
              style={{ padding: "4px 10px", backgroundColor: "transparent", color: "#ffcc00", border: "1px solid rgba(255, 204, 0, 0.3)", fontFamily: "inherit", fontSize: "11px", cursor: "pointer", flexShrink: 0 }}
            >
              sign_out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
