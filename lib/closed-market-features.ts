/**
 * Historical, close-of-candle quality features.
 * The same closed 1h candles feed live research ranking and replay.
 * Current ticker price remains a separate execution/proximity input.
 */
export type HourlyFeatureBar = { close: number; volume: number; turnover: number };
export type ClosedMarketFeatures = {
  change24h: number;
  turnover24h: number;
  relativeVolume1h: number;
  source: "closed-1h-candles";
};
export function closedMarketFeatures(hourly: HourlyFeatureBar[]): ClosedMarketFeatures | null {
  if (hourly.length < 31) return null;
  const history = hourly.slice(-31);
  if (!history.every((bar) => [bar.close, bar.volume, bar.turnover].every(Number.isFinite) &&
    bar.close > 0 && bar.volume >= 0 && bar.turnover >= 0)) return null;
  const last = history.at(-1)!;
  const previousDay = history.at(-25)!;
  const volumeAverage = history.slice(-31, -1).reduce((sum, bar) => sum + bar.volume, 0) / 30;
  if (!(previousDay.close > 0 && volumeAverage > 0)) return null;
  const change24h = last.close / previousDay.close - 1;
  const turnover24h = history.slice(-24).reduce((sum, bar) => sum + bar.turnover, 0);
  const relativeVolume1h = last.volume / volumeAverage;
  if (![change24h, turnover24h, relativeVolume1h].every(Number.isFinite)) return null;
  return {change24h, turnover24h, relativeVolume1h, source: "closed-1h-candles"};
}
