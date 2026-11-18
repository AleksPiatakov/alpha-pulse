/**
 * Read-only market-sweep health. A failed fetch counts as visited for sweep
 * progress, but NEVER as successfully checked or fresh market evidence.
 */
export function assessScanFreshness(
 symbols: readonly string[],
 visitedAt: ReadonlyMap<string, number>,
 failedInSweep: ReadonlySet<string>,
 now: number,
 freshnessMs: number,
) {
  if (!Number.isFinite(now) || !Number.isFinite(freshnessMs) || freshnessMs <= 0) {
    throw new Error("Invalid scan observation/freshness window");
  }
  let freshChecked = 0;
  let staleChecked = 0;
  let failedChecked = 0;
  let unchecked = 0;
  let oldestCheckedAgeMs: number | null = null;
  for (const symbol of symbols) {
    const at = visitedAt.get(symbol);
    if (at === undefined) { unchecked++; continue; }
    if (failedInSweep.has(symbol) || !Number.isFinite(at) || at > now) {
      failedChecked++;
      continue;
    }
    const age = now - at;
    oldestCheckedAgeMs = Math.max(oldestCheckedAgeMs ?? 0, age);
    if (age <= freshnessMs) freshChecked++;
    else staleChecked++;
  }
  return {
    freshChecked, staleChecked, failedChecked, unchecked,
    oldestCheckedAgeSeconds: oldestCheckedAgeMs === null
      ? null : Math.round(oldestCheckedAgeMs / 1000),
    completeAndFresh: symbols.length > 0 && freshChecked === symbols.length,
  };
}
