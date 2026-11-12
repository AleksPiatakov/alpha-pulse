/**
 * Independent, read-only snapshot evaluator. No API fetches, time reads, or order access.
 * Compare the scanner's frozen result to a separate calculation on the SAME input.
 * Close-price mode isolates the live ticker vs completed-candle discrepancy.
 */
import { closedMarketFeatures } from "./closed-market-features.ts";
import { parseExecutionRules } from "./bybit-execution-rules.ts";
import { verifyMarketInputSnapshot, type SealedMarketInputSnapshot } from "./market-input-snapshot.ts";
import { calculatePlanningLevels, assessPlanningLevels } from "./trade-planning-engine.ts";
import { atrBars, emaBars, nearestSwingLevel, trendBars, roundToTick, type TechnicalDirection, type PriceBar } from "./technical-plan-core.ts";
import type { TradePlan } from "./trading.ts";

export type SnapshotEvaluation = {
  mode: "ticker-reference" | "closed-30m-reference";
  priceReference: number;
  direction: TechnicalDirection;
  entry: number; stop: number; target: number;
  score: number; status: "ACTIVE" | "REVIEW"; qualityPassed: boolean;
  readiness: number; distanceAtr: number; rewardRisk: number;
  hasConfirmedEntry: boolean; hasConfirmedTarget: boolean;
};
export type SnapshotParityReport = {
  schema: "alpha-pulse-parity-v1"; symbol: string; sha256: string;
  tickerReference: SnapshotEvaluation | null;
  closeReference: SnapshotEvaluation | null;
  scannerMatches: boolean | null; mismatches: string[];
  closeModeDifferences: string[];
  limitations: string[];
};
function bars(candles: string[][]): PriceBar[] {
  return candles.map(c => ({high: Number(c[2]), low: Number(c[3]), close: Number(c[4])}));
}
export function evaluateSnapshotReference(
  sealed: SealedMarketInputSnapshot,
  mode: "ticker-reference" | "closed-30m-reference",
): SnapshotEvaluation | null {
  if (!verifyMarketInputSnapshot(sealed)) throw new Error("Знімок пошкоджений або контрольна сума не збігається.");
  const { snapshot } = sealed;
  const rules = parseExecutionRules(snapshot.instrument);
  if (!rules) return null;
  const h30 = bars(snapshot.candles["30"]), h60 = bars(snapshot.candles["60"]);
  const h240 = bars(snapshot.candles["240"]), daily = bars(snapshot.candles.D);
  const f = closedMarketFeatures(snapshot.candles["60"].map(c => ({
    close: Number(c[4]), volume: Number(c[5]), turnover: Number(c[6]),
  })));
  if (!f) return null;
  const price = mode === "ticker-reference" ? Number(snapshot.ticker.lastPrice) : h30.at(-1)!.close;
  const d30 = trendBars(h30), d60 = trendBars(h60), d240 = trendBars(h240);
  const direction: TechnicalDirection = d240 ?? d60 ?? d30 ?? (f.change24h >= 0 ? "LONG" : "SHORT");
  const atr30 = atrBars(h30), atr60 = atrBars(h60);
  if (!(atr30 > 0 && atr60 > 0)) return null;
  const p30 = nearestSwingLevel(h30, direction, price);
  const p60 = nearestSwingLevel(h60, direction, price);
  const p240 = nearestSwingLevel(h240, direction, price);
  const pd = nearestSwingLevel(daily, direction, price);
  const ema20 = emaBars(h30, 20);
  const fallback = direction === "LONG"
    ? Math.min(ema20, price - atr30 * 0.25)
    : Math.max(ema20, price + atr30 * 0.25);
  const levels = calculatePlanningLevels({
    direction, currentPrice: price, atr30m: atr30, atr1h: atr60,
    supportLevels: [p30, p60, p240, pd], dailyBars: daily,
    fallbackEntry: fallback, tickSize: rules.tickSize,
  });
  if (!levels || levels.distanceAtr > 20 || levels.rewardRisk < 0.5) return null;
  const {scenario, gate} = assessPlanningLevels({
    direction, levels, atr30m: atr30, tickSize: rules.tickSize,
    quality: {
      direction4h: d240, direction1h: d60, direction30m: d30,
      relativeVolume: f.relativeVolume1h, change24h: f.change24h,
      turnover24h: f.turnover24h,
      pivot1h: p60 !== null, pivot4h: p240 !== null, pivotDaily: pd !== null,
    },
  });
  return {
    mode, priceReference: roundToTick(price, rules.tickSize), direction,
    entry: levels.entry, stop: levels.stop, target: levels.target,
    score: scenario.score, status: scenario.status, qualityPassed: gate.accepted,
    readiness: scenario.confirmedConditions,
    distanceAtr: levels.distanceAtr, rewardRisk: levels.rewardRisk,
    hasConfirmedEntry: levels.confirmedEntry, hasConfirmedTarget: levels.confirmedTarget,
  };
}
export function compareFrozenMarketPlan(
  sealed: SealedMarketInputSnapshot, plan: TradePlan | null,
): SnapshotParityReport {
  if (!verifyMarketInputSnapshot(sealed)) throw new Error("Контрольна сума знімка не збігається.");
  const tickerReference = evaluateSnapshotReference(sealed, "ticker-reference");
  const closeReference = evaluateSnapshotReference(sealed, "closed-30m-reference");
  const mismatches: string[] = [];
  if (Boolean(plan) !== Boolean(tickerReference)) mismatches.push("plan-presence");
  if (plan && tickerReference) {
    const checks: Array<[string, number | string | boolean | undefined, number | string | boolean]> = [
      ["direction", plan.direction, tickerReference.direction],
      ["entry", plan.entryPrice, tickerReference.entry],
      ["stop", plan.stopLoss, tickerReference.stop],
      ["target", plan.takeProfit2, tickerReference.target],
      ["score", plan.score, tickerReference.score],
      ["status", plan.status, tickerReference.status],
      ["readiness", plan.readiness?.met, tickerReference.readiness],
      ["quality", plan.qualityGate?.passed, tickerReference.qualityPassed],
    ];
    for (const [label, actual, expected] of checks) if (actual !== expected) mismatches.push(label);
  }
  const closeModeDifferences: string[] = [];
  if (Boolean(tickerReference) !== Boolean(closeReference)) closeModeDifferences.push("plan-presence");
  if (tickerReference && closeReference) {
    for (const key of ["priceReference", "direction", "entry", "stop", "target", "score", "status", "qualityPassed", "readiness"] as const)
      if (tickerReference[key] !== closeReference[key]) closeModeDifferences.push(key);
  }
  return {
    schema: "alpha-pulse-parity-v1", symbol: sealed.snapshot.symbol, sha256: sealed.sha256,
    tickerReference, closeReference,
    scannerMatches: mismatches.length === 0, mismatches, closeModeDifferences,
    limitations: [
      "Порівняння двох незалежних обчислень на одному знімку, не статистичний backtest.",
      "Закритий 30m close і поточний ticker можуть давати різні ціни, рівні та оцінки.",
      "Історичний replay додатково вимагає узгодженого тренду і підтвердженої цілі, тому його набір угод відрізняється.",
      "Не моделює заповнення Limit, комісії, funding, spread чи slippage.",
    ],
  };
}
