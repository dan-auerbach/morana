"use client";

const statusConfig: Record<string, { color: string; bg: string; className: string }> = {
  queued: {
    color: "#ffcc00",
    bg: "rgba(255, 204, 0, 0.1)",
    className: "status-queued",
  },
  running: {
    color: "#00e5ff",
    bg: "rgba(0, 229, 255, 0.1)",
    className: "status-running",
  },
  done: {
    color: "#00ff88",
    bg: "rgba(0, 255, 136, 0.1)",
    className: "status-done",
  },
  error: {
    color: "#ff4444",
    bg: "rgba(255, 68, 68, 0.1)",
    className: "status-error",
  },
};

const fallback = {
  color: "#5a6a7a",
  bg: "rgba(90, 106, 122, 0.1)",
  className: "",
};

export default function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || fallback;

  return (
    <span
      className={cfg.className}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        fontSize: "11px",
        fontFamily: "inherit",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: cfg.color,
        backgroundColor: cfg.bg,
        border: `1px solid ${cfg.color}`,
        borderRadius: "2px",
      }}
    >
      [{status}]
    </span>
  );
}
