#!/usr/bin/env node
// Dedicated local polling process for the Alpha Pulse scanner.
// Keep the Next.js server running separately; no exchange API secrets are used here.
// This worker never places orders. Scenario tracking lives in the running Next.js process and resets on its restart.
const base = process.env.ALPHA_PULSE_SCAN_URL ?? "http://127.0.0.1:3000";
const interval = Math.max(20_000, Number(process.env.ALPHA_PULSE_SCAN_INTERVAL_MS) || 30_000);
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tick() {
  try {
    const response = await fetch(new URL("/api/scan/worker", base), { signal: AbortSignal.timeout(120_000), cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error(`Scanner API HTTP ${response.status}: expected JSON, received ${contentType || "unknown content type"}. Check that Alpha Pulse is running at ${base}.`);
    }
    const result = await response.json();
    if (!response.ok || result?.success !== true) throw new Error(result?.error ?? `Scanner API HTTP ${response.status}`);
    if (![result.covered, result.eligible, result.analyzed, result.universeInstruments, result.universePages].every(Number.isFinite) || result.eligible <= 0 || result.covered > result.eligible) {
      throw new Error("Scanner API returned inconsistent market coverage; not reporting a successful sweep.");
    }
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] coverage ${result.covered}/${result.eligible} (${result.coveragePercent}%) | this batch ${result.analyzed} | sweep ${result.cycleCompleted ? "complete" : "in progress"} | registry ${result.universeInstruments} active instruments / ${result.universePages} pages | sweeps ${result.completedSweeps ?? "?"} | watching ${result.watchStatusCounts?.watching ?? 0}, review-ready ${result.watchStatusCounts?.ready ?? 0}, stale ${result.watchStatusCounts?.stale ?? 0}, expired ${result.watchStatusCounts?.expired ?? 0}, unavailable ${result.watchStatusCounts?.unavailable ?? 0} (research-only; not orders)`);
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
