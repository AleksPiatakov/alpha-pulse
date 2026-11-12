import { calculatePlanningLevels, assessPlanningLevels } from "./trade-planning-engine.ts";
import { INTRADAY_POLICY_V1 } from "./intraday-quality.ts";
import { emaBars, atrBars, trendBars, nearestSwingLevel, isCompletedBar } from "./technical-plan-core.ts";

export type ReplayBar = {
  time: number; open: number; high: number; low: number; close: number;
  volume: number; turnover: number;
};
export type ReplayDirection = "LONG" | "SHORT";
export type ReplayVariant = "baseline" | "near-entry" | "moderate-trend" | "lower-volume" | "intraday-quality";
export function passesExperimentFilter(
  variant: ReplayVariant,
  features: { distanceAtr: number; trendStrengthAtr: number; relativeVolume: number },
): boolean {
  if (![features.distanceAtr, features.trendStrengthAtr, features.relativeVolume].every(Number.isFinite)) return false;
  switch (variant) {
    case "near-entry": return features.distanceAtr <= 1;
    case "moderate-trend": return features.trendStrengthAtr < 1;
    case "lower-volume": return features.relativeVolume < 1.2;
    case "intraday-quality": return true;
    case "baseline": return true;
  }
}

export const REPLAY_VARIANTS: ReadonlyArray<{ key: ReplayVariant; label: string }> = [
  { key: "baseline", label: "Поточні правила" },
  { key: "near-entry", label: "Вхід не далі 1 ATR" },
  { key: "moderate-trend", label: "Сила тренду 4h < 1 ATR" },
  { key: "lower-volume", label: "Обсяг 1h < 1,2×" },
  { key: "intraday-quality", label: "Внутрішньоденний якісний вхід · дослідний" },
];

export type ReplayTrade = {
  signalTime: number; entryTime: number; exitTime: number;
  direction: ReplayDirection; entry: number; stop: number; target: number;
  netR: number; result: "TP" | "SL" | "TIMEOUT";
  diagnostics?: { score: number; readiness: number; relativeVolume: number; distanceAtr: number; rewardRisk: number; trendStrengthAtr: number; entryDelayBars: number };
};
export type ReplaySummary = {
  mode: "mtf-walk-forward";
  signals: number; unfilled: number; filled: number;
  wins: number; losses: number; timeouts: number;
  winRate: number | null; averageNetR: number | null; totalNetR: number;
  from: number | null; to: number | null; trades: ReplayTrade[];
  maxDrawdownR: number;
  diagnostics: Array<{ label: string; trades: number; wins: number; winRate: number | null;
    totalNetR: number; averageNetR: number | null; maxDrawdownR: number }>;
  periods: Array<{ label: string; from: number; to: number; trades: number; wins: number;
    winRate: number | null; totalNetR: number; averageNetR: number | null; maxDrawdownR: number }>;
  assumptions: string[];
};
export type ReplayTimeframes = {
  "30": ReplayBar[]; "60": ReplayBar[]; "240": ReplayBar[]; D: ReplayBar[];
};

const durations = { "30": 1_800_000, "60": 3_600_000, "240": 14_400_000, D: 86_400_000 } as const;
const feePerSide = 0.00055;
export type ExecutionMode = "reference" | "fees-only" | "slippage-only" | "fill-only" | "conservative";
export const EXECUTION_STRESS_CASES: ReadonlyArray<{ key: ExecutionMode; label: string }> = [
  { key: "reference", label: "Звичайне виконання" },
  { key: "fees-only", label: "Лише підвищена комісія" },
  { key: "slippage-only", label: "Лише прослизання та gap" },
  { key: "fill-only", label: "Лише суворіший Limit-вхід" },
  { key: "conservative", label: "Усі три фактори разом" },
];
export function executionStressFlags(mode: ExecutionMode) {
  return {
    fees: mode === "fees-only" || mode === "conservative",
    slippage: mode === "slippage-only" || mode === "conservative",
    limit: mode === "fill-only" || mode === "conservative",
  };
}
export const CONSERVATIVE_EXECUTION = {
  // Explicit hypothetical stress assumptions, not measured Bybit execution statistics.
  entryPenetrationTicks: 1,
  feePerSide: 0.00075,
  stopSlippageBps: 10,
  timeoutSlippageBps: 5,
} as const;

