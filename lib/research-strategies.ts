/**
 * Research-only strategy candidate contract. No order execution, no confidence
 * percentages, no mutation of incoming market observations.
 */
import { atrBars, emaBars, roundedPlanLevels, trendBars, type PriceBar, type TechnicalDirection } from "./technical-plan-core.ts";
import { verifyMarketInputSnapshot, type SealedMarketInputSnapshot } from "./market-input-snapshot.ts";
import { parseExecutionRules } from "./bybit-execution-rules.ts";

export type StrategyKey = "trend-pullback-v1" | "breakout-retest-v1";
export type StrategyCandidate = {
  strategy: StrategyKey;
  symbol: string;
  direction: TechnicalDirection;
  signalAt: number;
  entry: number; stop: number; target: number; rewardRisk: number;
  evidence: string[];
  experimental: true;
  executable: false;
};
export type StrategyContext = {
  symbol: string; signalAt: number; tickSize: number;
  m30: PriceBar[]; h1: PriceBar[]; h4: PriceBar[];
};
export type StrategyDetector = {
  key: StrategyKey;
  evaluate(context: StrategyContext): StrategyCandidate | null;
};
function assemble(context: StrategyContext, strategy: StrategyKey,
  direction: TechnicalDirection, entry: number, stop: number,
  target: number, evidence: string[]): StrategyCandidate | null {
  const levels = roundedPlanLevels(direction, entry, stop, target, context.tickSize);
  if (!levels || levels.rr < 1.5) return null;
  return {
    strategy, symbol: context.symbol, direction, signalAt: context.signalAt,
    entry: levels.entry, stop: levels.stop, target: levels.target,
    rewardRisk: Number(levels.rr.toFixed(3)), evidence,
    experimental: true, executable: false,
  };
}
function trendDirection(ctx: StrategyContext): TechnicalDirection | null {
  const hour = trendBars(ctx.h1), four = trendBars(ctx.h4);
  return hour !== null && hour === four ? hour : null;
}
export const trendPullback: StrategyDetector = {
  key: "trend-pullback-v1",
  evaluate(ctx) {
    if (ctx.m30.length < 60 || ctx.h1.length < 60 || ctx.h4.length < 60) return null;
    const direction = trendDirection(ctx);
    if (!direction) return null;
    const last = ctx.m30.at(-1)!, previous = ctx.m30.at(-2)!;
    const ema20 = emaBars(ctx.m30, 20), atr = atrBars(ctx.m30);
    if (!(atr > 0 && ema20 > 0)) return null;
    // Confirmed pullback only: previous bar at/toward EMA, last closed back
    // in the trend direction. No forming-bar or future-bar confirmation.
    const touched = direction === "LONG"
      ? previous.low <= ema20 && previous.close <= ema20 + 0.5 * atr
      : previous.high >= ema20 && previous.close >= ema20 - 0.5 * atr;
    const resumed = direction === "LONG"
      ? last.close > ema20 && last.close > previous.close && last.low > previous.low
      : last.close < ema20 && last.close < previous.close && last.high < previous.high;
    if (!touched || !resumed) return null;
    const entry = last.close;
    const stop = direction === "LONG"
      ? Math.min(last.low, previous.low) - 0.25 * atr
      : Math.max(last.high, previous.high) + 0.25 * atr;
    const risk = Math.abs(entry - stop);
    if (!(risk >= 0.8 * atr && risk <= 3 * atr)) return null;
    const target = entry + (direction === "LONG" ? 2 : -2) * risk;
    return assemble(ctx, this.key, direction, entry, stop, target,
      ["1h і 4h тренди узгоджені", "Попередня закрита 30m свічка тестувала EMA20",
        "Остання закрита 30m свічка підтвердила відновлення тренду",
        "ATR визначає буфер стопа; ціль 2R є гіпотезою, не структурно підтвердженим TP"]);
  },
};
export const breakoutRetest: StrategyDetector = {
  key: "breakout-retest-v1",
  evaluate(ctx) {
    if (ctx.m30.length < 65 || ctx.h1.length < 60 || ctx.h4.length < 60) return null;
    const direction = trendDirection(ctx);
    if (!direction) return null;
    const last = ctx.m30.at(-1)!, retest = ctx.m30.at(-2)!, breakout = ctx.m30.at(-3)!;
    const earlier = ctx.m30.slice(-23, -3);
    if (earlier.length !== 20) return null;
    const atr = atrBars(ctx.m30);
    if (!(atr > 0)) return null;
    const level = direction === "LONG"
      ? Math.max(...earlier.map(b => b.high)) : Math.min(...earlier.map(b => b.low));
    const breached = direction === "LONG"
      ? breakout.close > level + 0.1 * atr : breakout.close < level - 0.1 * atr;
    const retested = direction === "LONG"
      ? retest.low <= level + 0.25 * atr && retest.close >= level
      : retest.high >= level - 0.25 * atr && retest.close <= level;
    const confirmed = direction === "LONG"
      ? last.close > level && last.close > retest.close
      : last.close < level && last.close < retest.close;
    if (!breached || !retested || !confirmed) return null;
    const entry = last.close;
    const stop = direction === "LONG"
      ? Math.min(retest.low, last.low) - 0.25 * atr
      : Math.max(retest.high, last.high) + 0.25 * atr;
    const risk = Math.abs(entry - stop);
    if (!(risk >= 0.8 * atr && risk <= 3 * atr)) return null;
    const target = entry + (direction === "LONG" ? 2 : -2) * risk;
    return assemble(ctx, this.key, direction, entry, stop, target,
      ["1h і 4h тренди узгоджені", "Пробій рівня попередніх 20 закритих 30m свічок",
        "Наступна закрита 30m свічка тестувала рівень", "Остання закрита 30m свічка підтвердила напрям",
        "Ціль 2R є дослідною, не перевіреною на історичній вибірці"]);
  },
};
export const RESEARCH_STRATEGIES: readonly StrategyDetector[] = [trendPullback, breakoutRetest];
export function evaluateResearchStrategies(sealed: SealedMarketInputSnapshot): StrategyCandidate[] {
  if (!verifyMarketInputSnapshot(sealed)) throw new Error("Невалідний або змінений ринковий знімок.");
  const s = sealed.snapshot;
  const rules = parseExecutionRules(s.instrument);
  if (!rules) return [];
  const parse = (interval: "30" | "60" | "240") => s.candles[interval].map(c => ({
    high: Number(c[2]), low: Number(c[3]), close: Number(c[4]),
  }));
  const ctx: StrategyContext = {symbol: s.symbol, signalAt: s.observedAt,
    tickSize: rules.tickSize, m30: parse("30"), h1: parse("60"), h4: parse("240")};
  return RESEARCH_STRATEGIES.flatMap(strategy => {
    const candidate = strategy.evaluate(ctx);
    return candidate ? [candidate] : [];
  });
}
