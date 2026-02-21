"use client";

import { useSession, signIn } from "next-auth/react";
import { useState, useEffect } from "react";
import Link from "next/link";

const MODULE_CARDS = [
  { href: "/recipes", module: "recipes", label: "RECIPES", desc: "Multi-step AI pipelines", cmd: "> run recipe --name novinar" },
  { href: "/llm", module: "llm", label: "LLM", desc: "Chat with Anthropic Sonnet or Gemini Flash", cmd: "> run llm --model sonnet" },
  { href: "/stt", module: "stt", label: "STT", desc: "Transcribe audio (Soniox)", cmd: "> run stt --engine soniox" },
  { href: "/tts", module: "tts", label: "TTS", desc: "Generate audio (ElevenLabs)", cmd: "> run tts --voice rachel" },
  { href: "/image", module: "image", label: "IMAGE", desc: "Generate & edit images (Flux, Gemini)", cmd: "> run image --model flux-dev" },
  { href: "/video", module: "video", label: "VIDEO", desc: "Generate video (Grok Imagine)", cmd: "> run video --prompt scene" },
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
  // undefined = not loaded yet, null = all allowed, string[] = restricted
  const [allowedModules, setAllowedModules] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    if (session) {
      fetch("/api/user/modules")
        .then((r) => r.json())
        .then((d) => setAllowedModules(d.allowedModules ?? null))
        .catch(() => setAllowedModules(null));
    }
  }, [session]);

  const modulesLoaded = allowedModules !== undefined;
  const visibleCards = MODULE_CARDS.filter((c) => {
    if (allowedModules === null || allowedModules === undefined) return true;
    return allowedModules.includes(c.module);
  });

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div style={{ color: "var(--green)" }}>
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
            color: "var(--green)",
            fontSize: "10px",
            lineHeight: "1.2",
            textShadow: "0 0 10px rgba(0, 255, 136, 0.3)",
            textAlign: "center",
          }}
        >
          {ASCII_LOGO}
        </pre>
        <p style={{ color: "var(--gray)", fontFamily: "inherit" }}>
          [ MORANA ] Slovanska boginja smrti // internal AI ops terminal
        </p>
        <button
          onClick={() => signIn("google")}
          style={{
            background: "transparent",
            border: "1px solid var(--green)",
            color: "var(--green)",
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
          color: "var(--green)",
          fontSize: "9px",
          lineHeight: "1.2",
          textShadow: "0 0 10px rgba(0, 255, 136, 0.3)",
          marginBottom: "16px",
        }}
      >
        {ASCII_LOGO}
      </pre>
      <div style={{ marginBottom: "24px", color: "var(--gray)", fontSize: "13px" }}>
        <span style={{ color: "var(--green)" }}>$</span> whoami{" "}
        <span style={{ color: "var(--white)" }}>{session.user?.name || session.user?.email}</span>
        <br />
        <span style={{ color: "var(--green)" }}>$</span> status{" "}
        <span style={{ color: "var(--green)" }}>ONLINE</span>{" "}
        <span style={{ color: "var(--gray)" }}>| session active | {visibleCards.length} modules loaded</span>
      </div>

      <div
        style={{
          color: "var(--yellow)",
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          marginBottom: "12px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "8px",
        }}
      >
        Available Modules
      </div>

      {!modulesLoaded ? (
        <div style={{ color: "var(--green)", fontSize: "13px", padding: "12px 0" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading modules...
        </div>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group block"
            style={{
              border: "1px solid var(--border)",
              backgroundColor: "var(--bg-panel)",
              padding: "16px",
              transition: "all 0.2s ease",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--green)";
              e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                color: "var(--green)",
                fontSize: "14px",
                fontWeight: 700,
                marginBottom: "4px",
                letterSpacing: "0.05em",
              }}
            >
              [{t.label}]
            </div>
            <div style={{ color: "var(--gray)", fontSize: "12px", marginBottom: "8px" }}>
              {t.desc}
            </div>
            <div
              style={{
                color: "var(--green-dim)",
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
      )}
    </div>
  );
}
