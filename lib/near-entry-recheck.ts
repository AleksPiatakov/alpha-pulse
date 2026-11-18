/**
 * Supplemental, research-only rechecks for ACTIVE plans rejected solely
 * because the market is too far from the planned Limit entry.
 * This NEVER grants order permission or changes the quality threshold.
 */
import type { TradePlan } from "./trading.ts";

export const NEAR_ENTRY_RECHECK_INTERVAL_MS = 60_000;
export const NEAR_ENTRY_RECHECK_MAX = 4;
const DISTANCE_REASON = "Ціна занадто далеко від входу.";

export function selectNearEntryRechecks(
  cached: ReadonlyMap<string, {plan: TradePlan; checkedAt: number}>,
  alreadyInSweep: ReadonlySet<string>,
  available: ReadonlySet<string>,
  now: number,
  maximum = NEAR_ENTRY_RECHECK_MAX,
): string[] {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(maximum) ||
      maximum < 0 || maximum > NEAR_ENTRY_RECHECK_MAX) throw new Error("Invalid recheck parameters");
  return [...cached].filter(([symbol, record]) => {
    const p = record.plan;
    const reasons = p.qualityGate?.reasons;
    return available.has(symbol) && !alreadyInSweep.has(symbol) &&
      p.status === "ACTIVE" && p.qualityGate?.passed === false &&
      Array.isArray(reasons) && reasons.length === 1 &&
      reasons[0] === DISTANCE_REASON &&
      p.score >= 90 && p.readiness?.met === p.readiness?.total &&
      p.readiness?.total > 0 &&
      Number.isFinite(p.limitEntry24h?.distanceAtr) &&
      p.limitEntry24h!.distanceAtr > 0.75 &&
      p.limitEntry24h!.distanceAtr <= 1.5 &&
      Number.isSafeInteger(record.checkedAt) &&
      now - record.checkedAt >= NEAR_ENTRY_RECHECK_INTERVAL_MS &&
      now - record.checkedAt <= 45 * 60_000;
  }).sort((a,b) =>
    a[1].plan.limitEntry24h!.distanceAtr - b[1].plan.limitEntry24h!.distanceAtr ||
    a[1].checkedAt - b[1].checkedAt ||
    a[0].localeCompare(b[0])
  ).slice(0,maximum).map(([symbol]) => symbol);
}
