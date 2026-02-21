"use client";

const statusConfig: Record<string, { color: string; bg: string; className: string }> = {
  queued: {
    color: "var(--yellow)",
    bg: "rgba(255, 204, 0, 0.1)",
    className: "status-queued",
  },
  running: {
    color: "var(--cyan)",
    bg: "rgba(0, 229, 255, 0.1)",
    className: "status-running",
  },
  done: {
    color: "var(--green)",
    bg: "rgba(0, 255, 136, 0.1)",
    className: "status-done",
  },
  error: {
    color: "var(--red)",
    bg: "rgba(255, 68, 68, 0.1)",
    className: "status-error",
  },
};

const fallback = {
  color: "var(--gray)",
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
