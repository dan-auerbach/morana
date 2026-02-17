import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Metadata } from "next";

type Props = {
  params: Promise<{ hash: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hash } = await params;
  const execution = await prisma.recipeExecution.findUnique({
    where: { previewHash: hash },
    select: { recipe: { select: { name: true } } },
  });

  return {
    title: execution ? `Preview — ${execution.recipe.name}` : "Preview",
    robots: { index: false, follow: false },
  };
}

export default async function PreviewPage({ params }: Props) {
  const { hash } = await params;

  const execution = await prisma.recipeExecution.findUnique({
    where: { previewHash: hash },
    include: {
      recipe: { select: { name: true } },
      stepResults: {
        orderBy: { stepIndex: "asc" },
        select: { stepIndex: true, outputFull: true, status: true },
      },
    },
  });

  if (!execution || execution.status !== "done") {
    notFound();
  }

  // Find Drupal JSON from output_format step (last step with parseable JSON)
  let drupalPayload: Record<string, unknown> | null = null;
  for (const sr of [...execution.stepResults].reverse()) {
    if (sr.status !== "done" || !sr.outputFull) continue;
    const full = sr.outputFull as { text?: string };
    if (!full.text) continue;
    try {
      const parsed = JSON.parse(full.text);
      if (parsed.format === "drupal_article" || parsed.body || parsed.title) {
        drupalPayload = parsed;
        break;
      }
    } catch {
      continue;
    }
  }

  // Fallback: show last step's text output
  let fallbackText = "";
  if (!drupalPayload) {
    for (const sr of [...execution.stepResults].reverse()) {
      if (sr.status !== "done" || !sr.outputFull) continue;
      const full = sr.outputFull as { text?: string };
      if (full.text && full.text.length > 50) {
        fallbackText = full.text;
        break;
      }
    }
  }

  const title = (drupalPayload?.title as string) || execution.recipe.name;
  const subtitle = (drupalPayload?.subtitle as string) || (drupalPayload?.summary as string) || "";
  const bodyHtml = (drupalPayload?.body as string) || "";
  const confidenceScore = execution.confidenceScore;
  const warningFlag = execution.warningFlag;
  const sources = (drupalPayload?.sources as { title: string; url: string }[]) || [];
  const generatedAt = (drupalPayload?.generatedAt as string) || execution.startedAt.toISOString();

  const confidenceColor = confidenceScore
    ? confidenceScore > 80 ? "#22c55e" : confidenceScore > 50 ? "#eab308" : "#ef4444"
    : "#888";

  return (
    <html lang="sl">
      <head>
        <meta name="robots" content="noindex, nofollow" />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#fafafa", fontFamily: "'Georgia', 'Times New Roman', serif", color: "#1a1a1a" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px 80px" }}>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px", paddingBottom: "16px", borderBottom: "2px solid #e5e5e5" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", fontFamily: "system-ui, sans-serif" }}>
              AI Preview
            </span>
            {confidenceScore != null && (
              <span style={{ fontSize: "11px", fontWeight: 700, color: confidenceColor, fontFamily: "system-ui, sans-serif", border: `1px solid ${confidenceColor}`, padding: "2px 8px", borderRadius: "4px" }}>
                {confidenceScore}%
              </span>
            )}
            {warningFlag && (
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#fff", backgroundColor: warningFlag === "high_risk" ? "#ef4444" : "#f97316", padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", fontFamily: "system-ui, sans-serif" }}>
                {warningFlag.replace(/_/g, " ")}
              </span>
            )}
          </div>

          {drupalPayload ? (
            <>
              {/* Article */}
              <h1 style={{ fontSize: "32px", lineHeight: 1.3, marginBottom: "8px", fontWeight: 700 }}>{title}</h1>
              {subtitle && (
                <p style={{ fontSize: "18px", lineHeight: 1.5, color: "#555", marginBottom: "24px", fontStyle: "italic" }}>{subtitle}</p>
              )}
              <div
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
                style={{ fontSize: "17px", lineHeight: 1.8, color: "#333" }}
              />

              {/* Sources */}
              {sources.length > 0 && (
                <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "1px solid #e5e5e5" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888", fontFamily: "system-ui, sans-serif", marginBottom: "8px" }}>Viri</h3>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {sources.map((s, i) => (
                      <li key={i} style={{ marginBottom: "4px", fontSize: "14px", fontFamily: "system-ui, sans-serif" }}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            // Fallback: plain text
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "15px", lineHeight: 1.7, color: "#333", fontFamily: "inherit" }}>
              {fallbackText || "No preview available."}
            </pre>
          )}

          {/* Footer */}
          <div style={{ marginTop: "48px", paddingTop: "16px", borderTop: "1px solid #e5e5e5", fontSize: "12px", color: "#aaa", fontFamily: "system-ui, sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Generirano z AI &middot; {new Date(generatedAt).toLocaleDateString("sl-SI")}</span>
            <span style={{ fontSize: "10px", color: "#ccc" }}>MORANA</span>
          </div>
        </div>
      </body>
    </html>
  );
}
