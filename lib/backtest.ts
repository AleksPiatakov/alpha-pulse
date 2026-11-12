// Diagnostic single-timeframe Bybit replay. It is NOT a backtest of the 4h/1h/30m live scanner.
// At decision index i only bars with index < i are used. Stops win any same-bar ambiguity.
export type HistoryBar = { time: number; open: number; high: number; low: number; close: number };
export type BacktestTrade = { entryTime: number; exitTime: number; direction: "LONG" | "SHORT"; entry: number; stop: number; target: number; netR: number; result: "TP" | "SL" | "TIMEOUT" };
export type BacktestResult = {
  trades: BacktestTrade[];
  count: number; wins: number; losses: number; expired: number;
  winRate: number | null; averageNetR: number | null;
  assumptions: string[];
};

function ema(values: number[], period: number): number {
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) value += alpha * (values[i] - value);
  return value;
}
function atr(bars: HistoryBar[]): number {
  const ranges = bars.slice(1).map((b, i) => Math.max(b.high - b.low,
    Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)));
  return ranges.slice(-14).reduce((a, b) => a + b, 0) / 14;
}
function lastConfirmedPivot(bars: HistoryBar[], direction: "LONG" | "SHORT"): number | null {
  const levels: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const value = direction === "LONG" ? bars[i].low : bars[i].high;
    const adjacent = [bars[i-2], bars[i-1], bars[i+1], bars[i+2]]
      .map((b) => direction === "LONG" ? b.low : b.high);
    if (adjacent.every((x) => direction === "LONG" ? value < x : value > x)) levels.push(value);
  }
  const market = bars.at(-1)!.close;
  const valid = levels.filter((x) => direction === "LONG" ? x < market : x > market);
  return valid.length ? direction === "LONG" ? Math.max(...valid) : Math.min(...valid) : null;
}

export function replayHourlyLimitStrategy(bars: HistoryBar[], feeRate = 0.00055): BacktestResult {
  const trades: BacktestTrade[] = [];
  const valid = bars.filter((b) => Number.isFinite(b.time) && b.open > 0 && b.low > 0 &&
    b.high >= b.low && b.open >= b.low && b.open <= b.high && b.close >= b.low && b.close <= b.high);
  // 100 closed historical bars are required before the first test. Evaluate only future candles.
  for (let i = 100; i < valid.length - 1;) {
    const history = valid.slice(i - 100, i);
    const closes = history.map((b) => b.close);
    const e20 = ema(closes, 20), e50 = ema(closes, 50), latest = closes.at(-1)!;
    const direction = latest > e20 && e20 > e50 ? "LONG" :
      latest < e20 && e20 < e50 ? "SHORT" : null;
    if (!direction) { i++; continue; }
    const volatility = atr(history);
    const entry = lastConfirmedPivot(history, direction);
    if (entry === null || !(volatility > 0)) { i++; continue; }
    const stop = direction === "LONG" ? entry - 1.5 * volatility : entry + 1.5 * volatility;
    if (!(stop > 0)) { i++; continue; }
    const target = direction === "LONG" ? entry + 3 * volatility : entry - 3 * volatility;
    if (!(target > 0)) { i++; continue; }
    let filledAt = -1;
    let finished = false;
    const until = Math.min(i + 12, valid.length);
    for (let j = i; j < until; j++) {
      const bar = valid[j];
      if (filledAt === -1) {
        if (!(bar.low <= entry && entry <= bar.high)) continue;
        filledAt = j;
      }
      const stopHit = direction === "LONG" ? bar.low <= stop : bar.high >= stop;
      const targetHit = direction === "LONG" ? bar.high >= target : bar.low <= target;
      const result = stopHit ? "SL" : targetHit ? "TP" : j === until - 1 ? "TIMEOUT" : null;
      if (!result) continue;
      const exit = result === "SL" ? stop : result === "TP" ? target : bar.close;
      const gross = direction === "LONG" ? exit - entry : entry - exit;
      const fee = (entry + exit) * feeRate;
      const netR = (gross - fee) / Math.abs(entry - stop);
      trades.push({ entryTime: valid[filledAt].time, exitTime: bar.time, direction, entry, stop, target,
        netR: Number(netR.toFixed(4)), result });
      i = j + 1; // Do not overlap completed trades.
      finished = true;
      break;
    }
    if (!finished) i = until; // No fill within 12 bars: not a trade.
  }
  const count = trades.length, wins = trades.filter((t) => t.netR > 0).length;
  return {
    trades, count, wins, losses: trades.filter((t) => t.netR <= 0).length,
    expired: trades.filter((t) => t.result === "TIMEOUT").length,
    winRate: count ? Number((wins / count * 100).toFixed(1)) : null,
    averageNetR: count ? Number((trades.reduce((a, t) => a + t.netR, 0) / count).toFixed(3)) : null,
    assumptions: [
      "Лише історичні закриті свічки Bybit 1h; це окрема тестова стратегія, не повний алгоритм Alpha Pulse.",
      "EMA20/EMA50, підтверджені swing-рівні, Stop 1.5 ATR, TP 2R, горизонт 12 свічок.",
      "Комісія 0.055% за кожен бік, без проскальзування, funding та зміни спреду.",
      "Якщо Stop і Take Profit торкнуті в одній свічці, рахуємо Stop першочергово.",
      "Історичні результати не прогнозують майбутні та не підтверджують прибутковість сканера.",
    ],
  };
}
