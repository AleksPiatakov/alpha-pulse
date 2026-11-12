import { evaluateScenarioQuality } from "./scenario-quality.ts";

export type ReplayBar = {
  time: number; open: number; high: number; low: number; close: number;
  volume: number; turnover: number;
};
export type ReplayDirection = "LONG" | "SHORT";
export type ReplayTrade = {
  signalTime: number; entryTime: number; exitTime: number;
  direction: ReplayDirection; entry: number; stop: number; target: number;
  netR: number; result: "TP" | "SL" | "TIMEOUT";
};
export type ReplaySummary = {
  mode: "mtf-walk-forward";
  signals: number; unfilled: number; filled: number;
  wins: number; losses: number; timeouts: number;
  winRate: number | null; averageNetR: number | null; totalNetR: number;
  from: number | null; to: number | null; trades: ReplayTrade[];
  maxDrawdownR: number;
  periods: Array<{ label: string; from: number; to: number; trades: number; wins: number;
    winRate: number | null; totalNetR: number; averageNetR: number | null; maxDrawdownR: number }>;
  assumptions: string[];
};
export type ReplayTimeframes = {
  "30": ReplayBar[]; "60": ReplayBar[]; "240": ReplayBar[]; D: ReplayBar[];
};

const durations = { "30": 1_800_000, "60": 3_600_000, "240": 14_400_000, D: 86_400_000 } as const;
const feePerSide = 0.00055;
const maxPendingBars = 12; // 6h for a 30m limit order
const maxHoldBars = 96; // 48h once filled
const minHistory = { "30": 60, "60": 60, "240": 60, D: 60 } as const;

function validBar(b: ReplayBar): boolean {
  return Number.isFinite(b.time) && b.time >= 0 &&
    Number.isFinite(b.open) && b.open > 0 && Number.isFinite(b.high) &&
    Number.isFinite(b.low) && b.low > 0 && b.high >= b.low &&
    Number.isFinite(b.close) && b.close >= b.low && b.close <= b.high &&
    b.open >= b.low && b.open <= b.high &&
    Number.isFinite(b.volume) && b.volume >= 0 &&
    Number.isFinite(b.turnover) && b.turnover >= 0;
}
function prepare(bars: ReplayBar[]): ReplayBar[] {
  const filtered = bars.filter(validBar).sort((a, b) => a.time - b.time);
  return filtered.filter((b, i) => i === 0 || b.time !== filtered[i - 1].time);
}
function historyAt(bars: ReplayBar[], decisionTime: number, duration: number): ReplayBar[] {
  // Bars with close timestamp <= decision time only. No forming candle or future pivot.
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bars[mid].time + duration <= decisionTime) lo = mid + 1;
    else hi = mid;
  }
  return bars.slice(Math.max(0, lo - 200), lo);
}
function ema(bars: ReplayBar[], period: number): number {
  const closes = bars.map((b) => b.close);
  let value = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  for (const close of closes.slice(period)) value += alpha * (close - value);
  return value;
}
function trend(bars: ReplayBar[]): ReplayDirection | null {
  const fast = ema(bars, 20), slow = ema(bars, 50), price = bars.at(-1)!.close;
  return price > fast && fast > slow ? "LONG" : price < fast && fast < slow ? "SHORT" : null;
}
function atr(bars: ReplayBar[]): number {
  const last = bars.slice(-15);
  const trueRanges = last.slice(1).map((b, i) =>
    Math.max(b.high - b.low, Math.abs(b.high - last[i].close), Math.abs(b.low - last[i].close)));
  return trueRanges.reduce((a, b) => a + b, 0) / 14;
}
function swingLevels(bars: ReplayBar[], direction: ReplayDirection, price: number): number[] {
  const levels: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const level = direction === "LONG" ? bars[i].low : bars[i].high;
    const neighbors = [bars[i-2], bars[i-1], bars[i+1], bars[i+2]]
      .map((b) => direction === "LONG" ? b.low : b.high);
    if (neighbors.every((n) => direction === "LONG" ? level < n : level > n) &&
      (direction === "LONG" ? level < price : level > price)) levels.push(level);
  }
  return levels;
}
function nearest(levels: number[], direction: ReplayDirection): number | null {
  return levels.length ? direction === "LONG" ? Math.max(...levels) : Math.min(...levels) : null;
}
function targetFromDaily(bars: ReplayBar[], direction: ReplayDirection, entry: number, stop: number): number | null {
  const candidates: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const middle = direction === "LONG" ? bars[i].high : bars[i].low;
    const neighbors = [bars[i-2], bars[i-1], bars[i+1], bars[i+2]]
      .map((b) => direction === "LONG" ? b.high : b.low);
    if (neighbors.every((n) => direction === "LONG" ? middle > n : middle < n) &&
      (direction === "LONG" ? middle > entry : middle < entry)) candidates.push(middle);
  }
  if (!candidates.length) return null;
  const risk = Math.abs(entry - stop);
  const ideal = entry + (direction === "LONG" ? 2.4 : -2.4) * risk;
  const obstacle = direction === "LONG" ? Math.min(...candidates) - 0.05 * risk :
    Math.max(...candidates) + 0.05 * risk;
  return direction === "LONG" ? Math.min(ideal, obstacle) : Math.max(ideal, obstacle);
}
type Setup = { direction: ReplayDirection; entry: number; stop: number; target: number };

