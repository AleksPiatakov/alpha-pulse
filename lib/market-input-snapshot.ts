/**
 * Immutable, deterministic research input package for one Bybit Demo linear instrument.
 * Ticker and candles retain their different semantics; snapshot captures BOTH.
 * No orders, secrets, private account data or background writes.
 */
import { createHash } from "node:crypto";
import { closedBarAt, type MarketTimeframe } from "./market-observation-clock.ts";
import type { InstrumentMeta } from "./bybit-universe.ts";

export type SnapshotCandle = [string, string, string, string, string, string, string];
export type SnapshotTicker = { symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string };
export type SnapshotTimeframes = Record<MarketTimeframe, SnapshotCandle[]>;
export type MarketInputSnapshot = {
  schema: "alpha-pulse-market-input-v1";
  source: "bybit-demo";
  observedAt: number;
  symbol: string;
  ticker: SnapshotTicker;
  instrument: InstrumentMeta;
  candles: SnapshotTimeframes;
};
export type SealedMarketInputSnapshot = { snapshot: MarketInputSnapshot; sha256: string };

export function validateMarketInputSnapshot(value: MarketInputSnapshot): string[] {
  const errors: string[] = [];
  if (value.schema !== "alpha-pulse-market-input-v1" || value.source !== "bybit-demo")
    errors.push("Невідома версія або джерело даних.");
  if (!/^[A-Z0-9]{3,24}USDT$/.test(value.symbol) ||
      value.ticker.symbol !== value.symbol || value.instrument.symbol !== value.symbol)
    errors.push("Символ тикера й контракту не збігається.");
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt <= 0 ||
      !Number.isFinite(Number(value.ticker.lastPrice)) || Number(value.ticker.lastPrice) <= 0)
    errors.push("Некоректний час або поточна ціна.");
  if (value.instrument.status !== "Trading" || value.instrument.quoteCoin !== "USDT" ||
      value.instrument.settleCoin !== "USDT" ||
      !(Number(value.instrument.priceFilter?.tickSize) > 0))
    errors.push("Не підтверджено торговий статус або tickSize.");
  for (const interval of ["30", "60", "240", "D"] as const) {
    const candles = value.candles?.[interval];
    if (!Array.isArray(candles) || candles.length < 60) {
      errors.push(`${interval}: недостатньо закритих свічок.`); continue;
    }
    let previous = -1;
    for (const candle of candles) {
      if (!Array.isArray(candle) || candle.length < 7) {
        errors.push(`${interval}: невалідна свічка.`); break;
      }
      const t = Number(candle[0]);
      const [open, high, low, close, volume, turnover] = candle.slice(1, 7).map(Number);
      if (!closedBarAt(t, interval, value.observedAt) || t <= previous ||
          ![open, high, low, close, volume, turnover].every(Number.isFinite) ||
          open <= 0 || low <= 0 || high < low || open < low || open > high ||
          close < low || close > high || volume < 0 || turnover < 0) {
        errors.push(`${interval}: непослідовна або незакрита свічка.`); break;
      }
      previous = t;
    }
  }
  return errors;
}
export function sealMarketInputSnapshot(snapshot: MarketInputSnapshot): SealedMarketInputSnapshot {
  const errors = validateMarketInputSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(" "));
  // Canonical property order follows our constructed typed record; JSON payload must be
  // preserved byte-for-byte for verification (no rounding or post-seal modifications).
  const sha256 = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { snapshot, sha256 };
}
export function verifyMarketInputSnapshot(sealed: SealedMarketInputSnapshot): boolean {
  try {
    return sealMarketInputSnapshot(sealed.snapshot).sha256 === sealed.sha256;
  } catch { return false; }
}
