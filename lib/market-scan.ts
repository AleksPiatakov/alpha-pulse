import { DEMO_BYBIT_URL, roundPrice, type PlanDirection, type TradePlan } from "@/lib/trading";

type Ticker = { symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string };
type Candle = [string, string, string, string, string, string];
type Interval = "30" | "60" | "240" | "D";

function ema(values: number[], period: number) {
  if (values.length < period) return NaN;
  const alpha = 2 / (period + 1);
  let average = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (const price of values.slice(period)) average += alpha * (price - average);
  return average;
}
const directionLabel = (direction: PlanDirection) => direction === "LONG" ? "вище" : "нижче";

function atr(candles: Candle[]) {
  const recent = candles.slice(-15);
  if (recent.length !== 15) return NaN;
  const ranges = recent.slice(1).map((bar, i) => {
    const high = Number(bar[2]), low = Number(bar[3]), previous = Number(recent[i][4]);
    return Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous));
  });
  return ranges.reduce((sum, n) => sum + n, 0) / ranges.length;
}

function trend(candles: Candle[], marketPrice: number): PlanDirection | null {
  const closes = candles.map((candle) => Number(candle[4]));
  const fast = ema(closes, 20), slow = ema(closes, 50);
  if (marketPrice > fast && fast > slow) return "LONG";
  if (marketPrice < fast && fast < slow) return "SHORT";
  return null;
}

function structuralTarget(direction: PlanDirection, entry: number, stopLoss: number, daily: Candle[]) {
  const distance = Math.abs(entry - stopLoss);
  const ideal = direction === "LONG" ? entry + 2.4 * distance : entry - 2.4 * distance;
  const candidates: number[] = [];
  // A daily swing pivot requires two completed candles to the left and right.
  for (let i = 2; i < daily.length - 2; i++) {
    const middle = Number(daily[i][direction === "LONG" ? 2 : 3]);
    const others = [i - 2, i - 1, i + 1, i + 2].map((j) => Number(daily[j][direction === "LONG" ? 2 : 3]));
    const confirmed = direction === "LONG" ? others.every((value) => middle > value) : others.every((value) => middle < value);
    if (confirmed && (direction === "LONG" ? middle > entry : middle < entry)) candidates.push(middle);
  }
  // No confirmed obstacle: do not claim that the whole route is clear.
  if (!candidates.length) return null;
  const nearest = direction === "LONG" ? Math.min(...candidates) : Math.max(...candidates);
  const buffered = nearest + (direction === "LONG" ? -0.05 : 0.05) * distance;
  return direction === "LONG" ? Math.min(ideal, buffered) : Math.max(ideal, buffered);
}

function nearestConfirmedLevel(candles: Candle[], direction: PlanDirection, marketPrice: number): number | null {
  const levels: number[] = [];
  // A local swing on completed candles is a candidate support/resistance, not a guaranteed turning point.
  const side = direction === "LONG" ? 3 : 2;
  for (let i = 2; i < candles.length - 2; i++) {
    const level = Number(candles[i][side]);
    const nearby = [i - 2, i - 1, i + 1, i + 2].map((j) => Number(candles[j][side]));
    if (nearby.every((n) => direction === "LONG" ? level < n : level > n) &&
        (direction === "LONG" ? level < marketPrice : level > marketPrice)) levels.push(level);
  }
  return levels.length ? (direction === "LONG" ? Math.max(...levels) : Math.min(...levels)) : null;
}

async function candlesFor(symbol: string, interval: Interval) {
  const limit = 200;
  const response = await fetch(`${DEMO_BYBIT_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`, { cache: "no-store" });
  const data = await response.json() as { retCode: number; result?: { list?: Candle[] } };
  if (data.retCode !== 0 || !data.result?.list) return null;
  const intervalMs = interval === "D" ? 86_400_000 : Number(interval) * 60_000;
  const closed = [...data.result.list].reverse().filter((c) =>
    Number(c[0]) + intervalMs <= Date.now() &&
    [c[2], c[3], c[4], c[5]].every((n) => Number.isFinite(Number(n))));
  return closed.length >= 60 ? closed : null;
}