function evaluateAt(history: ReplayTimeframes): Setup | null {
  const h30 = history["30"], h60 = history["60"], h240 = history["240"], daily = history.D;
  if (h30.length < 60 || h60.length < 60 || h240.length < 60 || daily.length < 60) return null;
  const direction30m = trend(h30), direction1h = trend(h60), direction4h = trend(h240);
  if (!direction4h || direction4h !== direction1h || direction1h !== direction30m) return null;
  const direction = direction4h, price = h30.at(-1)!.close;
  const a30 = atr(h30), a60 = atr(h60);
  if (!(a30 > 0 && a60 > 0)) return null;
  const volumeAverage = h60.slice(-31, -1).reduce((sum, b) => sum + b.volume, 0) / 30;
  if (!(volumeAverage > 0)) return null;
  const relativeVolume = h60.at(-1)!.volume / volumeAverage;
  const previousPrice = h60.at(-25)!.close;
  const change = price / previousPrice - 1;
  const turnover24h = h60.slice(-24).reduce((sum, b) => sum + b.turnover, 0);
  const p30 = nearest(swingLevels(h30, direction, price), direction);
  const p60 = nearest(swingLevels(h60, direction, price), direction);
  const p240 = nearest(swingLevels(h240, direction, price), direction);
  const pd = nearest(swingLevels(daily, direction, price), direction);
  const pivots = [p30, p60, p240, pd].filter((x): x is number => x !== null);
  if (!pivots.length) return null;
  const entry = nearest(pivots, direction);
  if (entry === null) return null;
  const distanceAtr = Math.abs(price - entry) / a30;
  const risk = Math.max(a60 * 1.25, a30 * 2);
  const stop = entry + (direction === "LONG" ? -risk : risk);
  if (!(entry > 0 && stop > 0)) return null;
  const target = targetFromDaily(daily, direction, entry, stop);
  if (target === null || target <= 0) return null;
  const reward = direction === "LONG" ? target - entry : entry - target;
  if (!(reward > 0)) return null;
  const quality = evaluateScenarioQuality({
    direction4h, direction1h, direction30m, relativeVolume, change24h: change,
    turnover24h, rewardRisk: reward / Math.abs(stop - entry), distanceAtr,
    pivot1h: p60 !== null, pivot4h: p240 !== null, pivotDaily: pd !== null,
    hasTargetLevel: true,
  });
  return quality.status === "ACTIVE" ? { direction, entry, stop, target } : null;
}