export function qualifiesLimitFill(
  bar: ReplayBar, direction: ReplayDirection, entry: number, tickSize: number,
): boolean {
  if (!(tickSize > 0 && Number.isFinite(tickSize))) return false;
  // One full tick *past* the limit in the favorable direction must trade.
  // At an opening gap through the limit, no optimistic instant fill is assumed.
  const penetrated = direction === "LONG"
    ? bar.low <= entry - tickSize : bar.high >= entry + tickSize;
  return penetrated && bar.low <= entry && entry <= bar.high;
}
export function stressedExitPrice(
  direction: ReplayDirection, result: "SL" | "TP" | "TIMEOUT",
  nominalExit: number, openPrice: number, slippageBps: number,
): number {
  if (result === "TP") return nominalExit;
  const worseOfStopAndOpen = result === "SL"
    ? (direction === "LONG" ? Math.min(nominalExit, openPrice) : Math.max(nominalExit, openPrice))
    : nominalExit;
  const adverse = direction === "LONG" ? 1 - slippageBps / 10_000 : 1 + slippageBps / 10_000;
  return worseOfStopAndOpen * adverse;
}

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
    if (isCompletedBar(bars[mid].time, duration, decisionTime)) lo = mid + 1;
    else hi = mid;
  }
  return bars.slice(Math.max(0, lo - 200), lo);
}
type Setup = { direction: ReplayDirection; entry: number; stop: number; target: number;
  diagnostics: { score: number; readiness: number; relativeVolume: number; distanceAtr: number;
    rewardRisk: number; trendStrengthAtr: number; entryDelayBars: number } };

