"use client";

import { useSession, signIn } from "next-auth/react";
import Link from "next/link";

const tools = [
  { href: "/llm", label: "LLM", desc: "Chat with Anthropic Sonnet or Gemini Flash", cmd: "> run llm --model sonnet" },
  { href: "/stt", label: "STT", desc: "Transcribe audio (Soniox)", cmd: "> run stt --engine soniox" },
  { href: "/tts", label: "TTS", desc: "Generate audio (ElevenLabs)", cmd: "> run tts --voice rachel" },
  { href: "/history", label: "HISTORY", desc: "View all runs", cmd: "> query runs --all" },
  { href: "/usage", label: "USAGE", desc: "Track costs and API usage", cmd: "> stats --costs --usage" },
];

const ASCII_LOGO = `
 __  __  ___  ____      _    _   _    _
|  \\/  |/ _ \\|  _ \\    / \\  | \\ | |  / \\
| |\\/| | | | | |_) |  / _ \\ |  \\| | / _ \\
| |  | | |_| |  _ <  / ___ \\| |\\  |/ ___ \\
|_|  |_|\\___/|_| \\_\\/_/   \\_\\_| \\_/_/   \\_\\
`;

export default function Home() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div style={{ color: "#00ff88" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Initializing system...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <pre
          style={{
            color: "#00ff88",
            fontSize: "10px",
            lineHeight: "1.2",
            textShadow: "0 0 10px rgba(0, 255, 136, 0.3)",
            textAlign: "center",
          }}
        >
          {ASCII_LOGO}
        </pre>
        <p style={{ color: "#5a6a7a", fontFamily: "inherit" }}>
          [ MORANA ] Slovanska boginja smrti // internal AI ops terminal
        </p>
        <button
          onClick={() => signIn("google")}
          style={{
            background: "transparent",
            border: "1px solid #00ff88",
            color: "#00ff88",
            padding: "10px 24px",
            fontFamily: "inherit",
            fontSize: "13px",
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 255, 136, 0.3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {"> authenticate --provider google"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <pre
        style={{
          color: "#00ff88",
          fontSize: "9px",
          lineHeight: "1.2",
          textShadow: "0 0 10px rgba(0, 255, 136, 0.3)",
          marginBottom: "16px",
        }}
      >
        {ASCII_LOGO}
      </pre>
      <div style={{ marginBottom: "24px", color: "#5a6a7a", fontSize: "13px" }}>
        <span style={{ color: "#00ff88" }}>$</span> whoami{" "}
        <span style={{ color: "#e0e0e0" }}>{session.user?.name || session.user?.email}</span>
        <br />
        <span style={{ color: "#00ff88" }}>$</span> status{" "}
        <span style={{ color: "#00ff88" }}>ONLINE</span>{" "}
        <span style={{ color: "#5a6a7a" }}>| session active | {tools.length} modules loaded</span>
      </div>

      <div
        style={{
          color: "#ffcc00",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          marginBottom: "12px",
          borderBottom: "1px solid #1e2a3a",
          paddingBottom: "8px",
        }}
      >
        Available Modules
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group block"
            style={{
              border: "1px solid #1e2a3a",
              backgroundColor: "#0d1117",
              padding: "16px",
              transition: "all 0.2s ease",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#00ff88";
              e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#1e2a3a";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                color: "#00ff88",
                fontSize: "14px",
                fontWeight: 700,
                marginBottom: "4px",
                letterSpacing: "0.05em",
              }}
            >
              [{t.label}]
            </div>
            <div style={{ color: "#5a6a7a", fontSize: "12px", marginBottom: "8px" }}>
              {t.desc}
            </div>
            <div
              style={{
                color: "#00cc6a",
                fontSize: "11px",
                fontFamily: "inherit",
                opacity: 0.7,
              }}
            >
              {t.cmd}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