export function summarizeTrades(trades: ReplayTrade[]) {
  let cumulative = 0, peak = 0, maxDrawdown = 0;
  for (const trade of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    cumulative += trade.netR;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  const wins = trades.filter((trade) => trade.netR > 0).length;
  const totalNetR = trades.reduce((sum, trade) => sum + trade.netR, 0);
  return {
    trades: trades.length, wins,
    winRate: trades.length ? Number((wins / trades.length * 100).toFixed(1)) : null,
    totalNetR: Number(totalNetR.toFixed(3)),
    averageNetR: trades.length ? Number((totalNetR / trades.length).toFixed(3)) : null,
    maxDrawdownR: Number(maxDrawdown.toFixed(3)),
  };
}

export function replayMultiTimeframeStrategy(
  raw: ReplayTimeframes,
  feeRate = feePerSide,
): ReplaySummary {
  const bars = {
    "30": prepare(raw["30"]), "60": prepare(raw["60"]),
    "240": prepare(raw["240"]), D: prepare(raw.D),
  };
  const assumptions = [
    "Walk-forward 30m/1h/4h/1D: кожне рішення використовує лише повністю закриті свічки.",
    "Правила EMA20/50, підтверджених swing-рівнів, ATR і перевірок готовності; історичний 24h оборот — сума годинних turnover Bybit.",
    "Limit діє до 6 годин, після входу позиція утримується максимум 48 годин; одночасно одна позиція.",
    "Комісія 0.055% за вхід і вихід; без funding, проскальзування і біржової черги виконання.",
    "Якщо стоп і ціль торкнуті в одній свічці, пріоритет має Stop Loss. Заповнення Limit за OHLC моделюється, не гарантоване.",
    "Просідання виражене сумою R при постійному ризику на угоду; це не просідання рахунку у відсотках.",
    "Дані обмежені доступною історією Bybit; тест не прогнозує результат майбутньої торгівлі.",
  ];
  const trades: ReplayTrade[] = [];
  let signals = 0, unfilled = 0;
  let i = 0;
  const decisionBars = bars["30"];
  while (i < decisionBars.length - 1) {
    const bar = decisionBars[i];
    const time = bar.time + durations["30"];
    const h = {
      "30": historyAt(bars["30"], time, durations["30"]),
      "60": historyAt(bars["60"], time, durations["60"]),
      "240": historyAt(bars["240"], time, durations["240"]),
      D: historyAt(bars.D, time, durations.D),
    };
    if (Object.entries(minHistory).some(([key, length]) =>
      h[key as keyof ReplayTimeframes].length < length)) { i++; continue; }
    const setup = evaluateAt(h);
    if (!setup) { i++; continue; }
    signals++;
    const { direction, entry, stop, target } = setup;
    let entryIndex = -1;
    const fillEnd = Math.min(i + 1 + maxPendingBars, decisionBars.length);
    for (let j = i + 1; j < fillEnd; j++) {
      if (decisionBars[j].low <= entry && entry <= decisionBars[j].high) {
        entryIndex = j; break;
      }
    }
    if (entryIndex < 0) { unfilled++; i = fillEnd; continue; }
    const exitEnd = Math.min(entryIndex + maxHoldBars, decisionBars.length);
    for (let j = entryIndex; j < exitEnd; j++) {
      const candle = decisionBars[j];
      const stopHit = direction === "LONG" ? candle.low <= stop : candle.high >= stop;
      const targetHit = direction === "LONG" ? candle.high >= target : candle.low <= target;
      const result = stopHit ? "SL" : targetHit ? "TP" :
        j === exitEnd - 1 ? "TIMEOUT" : null;
      if (!result) continue;
      const exit = result === "SL" ? stop : result === "TP" ? target : candle.close;
      const net = (direction === "LONG" ? exit - entry : entry - exit) -
        (entry + exit) * feeRate;
      trades.push({ signalTime: time, entryTime: decisionBars[entryIndex].time,
        exitTime: candle.time, direction, entry, stop, target,
        netR: Number((net / Math.abs(entry - stop)).toFixed(4)), result });
      i = j + 1;
      break;
    }
    if (i <= entryIndex) i = exitEnd;
  }
  const wins = trades.filter((t) => t.netR > 0).length;
  const count = trades.length;
  const summary = summarizeTrades(trades);
  const start = decisionBars[0]?.time ?? null;
  const finish = decisionBars.at(-1)?.time ?? null;
  const midpoint = start !== null && finish !== null ? start + (finish - start) / 2 : null;
  const periods = midpoint === null || start === null || finish === null ? [] : [
    { label: "Перша половина", from: start, to: midpoint,
      ...summarizeTrades(trades.filter((trade) => trade.signalTime < midpoint)) },
    { label: "Друга половина", from: midpoint, to: finish,
      ...summarizeTrades(trades.filter((trade) => trade.signalTime >= midpoint)) },
  ];
  return { mode: "mtf-walk-forward", signals, unfilled, filled: count, wins,
    losses: count - wins, timeouts: trades.filter((t) => t.result === "TIMEOUT").length,
    winRate: count ? Number((wins / count * 100).toFixed(1)) : null,
    averageNetR: count ? Number((trades.reduce((v, t) => v + t.netR, 0) / count).toFixed(3)) : null,
    totalNetR: Number(trades.reduce((v, t) => v + t.netR, 0).toFixed(3)),
    from: start, to: finish, maxDrawdownR: summary.maxDrawdownR, periods,
    trades, assumptions };
}
