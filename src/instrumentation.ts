/**
 * Next.js Instrumentation — runs once on server startup.
 * Used to auto-sync recipe presets from code to database.
 */
export async function register() {
  // Only run on Node.js server (not Edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { syncAllPresets } = await import("./lib/preset-sync");
    await syncAllPresets();
  }
}