export type FilterReason = "candles" | "trend" | "volume" | "momentum" | "distance" | "prices" | "daily_level" | "reward_risk" | "error";
async function makePlan(ticker: Ticker, reject: (reason: FilterReason) => null): Promise<TradePlan | null> {
  const [candles30, candles1h, candles4h, dailyCandles] = await Promise.all([candlesFor(ticker.symbol, "30"), candlesFor(ticker.symbol, "60"), candlesFor(ticker.symbol, "240"), candlesFor(ticker.symbol, "D")]);
  if (!candles30 || !candles1h || !candles4h || !dailyCandles) return reject("candles");
  const price = Number(ticker.lastPrice), change = Number(ticker.price24hPcnt);
  const direction4h = trend(candles4h, price), direction1h = trend(candles1h, price), direction30m = trend(candles30, price);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) return reject("prices");
  const aligned = !!direction4h && direction4h === direction1h && direction1h === direction30m;
  const direction: PlanDirection = direction4h ?? direction1h ?? direction30m ?? (change >= 0 ? "LONG" : "SHORT");
  const volatility1h = atr(candles1h), volatility30m = atr(candles30);
  const averageVolume = candles1h.slice(-31, -1).reduce((sum, candle) => sum + Number(candle[5]), 0) / 30;
  if (averageVolume <= 0) return reject("volume");
  const relativeVolume = Number(candles1h.at(-1)?.[5] ?? 0) / averageVolume;
  const entryEma30m = ema(candles30.map((candle) => Number(candle[4])), 20);
  if (!Number.isFinite(volatility1h) || volatility1h <= 0 || !Number.isFinite(volatility30m) || volatility30m <= 0 || !Number.isFinite(relativeVolume)) return reject("volume");
  const volumeConfirmed = relativeVolume >= 0.65;
  const momentumConfirmed = direction === "LONG" ? change > 0.003 : change < -0.003;
  const pivotLevels = [candles30, candles1h, candles4h, dailyCandles]
    .map((candles) => nearestConfirmedLevel(candles, direction, price))
    .filter((level): level is number => level !== null);
  const pivot = pivotLevels.length
    ? (direction === "LONG" ? Math.max(...pivotLevels) : Math.min(...pivotLevels))
    : null;
  const entry = pivot ?? (direction === "LONG"
    ? Math.min(entryEma30m, price - volatility30m * .25)
    : Math.max(entryEma30m, price + volatility30m * .25));
  const entryDistanceAtr = Math.abs(price - entry) / volatility30m;
  if (!Number.isFinite(entryDistanceAtr) || entryDistanceAtr > 20) return reject("distance");
  const entryNearby = entryDistanceAtr <= 2.5;
  const zoneHalfWidth = volatility30m * .45;
  const risk = Math.max(volatility1h * 1.25, volatility30m * 2);
  const stopLoss = direction === "LONG" ? entry - risk : entry + risk;
  if (!(entry > 0 && stopLoss > 0 && Number.isFinite(entry) && Number.isFinite(stopLoss))) return reject("prices");
  const rawTakeProfit2 = direction === "LONG" ? entry + risk * 2.4 : entry - risk * 2.4;
  const structural = structuralTarget(direction, entry, stopLoss, dailyCandles);
  const hasDailyTarget = structural !== null;
  const takeProfit2 = structural === null ? rawTakeProfit2
    : direction === "LONG" ? Math.min(rawTakeProfit2, structural) : Math.max(rawTakeProfit2, structural);
  const entryPrice = roundPrice(entry);
  const roundedStop = roundPrice(stopLoss);
  const roundedTarget = roundPrice(takeProfit2);
  if (!(roundedTarget > 0 && Number.isFinite(roundedTarget))) return reject("prices");
  const actualRisk = Math.abs(entryPrice - roundedStop);
  const actualReward = direction === "LONG" ? roundedTarget - entryPrice : entryPrice - roundedTarget;
  if (!(actualRisk > 0 && actualReward > 0)) return reject("reward_risk");
  const actualRR = actualReward / actualRisk;
  if (!Number.isFinite(actualRR) || actualRR < 0.5) return reject("reward_risk");
  const ready = aligned && volumeConfirmed && momentumConfirmed && entryNearby && hasDailyTarget && actualRR >= 1.5 && pivot !== null && Number(ticker.turnover24h) >= 20_000_000;
  // Heuristic ranking, not an estimated probability of a profitable trade.
  // All candidates already have aligned 4h/1h/30m trends and R:R >= 1.5.
  const momentumPoints = Math.min(Math.abs(change) * 400, 12);
  const volumePoints = Math.min(Math.max(relativeVolume - 0.5, 0) * 8, 10);
  const rewardRiskPoints = Math.min(Math.max((actualRR - 1.5) / 0.9, 0) * 20, 20);
  const proximityPoints = 12 * Math.max(0, 1 - entryDistanceAtr / 2.5);
  const score = Math.max(1, Math.min(95, Math.round(41 + momentumPoints + volumePoints + rewardRiskPoints + proximityPoints - (ready ? 0 : 18))));
  const caution = relativeVolume >= 1.2 ? "Усі три таймфрейми узгоджені, але Limit-зона може не бути протестована." : "Напрямок узгоджений, але обсяг слабкий: не ставте заявку без повторної автооцінки.";
  return {
    id: `${ticker.symbol}-${direction}-${Math.round(entry * 1e6)}`,
    symbol: ticker.symbol,
    direction,
    score,
    currentPrice: roundPrice(price),
    entryPrice,
    entryLow: roundPrice(entry - zoneHalfWidth),
    entryHigh: roundPrice(entry + zoneHalfWidth),
    stopLoss: roundedStop,
    takeProfit1: roundedTarget,
    takeProfit2: roundedTarget,
    riskReward: Number(actualRR.toFixed(2)),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    reasons: [`4h тренд: ціна ${directionLabel(direction)} EMA20 і EMA50`, `1h структура: ціна ${directionLabel(direction)} EMA20 і EMA50`, `30m підтвердження входу: ${direction}`, hasDailyTarget ? `TP обмежено денним swing-рівнем` : `Ціль попередня: денний рівень не підтверджений`, `24h імпульс ${(change * 100).toFixed(2)}% · закритий 1h обсяг ${relativeVolume.toFixed(1)}× · до входу ${entryDistanceAtr.toFixed(2)} ATR`],
    summary: `${ready ? "Підтверджений технічний план" : "Сценарій спостереження"} ${direction}. Очікується Limit-рівень ${entryPrice}.`,
    caution,
    nextStep: ready ? "Перевірте актуальний план і ризик перед Demo-заявкою." : "Очікуйте підтвердження тренду, обсягу та рівня; заявку поки не ставити.",
    explanationSource: "rule",
    invalidation: direction === "LONG" ? `1h закриття нижче ${roundPrice(stopLoss)}` : `1h закриття вище ${roundPrice(stopLoss)}`,
    status: ready ? "ACTIVE" : "REVIEW",
  };
}

