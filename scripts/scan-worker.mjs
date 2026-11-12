#!/usr/bin/env node
// Dedicated local polling process for the Alpha Pulse scanner.
// Keep the Next.js server running separately; no exchange API secrets are used here.
// This worker does not place orders and does not persist signal history.
const base = process.env.ALPHA_PULSE_SCAN_URL ?? "http://127.0.0.1:3000";
const interval = Math.max(20_000, Number(process.env.ALPHA_PULSE_SCAN_INTERVAL_MS) || 30_000);
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tick() {
  try {
    const response = await fetch(new URL("/api/scan/worker", base), { signal: AbortSignal.timeout(120_000), cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error ?? `HTTP ${response.status}`);
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] coverage ${result.covered}/${result.eligible} (${result.coveragePercent}%) | this batch ${result.analyzed} | sweep ${result.cycleCompleted ? "complete" : "in progress"} | registry ${result.universeInstruments} active instruments / ${result.universePages} pages`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`Alpha Pulse market-scan worker -> ${base}; polling every ${interval / 1000}s. Ctrl+C stops; no order operations.`);
while (!stopping) {
  await tick();
  if (stopping) break;
  await sleep(interval);
}
