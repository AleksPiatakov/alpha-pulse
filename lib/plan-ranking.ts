/** Deterministic scanner ordering. Technical confirmation is not proof of profitability. */
export type RankedPlan = {
  status: "ACTIVE" | "REVIEW" | "INVALID";
  qualityGate?: { passed: boolean };
  score: number;
  riskReward: number;
  symbol: string;
  currentPrice: number;
  entryLow: number;
  entryHigh: number;
};
export function isAtEntryZone(p: RankedPlan): boolean {
  return [p.currentPrice, p.entryLow, p.entryHigh].every(Number.isFinite) &&
    p.currentPrice >= Math.min(p.entryLow, p.entryHigh) &&
    p.currentPrice <= Math.max(p.entryLow, p.entryHigh);
}
export function comparePlanPriority(a: RankedPlan, b: RankedPlan): number {
  // Full quality gate before technical ACTIVE; zone only breaks ties within each tier.
  const tier = (p: RankedPlan) => p.status === "ACTIVE"
    ? p.qualityGate?.passed === true ? 0 : 1
    : p.status === "REVIEW" ? 2 : 3;
  return tier(a) - tier(b) ||
    Number(isAtEntryZone(b)) - Number(isAtEntryZone(a)) ||
    b.score - a.score || b.riskReward - a.riskReward ||
    a.symbol.localeCompare(b.symbol);
}