const CYCLE_BATCH = 24; // API request batch, NOT a limit on the market universe
const MAX_VISIBLE = 100;
const seenPlans = new Map<string, { plan: TradePlan; checkedAt: number }>();
const visited = new Set<string>();
let scanCursor = 0;
let latestScan: { until: number; value: ScanResult } | undefined;
let activeScan: Promise<ScanResult> | undefined;
const SCAN_INTERVAL = 20_000;
const PLAN_TTL = 15 * 60_000;
export type ScanResult = {
  plans: TradePlan[];
  scanned: number;
  eligible: number;
  analyzed: number;
  covered: number;
  category: "linear";
  rejectionCounts: Record<FilterReason, number>;
};

async function doScan(): Promise<ScanResult> {
  const response = await fetch(`${DEMO_BYBIT_URL}/v5/market/tickers?category=linear`, {
    cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Bybit market request failed");
  const data = await response.json() as { retCode: number; retMsg?: string; result?: { list?: Ticker[] } };
  if (data.retCode !== 0 || !data.result?.list) throw new Error(data.retMsg || "Не вдалося отримати ринок Bybit.");
  // Scan the complete available linear ticker universe; liquidity affects readiness, not discovery.
  const eligible = data.result.list.filter((ticker) =>
    ticker.symbol.endsWith("USDT") && Number.isFinite(Number(ticker.lastPrice)) && Number(ticker.lastPrice) > 0);
  eligible.sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h));
  const universe = new Set(eligible.map((ticker) => ticker.symbol));
  for (const symbol of seenPlans.keys()) if (!universe.has(symbol)) seenPlans.delete(symbol);
  for (const symbol of visited) if (!universe.has(symbol)) visited.delete(symbol);
  if (scanCursor >= eligible.length) scanCursor = 0;
  const batch = eligible.slice(scanCursor, scanCursor + CYCLE_BATCH);
  scanCursor = (scanCursor + batch.length) % Math.max(eligible.length, 1);
  const rejectionCounts: Record<FilterReason, number> = {
    candles: 0, trend: 0, volume: 0, momentum: 0,
    distance: 0, prices: 0, daily_level: 0, reward_risk: 0, error: 0,
  };
  // Limit concurrency to avoid bursts of dozens of simultaneous Bybit requests.
  const results: PromiseSettledResult<TradePlan | null>[] = new Array(batch.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
    while (index < batch.length) {
      const current = index++;
      const ticker = batch[current];
      try {
        results[current] = { status: "fulfilled",
          value: await makePlan(ticker, (reason) => { rejectionCounts[reason]++; return null; }) };
      } catch (reason) {
        results[current] = { status: "rejected", reason };
      }
    }
  }));
  const now = Date.now();
  results.forEach((result, i) => {
    const symbol = batch[i].symbol;
    visited.add(symbol);
    if (result.status === "fulfilled" && result.value) {
      seenPlans.set(symbol, { plan: result.value, checkedAt: now });
    } else {
      seenPlans.delete(symbol);
      if (result.status === "rejected") rejectionCounts.error++;
    }
  });
  for (const [symbol, record] of seenPlans) {
    if (now - record.checkedAt > PLAN_TTL) seenPlans.delete(symbol);
  }
  const plans = [...seenPlans.values()].map((record) => record.plan)
    .sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1) || b.score - a.score || b.riskReward - a.riskReward || a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_VISIBLE);
  return { plans, scanned: data.result.list.length, eligible: eligible.length,
    analyzed: batch.length, covered: visited.size, category: "linear", rejectionCounts };
}

export async function scanTechnicalPlans(): Promise<ScanResult> {
  if (latestScan && latestScan.until > Date.now()) return latestScan.value;
  if (activeScan) return activeScan;
  activeScan = doScan();
  try {
    const result = await activeScan;
    latestScan = { until: Date.now() + SCAN_INTERVAL, value: result };
    return result;
  } finally {
    activeScan = undefined;
  }
}

// The order endpoint must independently refresh the chosen symbol,
// rather than trusting cached or rotating scanner results.
export async function verifyCurrentTechnicalPlan(symbol: string): Promise<TradePlan | null> {
  const tickers = await fetch(`${DEMO_BYBIT_URL}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!tickers.ok) return null;
  const data = await tickers.json() as { retCode: number; result?: { list?: Ticker[] } };
  const ticker = data.retCode === 0 ? data.result?.list?.find((item) => item.symbol === symbol) : undefined;
  if (!ticker) return null;
  return makePlan(ticker, () => null);
}
