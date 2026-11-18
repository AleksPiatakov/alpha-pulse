/**
 * Read-only, point-in-time 24h Limit entry reachability diagnostic.
 *
 * Uses only completed 30m candles available at analysis time. For each prior
 * closed-bar starting point it checks the next 48 complete bars. Windows
 * overlap; this is NOT a calibrated fill probability and is NOT evidence of
 * expected trade profitability or guaranteed execution.
 */
import type { TechnicalDirection } from "./technical-plan-core.ts";

export const LIMIT_ENTRY_HORIZON_MS = 24 * 60 * 60 * 1000;
export const LIMIT_ENTRY_HORIZON_BARS_30M = 48;
export type LimitEntryReachability = {
  horizonHours: 24;
  status: "HISTORICALLY_REACHABLE" | "OUTSIDE_OBSERVED_RANGE" | "ALREADY_AT_OR_BEYOND" | "INVALID" | "INSUFFICIENT_HISTORY";
  sampleWindows: number;
  historicalTouchRate: number | null;
  distanceAtr: number | null;
  caution: string;
};
export type LimitReachBar = { high: number; low: number; close: number };
export function assessLimitEntry24h(input: {
  direction: TechnicalDirection; currentPrice: number; entryPrice: number;
  atr30m: number; closed30m: readonly LimitReachBar[];
}): LimitEntryReachability {
  const { direction, currentPrice, entryPrice, atr30m, closed30m } = input;
  const base = { horizonHours: 24 as const, sampleWindows: 0, historicalTouchRate: null as number | null,
    distanceAtr: null as number | null };
  if (![currentPrice, entryPrice, atr30m].every(Number.isFinite) ||
    currentPrice <= 0 || entryPrice <= 0 || atr30m <= 0 ||
    !closed30m.every(b => [b.high,b.low,b.close].every(Number.isFinite) &&
      b.low > 0 && b.low <= b.close && b.close <= b.high)) {
    return {...base,status:"INVALID",caution:"Неправильні вхідні дані; досяжність не оцінена."};
  }
  const distance = (direction === "LONG" ? currentPrice-entryPrice : entryPrice-currentPrice) / atr30m;
  if (distance <= 0)
    return {...base,distanceAtr:Number(distance.toFixed(3)),status:"ALREADY_AT_OR_BEYOND",
      caution:"Entry не на стороні відкладеного відкату від поточної ціни. Не оцінювати як новий Limit-вхід."};
  const size = LIMIT_ENTRY_HORIZON_BARS_30M;
  const windows = closed30m.length - size;
  if (windows < 60)
    return {...base,distanceAtr:Number(distance.toFixed(3)),status:"INSUFFICIENT_HISTORY",
      caution:"Менше 60 історичних 24h-вікон; не можна оцінити досяжність."};
  let touched = 0;
  // Compare ATR-normalized excursions with the current proposed distance.
  // Normalize by CURRENT ATR as a deliberately exploratory simplification.
  for (let i=0;i<windows;i++) {
    const origin = closed30m[i].close;
    const subsequent = closed30m.slice(i+1,i+size+1);
    const moved = direction==="LONG"
      ? origin-Math.min(...subsequent.map(b=>b.low))
      : Math.max(...subsequent.map(b=>b.high))-origin;
    if(moved / atr30m >= distance) touched++;
  }
  const rate = touched/windows;
  return {
    horizonHours:24,status:rate>0?"HISTORICALLY_REACHABLE":"OUTSIDE_OBSERVED_RANGE",
    sampleWindows:windows,historicalTouchRate:Number(rate.toFixed(4)),
    distanceAtr:Number(distance.toFixed(3)),
    caution:"Частка торкань на перекривних історичних 24h-вікнах. Це НЕ прогнозована ймовірність виконання Limit; ATR взято поточний, без моделі режимів волатильності, черги та ліквідності.",
  };
}
