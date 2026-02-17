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

  // Extract fact-check details from step results
  let factCheckSummary = "";
  let flaggedClaims: { claim: string; issue: string; severity: string }[] = [];
  for (const sr of execution.stepResults) {
    if (sr.status !== "done" || !sr.outputFull) continue;
    const full = sr.outputFull as { text?: string };
    if (!full.text) continue;
    try {
      const jsonMatch = full.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.overall_verdict && parsed.confidence_score != null) {
        factCheckSummary = parsed.summary || "";
        flaggedClaims = parsed.flagged_claims || [];
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

  // Convert markdown **bold** to <strong> (applied at render time for all content)
  const mdBold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const title = mdBold((drupalPayload?.title as string) || execution.recipe.name);
  const subtitle = mdBold((drupalPayload?.subtitle as string) || (drupalPayload?.summary as string) || "");
  const bodyHtml = mdBold((drupalPayload?.body as string) || "");
  const confidenceScore = execution.confidenceScore;
  const warningFlag = execution.warningFlag;
  const sources = (drupalPayload?.sources as { title: string; url: string }[]) || [];
  const generatedAt = (drupalPayload?.generatedAt as string) || execution.startedAt.toISOString();

  const confidenceColor = confidenceScore
    ? confidenceScore > 80 ? "#22c55e" : confidenceScore > 50 ? "#eab308" : "#ef4444"
    : "#888";

  const warningBgColor = warningFlag === "high_risk" ? "rgba(239, 68, 68, 0.1)" : "rgba(249, 115, 22, 0.1)";
  const warningBorderColor = warningFlag === "high_risk" ? "rgba(239, 68, 68, 0.4)" : "rgba(249, 115, 22, 0.4)";
  const warningTextColor = warningFlag === "high_risk" ? "#fca5a5" : "#fdba74";

  return (
    <html lang="sl">
      <head>
        <meta name="robots" content="noindex, nofollow" />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style dangerouslySetInnerHTML={{ __html: `
          .article-body h1 { font-size: 26px; font-weight: 700; color: #fff; margin: 32px 0 12px; line-height: 1.3; }
          .article-body h2 { font-size: 21px; font-weight: 700; color: #f0f0f0; margin: 28px 0 10px; line-height: 1.35; }
          .article-body h3 { font-size: 17px; font-weight: 700; color: #e0e0e0; margin: 24px 0 8px; line-height: 1.4; }
          .article-body p { margin: 0 0 14px; }
          .article-body ul { margin: 0 0 14px; padding-left: 24px; }
          .article-body li { margin-bottom: 4px; }
          .article-body strong { color: #fff; }
        `}} />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#0a0a0a", fontFamily: "'Georgia', 'Times New Roman', serif", color: "#e0e0e0" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px 80px" }}>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px", paddingBottom: "16px", borderBottom: "2px solid #333" }}>
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

          {/* Fact-check warning box */}
          {warningFlag && factCheckSummary && (
            <div style={{
              marginBottom: "24px",
              padding: "16px 20px",
              backgroundColor: warningBgColor,
              border: `1px solid ${warningBorderColor}`,
              borderRadius: "6px",
              fontFamily: "system-ui, sans-serif",
            }}>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: warningTextColor, marginBottom: "8px" }}>
                {warningFlag === "high_risk" ? "Opozorilo: Visoko tveganje" : "Opozorilo: Potreben pregled"}
              </div>
              <div style={{ fontSize: "14px", lineHeight: 1.6, color: "#d0d0d0", marginBottom: flaggedClaims.length > 0 ? "12px" : "0" }}>
                {factCheckSummary}
              </div>
              {flaggedClaims.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  {flaggedClaims.map((fc, i) => (
                    <li key={i} style={{ fontSize: "13px", lineHeight: 1.5, color: "#bbb", marginBottom: "4px" }}>
                      <strong style={{ color: warningTextColor }}>{fc.claim}</strong>
                      {fc.issue && <span> — {fc.issue}</span>}
                      {fc.severity === "error" && <span style={{ color: "#ef4444", fontSize: "10px", marginLeft: "6px", fontWeight: 700 }}>ERROR</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {drupalPayload ? (
            <>
              {/* Article */}
              <h1 dangerouslySetInnerHTML={{ __html: title }} style={{ fontSize: "32px", lineHeight: 1.3, marginBottom: "8px", fontWeight: 700, color: "#fff" }} />
              {subtitle && (
                <p dangerouslySetInnerHTML={{ __html: subtitle }} style={{ fontSize: "15px", lineHeight: 1.5, color: "#999", marginBottom: "24px", fontStyle: "italic" }} />
              )}
              <div
                className="article-body"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
                style={{ fontSize: "14px", lineHeight: 1.8, color: "#d0d0d0" }}
              />

              {/* Sources */}
              {sources.length > 0 && (
                <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "1px solid #333" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#666", fontFamily: "system-ui, sans-serif", marginBottom: "8px" }}>Viri</h3>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {sources.map((s, i) => (
                      <li key={i} style={{ marginBottom: "4px", fontSize: "14px", fontFamily: "system-ui, sans-serif" }}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
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
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "15px", lineHeight: 1.7, color: "#d0d0d0", fontFamily: "inherit" }}>
              {fallbackText || "No preview available."}
            </pre>
          )}

          {/* Footer */}
          <div style={{ marginTop: "48px", paddingTop: "16px", borderTop: "1px solid #333", fontSize: "12px", color: "#666", fontFamily: "system-ui, sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Generirano z AI &middot; {new Date(generatedAt).toLocaleDateString("sl-SI")}</span>
            <span style={{ fontSize: "10px", color: "#444" }}>MORANA</span>
          </div>
        </div>
      </body>
    </html>
  );
}
