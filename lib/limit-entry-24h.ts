/**
 * Read-only, point-in-time 24h Limit entry reachability diagnostic.
 *
 * Uses only completed 30m candles available at analysis time. For each prior
 * closed-bar starting point it checks the next 48 complete bars. Windows
 * overlap; this is NOT a calibrated fill probability and is NOT evidence of
 * expected trade profitability or guaranteed execution.
 */
import { atrBars, type TechnicalDirection } from "./technical-plan-core.ts";

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
  const windowStart = 14; // Need 15 closed bars for an origin-time ATR.
  const windows = closed30m.length - size - windowStart;
  if (windows < 60)
    return {...base,distanceAtr:Number(distance.toFixed(3)),status:"INSUFFICIENT_HISTORY",
      caution:"Менше 60 історичних 24h-вікон; не можна оцінити досяжність."};
  let touched = 0;
  // Each historical window uses ONLY its own previously known ATR, never the
  // current observation ATR: prevents cross-regime look-ahead in normalization.
  for (let i=windowStart;i<windowStart+windows;i++) {
    const origin = closed30m[i].close;
    const historicAtr = atrBars(closed30m.slice(i-14,i+1));
    if (!(historicAtr > 0)) return {...base,distanceAtr:Number(distance.toFixed(3)),
      status:"INVALID",caution:"Не вдалося обчислити історичний ATR."};
    const subsequent = closed30m.slice(i+1,i+size+1);
    const moved = direction==="LONG"
      ? origin-Math.min(...subsequent.map(b=>b.low))
      : Math.max(...subsequent.map(b=>b.high))-origin;
    if(moved / historicAtr >= distance) touched++;
  }
  const rate = touched/windows;
  return {
    horizonHours:24,status:rate>0?"HISTORICALLY_REACHABLE":"OUTSIDE_OBSERVED_RANGE",
    sampleWindows:windows,historicalTouchRate:Number(rate.toFixed(4)),
    distanceAtr:Number(distance.toFixed(3)),
    caution:"Частка торкань на перекривних історичних 24h-вікнах з ATR, відомим на початку кожного вікна. Це НЕ прогнозована ймовірність виконання Limit; без моделі черги, spread, ліквідності та незалежного калібрування.",
  };
}
