/**
 * Shared Bybit candle clock. Kline time is an OPEN timestamp.
 * Both scanner and replay must use a single, explicit observation cutoff.
 */
export const TIMEFRAME_MS = {
  "30": 30 * 60_000, "60": 60 * 60_000,
  "240": 240 * 60_000, D: 24 * 60 * 60_000,
} as const;
export type MarketTimeframe = keyof typeof TIMEFRAME_MS;
export type TimedBar = { time: number };
export function completedBarCutoff(observedAt: number, interval: MarketTimeframe): number | null {
  const size = TIMEFRAME_MS[interval];
  if (!Number.isFinite(observedAt) || observedAt < size) return null;
  return Math.floor(observedAt / size) * size;
}
export function closedBarAt(openTime: number, interval: MarketTimeframe, observedAt: number): boolean {
  const cutoff = completedBarCutoff(observedAt, interval);
  return cutoff !== null && Number.isFinite(openTime) && openTime >= 0 &&
    openTime % TIMEFRAME_MS[interval] === 0 &&
    openTime + TIMEFRAME_MS[interval] <= cutoff;
}
export function selectClosedBars<T extends TimedBar>(
  bars: T[], interval: MarketTimeframe, observedAt: number,
): T[] {
  return bars.filter((bar) => closedBarAt(bar.time, interval, observedAt));
}
export function observationMetadata(observedAt: number) {
  return {
    observedAt,
    last30mClose: completedBarCutoff(observedAt, "30"),
    last1hClose: completedBarCutoff(observedAt, "60"),
    last4hClose: completedBarCutoff(observedAt, "240"),
    lastDailyClose: completedBarCutoff(observedAt, "D"),
  };
}