function evaluateAt(history: ReplayTimeframes, variant: ReplayVariant, tickSize?: number): Setup | null {
  const h30 = history["30"], h60 = history["60"], h240 = history["240"], daily = history.D;
  if (h30.length < 60 || h60.length < 60 || h240.length < 60 || daily.length < 60) return null;
  const direction30m = trendBars(h30), direction1h = trendBars(h60), direction4h = trendBars(h240);
  if (!direction4h || direction4h !== direction1h || direction1h !== direction30m) return null;
  const direction = direction4h, price = h30.at(-1)!.close;
  const a30 = atrBars(h30), a60 = atrBars(h60);
  if (!(a30 > 0 && a60 > 0)) return null;
  const volumeAverage = h60.slice(-31, -1).reduce((sum, b) => sum + b.volume, 0) / 30;
  if (!(volumeAverage > 0)) return null;
  const relativeVolume = h60.at(-1)!.volume / volumeAverage;
  const previousPrice = h60.at(-25)!.close;
  const change = price / previousPrice - 1;
  const turnover24h = h60.slice(-24).reduce((sum, b) => sum + b.turnover, 0);
  const p30 = nearestSwingLevel(h30, direction, price);
  const p60 = nearestSwingLevel(h60, direction, price);
  const p240 = nearestSwingLevel(h240, direction, price);
  const pd = nearestSwingLevel(daily, direction, price);
  const levels = calculatePlanningLevels({
    direction, currentPrice: price, atr30m: a30, atr1h: a60,
    supportLevels: [p30, p60, p240, pd], dailyBars: daily, tickSize,
  });
  if (!levels || !levels.confirmedTarget || levels.rewardRisk < 0.5) return null;
  const { entry, stop, target } = levels;
  const distanceAtr = levels.distanceAtr, rr = levels.rewardRisk;
  const { scenario: quality, gate } = assessPlanningLevels({
    direction, levels, atr30m: a30, tickSize,
    quality: {
      direction4h, direction1h, direction30m, relativeVolume,
      change24h: change, turnover24h,
      pivot1h: p60 !== null, pivot4h: p240 !== null, pivotDaily: pd !== null,
    },
  });
  const atr4h = atrBars(h240);
  const trendStrengthAtr = atr4h > 0 ? Math.abs(h240.at(-1)!.close - emaBars(h240, 50)) / atr4h : 0;
  if (quality.status !== "ACTIVE") return null;
  if (variant === "intraday-quality" && !gate.accepted) return null;
  if (!passesExperimentFilter(variant, { distanceAtr, trendStrengthAtr, relativeVolume })) return null;
  return {
    direction, entry, stop, target,
    diagnostics: { score: quality.score, readiness: quality.confirmedConditions,
      relativeVolume, distanceAtr, rewardRisk: rr,
      trendStrengthAtr, entryDelayBars: 0 },
  };
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
  variant: ReplayVariant = "baseline",
  tickSize?: number,
  executionMode: ExecutionMode = "reference",
): ReplaySummary {
  const bars = {
    "30": prepare(raw["30"]), "60": prepare(raw["60"]),
    "240": prepare(raw["240"]), D: prepare(raw.D),
  };
  const stress = executionStressFlags(executionMode);
  if (stress.limit && !(tickSize !== undefined && Number.isFinite(tickSize) && tickSize > 0)) {
    throw Error("Для суворішого Limit-входу потрібен біржовий tickSize.");
  }
  const assumptions = [
    "Walk-forward 30m/1h/4h/1D: кожне рішення використовує лише повністю закриті свічки.",
    "Правила EMA20/50, підтверджених swing-рівнів, ATR і перевірок готовності; історичний 24h оборот — сума годинних turnover Bybit.",
    tickSize === undefined ? "Entry/SL/TP округлюються за десятковою схемою сканера (без біржового tickSize)." : `Entry/SL/TP округлюються за біржовим tickSize=${tickSize}; це окремий експериментальний режим, сканер поки округлює інакше.`,
    "Limit діє до 6 годин, після входу позиція утримується максимум 48 годин; одночасно одна позиція.",
    "Базова комісія 0.055% за вхід і вихід; стрес-сценарії перевизначають витрати тільки для вибраних факторів.",
    "Якщо стоп і ціль торкнуті в одній свічці, пріоритет має Stop Loss. Заповнення Limit за OHLC моделюється, не гарантоване.",
    "Просідання виражене сумою R при постійному ризику на угоду; це не просідання рахунку у відсотках.",
    "Групи діагностики класифікують тільки виконані угоди за ознаками, відомими на момент сигналу, та не є новими торговими правилами.",
    "Дані обмежені доступною історією Bybit; тест не прогнозує результат майбутньої торгівлі.",
    ...(variant === "intraday-quality" ? [
      "Дослідний якісний intraday-фільтр: лише підтверджені входи зі score>=90, R:R>=2, відстанню <=0.75 ATR і стопом 0.8–3 ATR.",
      "Заявка чинна максимум 3 години; позиція в моделі утримується максимум 24 години, не примусово закривається в календарну північ.",
      "Пороги встановлені як гіпотези після перегляду старої історії, не є незалежно валідованими.",
    ] : []),
    ...(stress.limit ? ["Limit: лише після проходження ціною рівня на 1 tick; OHLC не гарантує реального виконання."] : []),
    ...(stress.fees ? ["Комісія 0.075% на сторону замість 0.055%; гіпотетичний стрес-тест."] : []),
    ...(stress.slippage ? [
      "Stop Loss: несприятливий gap плюс 10 bps; TIMEOUT: 5 bps; TP без додаткового проскальзування.",
      "Порядок руху всередині свічки невідомий, стрес-модель не відтворює біржову чергу.",
    ] : []),
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
    const setup = evaluateAt(h, variant, tickSize);
    if (!setup) { i++; continue; }
    signals++;
    const { direction, entry, stop, target } = setup;
    let entryIndex = -1;
    const fillEnd = Math.min(i + 1 + (variant === "intraday-quality"
      ? INTRADAY_POLICY_V1.maxPendingBars30m : maxPendingBars), decisionBars.length);
    for (let j = i + 1; j < fillEnd; j++) {
      const fills = stress.limit
        ? qualifiesLimitFill(decisionBars[j], direction, entry, tickSize!)
        : decisionBars[j].low <= entry && entry <= decisionBars[j].high;
      if (fills) {
        entryIndex = j; break;
      }
    }
    if (entryIndex < 0) { unfilled++; i = fillEnd; continue; }
    const exitEnd = Math.min(entryIndex + (variant === "intraday-quality"
      ? INTRADAY_POLICY_V1.maxHoldingBars30m : maxHoldBars), decisionBars.length);
    for (let j = entryIndex; j < exitEnd; j++) {
      const candle = decisionBars[j];
      const stopHit = direction === "LONG" ? candle.low <= stop : candle.high >= stop;
      const targetHit = direction === "LONG" ? candle.high >= target : candle.low <= target;
      const result = stopHit ? "SL" : targetHit ? "TP" :
        j === exitEnd - 1 ? "TIMEOUT" : null;
      if (!result) continue;
      const exit = result === "SL" ? stop : result === "TP" ? target : candle.close;
      const executedExit = stress.slippage
        ? stressedExitPrice(direction, result, exit, j === entryIndex ? exit : candle.open,
          result === "SL" ? CONSERVATIVE_EXECUTION.stopSlippageBps : CONSERVATIVE_EXECUTION.timeoutSlippageBps)
        : exit;
      const chargedFee = stress.fees ? CONSERVATIVE_EXECUTION.feePerSide : feeRate;
      const net = (direction === "LONG" ? executedExit - entry : entry - executedExit) -
        (entry + executedExit) * chargedFee;
      trades.push({ signalTime: time, entryTime: decisionBars[entryIndex].time,
        exitTime: candle.time, direction, entry, stop, target,
        netR: Number((net / Math.abs(entry - stop)).toFixed(4)), result,
        diagnostics: { ...setup.diagnostics, entryDelayBars: entryIndex - i - 1 } });
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
  const cohorts = [
    { label: "LONG", matches: (t: ReplayTrade) => t.direction === "LONG" },
    { label: "SHORT", matches: (t: ReplayTrade) => t.direction === "SHORT" },
    { label: "Вхід ≤ 1 ATR", matches: (t: ReplayTrade) => (t.diagnostics?.distanceAtr ?? Infinity) <= 1 },
    { label: "Вхід > 1 ATR", matches: (t: ReplayTrade) => (t.diagnostics?.distanceAtr ?? -Infinity) > 1 },
    { label: "Обсяг ≥ 1.2×", matches: (t: ReplayTrade) => (t.diagnostics?.relativeVolume ?? -Infinity) >= 1.2 },
    { label: "Обсяг < 1.2×", matches: (t: ReplayTrade) => (t.diagnostics?.relativeVolume ?? Infinity) < 1.2 },
    { label: "Сильний 4h тренд ≥ 1 ATR", matches: (t: ReplayTrade) => (t.diagnostics?.trendStrengthAtr ?? -Infinity) >= 1 },
    { label: "Слабший 4h тренд < 1 ATR", matches: (t: ReplayTrade) => (t.diagnostics?.trendStrengthAtr ?? Infinity) < 1 },
  ];
  const diagnostics = cohorts.map(({ label, matches }) => ({ label, ...summarizeTrades(trades.filter(matches)) }));
  return { mode: "mtf-walk-forward", signals, unfilled, filled: count, wins,
    losses: count - wins, timeouts: trades.filter((t) => t.result === "TIMEOUT").length,
    winRate: count ? Number((wins / count * 100).toFixed(1)) : null,
    averageNetR: count ? Number((trades.reduce((v, t) => v + t.netR, 0) / count).toFixed(3)) : null,
    totalNetR: Number(trades.reduce((v, t) => v + t.netR, 0).toFixed(3)),
    from: start, to: finish, maxDrawdownR: summary.maxDrawdownR, periods, diagnostics,
    trades, assumptions };
}
