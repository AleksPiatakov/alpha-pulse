import { DEMO_BYBIT_URL, roundPrice, type PlanDirection, type TradePlan } from "@/lib/trading";
import { calculatePlanningLevels, assessPlanningLevels } from "./trade-planning-engine.ts";
import { explainPlanLifecycle } from "./trade-plan-lifecycle.ts";
import { fetchLinearUniverse, matchUniverseTickers, type UniverseResult, type InstrumentMeta } from "./bybit-universe.ts";
import { parseExecutionRules } from "./bybit-execution-rules.ts";
import { roundToTick } from "./technical-plan-core.ts";
import { emaValues as ema, atrBars, trendBars, nearestSwingLevel, isCompletedBar, type PriceBar } from "./technical-plan-core.ts";

type Ticker = { symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string };
type Candle = [string, string, string, string, string, string];
type Interval = "30" | "60" | "240" | "D";

function asBars(candles: Candle[]): PriceBar[] {
  return candles.map((bar) => ({ high: Number(bar[2]), low: Number(bar[3]), close: Number(bar[4]) }));
}
function atr(candles: Candle[]) { return atrBars(asBars(candles)); }
function trend(candles: Candle[]): PlanDirection | null { return trendBars(asBars(candles)); }
function nearestConfirmedLevel(candles: Candle[], direction: PlanDirection, price: number): number | null {
  return nearestSwingLevel(asBars(candles), direction, price);
}

async function candlesFor(symbol: string, interval: Interval) {
  const limit = 200;
  const response = await fetch(`${DEMO_BYBIT_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`, { cache: "no-store" });
  const data = await response.json() as { retCode: number; result?: { list?: Candle[] } };
  if (data.retCode !== 0 || !data.result?.list) return null;
  const intervalMs = interval === "D" ? 86_400_000 : Number(interval) * 60_000;
  const closed = [...data.result.list].reverse().filter((c) =>
    isCompletedBar(Number(c[0]), intervalMs, Date.now()) &&
    [c[2], c[3], c[4], c[5]].every((n) => Number.isFinite(Number(n))));
  return closed.length >= 60 ? closed : null;
}

export type FilterReason = "candles" | "trend" | "volume" | "momentum" | "distance" | "prices" | "daily_level" | "reward_risk" | "error";
async function makePlan(ticker: Ticker, reject: (reason: FilterReason) => null, meta?: InstrumentMeta): Promise<TradePlan | null> {
  const rules = parseExecutionRules(meta);
  if (!rules) return reject("prices");
  const [candles30, candles1h, candles4h, dailyCandles] = await Promise.all([candlesFor(ticker.symbol, "30"), candlesFor(ticker.symbol, "60"), candlesFor(ticker.symbol, "240"), candlesFor(ticker.symbol, "D")]);
  if (!candles30 || !candles1h || !candles4h || !dailyCandles) return reject("candles");
  const price = Number(ticker.lastPrice), change = Number(ticker.price24hPcnt);
  const direction4h = trend(candles4h), direction1h = trend(candles1h), direction30m = trend(candles30);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) return reject("prices");
  const direction: PlanDirection = direction4h ?? direction1h ?? direction30m ?? (change >= 0 ? "LONG" : "SHORT");
  const volatility1h = atr(candles1h), volatility30m = atr(candles30);
  const averageVolume = candles1h.slice(-31, -1).reduce((sum, candle) => sum + Number(candle[5]), 0) / 30;
  if (averageVolume <= 0) return reject("volume");
  const relativeVolume = Number(candles1h.at(-1)?.[5] ?? 0) / averageVolume;
  const entryEma30m = ema(candles30.map((candle) => Number(candle[4])), 20);
  if (!Number.isFinite(volatility1h) || volatility1h <= 0 || !Number.isFinite(volatility30m) || volatility30m <= 0 || !Number.isFinite(relativeVolume)) return reject("volume");
  const pivotLevels = [candles30, candles1h, candles4h, dailyCandles]
    .map((candles) => nearestConfirmedLevel(candles, direction, price));
  const zoneHalfWidth = volatility30m * .45;
  const entryFallback = direction === "LONG"
    ? Math.min(entryEma30m, price - volatility30m * .25)
    : Math.max(entryEma30m, price + volatility30m * .25);
  const levels = calculatePlanningLevels({
    direction, currentPrice: price, atr30m: volatility30m, atr1h: volatility1h,
    supportLevels: pivotLevels, dailyBars: asBars(dailyCandles), fallbackEntry: entryFallback,
    tickSize: rules.tickSize,
  });
  if (!levels) return reject("prices");
  const { entry: entryPrice, stop: roundedStop, target: roundedTarget, rewardRisk: actualRR } = levels;
  const entry = entryPrice, entryDistanceAtr = levels.distanceAtr;
  if (entryDistanceAtr > 20) return reject("distance");
  if (actualRR < 0.5) return reject("reward_risk");
  const hasDailyTarget = levels.confirmedTarget;
  const h1Pivot = nearestConfirmedLevel(candles1h, direction, price);
  const h4Pivot = nearestConfirmedLevel(candles4h, direction, price);
  const dPivot = nearestConfirmedLevel(dailyCandles, direction, price);
  const { scenario: quality, gate } = assessPlanningLevels({
    direction, levels, atr30m: volatility30m, tickSize: rules.tickSize,
    quality: {
      direction4h, direction1h, direction30m, relativeVolume,
      change24h: change, turnover24h: Number(ticker.turnover24h),
      pivot1h: h1Pivot !== null, pivot4h: h4Pivot !== null, pivotDaily: dPivot !== null,
    },
  });
  const { score } = quality;
  const caution = quality.status === "ACTIVE" ? "Навіть узгоджені технічні умови не гарантують виконання Limit-заявки або прибутку." : `Непідтверджено: ${quality.checks.slice(0, 2).join("; ") || "потрібна повторна перевірка"}.`;
  return {
    id: `${ticker.symbol}-${direction}-${Math.round(entry * 1e6)}`,
    symbol: ticker.symbol,
    direction,
    score,
    readiness: { met: quality.confirmedConditions, total: quality.totalConditions, missing: quality.checks },
    qualityGate: { passed: gate.accepted, reasons: gate.reasons, policy: "intraday-quality-v1",
      stopAtr: Number.isFinite(gate.stopAtr) ? Number(gate.stopAtr.toFixed(3)) : null,
      rewardRisk: Number.isFinite(gate.rewardRisk) ? Number(gate.rewardRisk.toFixed(3)) : null },
    currentPrice: roundToTick(price, rules.tickSize),
    entryPrice,
    entryLow: roundToTick(entry - zoneHalfWidth, rules.tickSize),
    entryHigh: roundToTick(entry + zoneHalfWidth, rules.tickSize),
    stopLoss: roundedStop,
    takeProfit1: roundedTarget,
    takeProfit2: roundedTarget,
    riskReward: Number(actualRR.toFixed(2)),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    reasons: [`4h EMA: ${direction4h ?? "без напрямку"}`, `1h EMA: ${direction1h ?? "без напрямку"}`, `30m EMA: ${direction30m ?? "без напрямку"}`, hasDailyTarget ? `TP обмежено денним swing-рівнем` : `Ціль попередня: денний рівень не підтверджений`, `24h імпульс ${(change * 100).toFixed(2)}% · закритий 1h обсяг ${relativeVolume.toFixed(1)}× · до входу ${entryDistanceAtr.toFixed(2)} ATR`, ...quality.checks],
    summary: `${quality.status === "ACTIVE" ? "Технічні умови узгоджені" : "Сценарій спостереження"} ${direction}. Очікується Limit-рівень ${entryPrice}.`,
    caution,
    nextStep: quality.status === "ACTIVE" ? "Перевірте актуальний план і ризик перед Demo-заявкою." : "Дочекайтеся додаткового підтвердження або випробуйте сценарій у Demo.",
    explanationSource: "rule",
    invalidation: explainPlanLifecycle(direction, roundedStop).setupReview,
    lifecycle: explainPlanLifecycle(direction, roundedStop),
    status: quality.status,
  };
}

const CYCLE_BATCH = 24; // API request batch, NOT a limit on the market universe
const UNIVERSE_TTL = 10 * 60_000;
let universeCache: { until: number; registry: UniverseResult } | undefined;
async function currentUniverse(): Promise<UniverseResult> {
  if (universeCache && universeCache.until > Date.now()) return universeCache.registry;
  const registry = await fetchLinearUniverse(DEMO_BYBIT_URL);
  if (registry.eligibleSymbols.size === 0) throw new Error("Bybit не повернув доступних USDT-інструментів.");
  universeCache = { until: Date.now() + UNIVERSE_TTL, registry };
  return registry;
}
const MAX_VISIBLE = 100;
const seenPlans = new Map<string, { plan: TradePlan; checkedAt: number }>();
const visited = new Set<string>();
let scanCursor = 0;
let completedSweeps = 0;
let latestScan: { until: number; value: ScanResult } | undefined;
let activeScan: Promise<ScanResult> | undefined;
const SCAN_INTERVAL = 20_000;
const PLAN_TTL = 45 * 60_000;
const CONFIRMATION_FRESHNESS = 4 * 60_000;
export type ScanResult = {
  plans: TradePlan[];
  scanned: number;
  eligible: number;
  analyzed: number;
  covered: number;
  category: "linear";
  universePages: number; universeInstruments: number; unsupportedInstruments: number;
  coveragePercent: number; cycleCompleted: boolean; completedSweeps: number;
  rejectionCounts: Record<FilterReason, number>;
};

async function doScan(): Promise<ScanResult> {
  const [registry, response] = await Promise.all([currentUniverse(), fetch(`${DEMO_BYBIT_URL}/v5/market/tickers?category=linear`, {
    cache: "no-store", signal: AbortSignal.timeout(12000),
  })]);
  if (!response.ok) throw new Error("Bybit market request failed");
  const data = await response.json() as { retCode: number; retMsg?: string; result?: { list?: Ticker[] } };
  if (data.retCode !== 0 || !data.result?.list) throw new Error(data.retMsg || "Не вдалося отримати ринок Bybit.");
  // Every active USDT linear instrument in Bybit's paginated registry is discoverable.
  // Tickers missing from the market response are not silently declared analyzed.
  const eligible = matchUniverseTickers(data.result.list, registry.eligibleSymbols);
  if (eligible.length === 0) throw new Error("Bybit не повернув котирувань для торгових інструментів.");
  const universe = new Set(eligible.map((ticker) => ticker.symbol));
  const metadataBySymbol = new Map(registry.instruments.map((item) => [item.symbol, item]));
  for (const symbol of seenPlans.keys()) if (!universe.has(symbol)) seenPlans.delete(symbol);
  for (const symbol of visited) if (!universe.has(symbol)) visited.delete(symbol);
  if (scanCursor >= eligible.length) scanCursor = 0;
  if (scanCursor === 0) visited.clear(); // Coverage always means this sweep, not all historical visits.
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
          value: await makePlan(ticker, (reason) => { rejectionCounts[reason]++; return null; }, metadataBySymbol.get(ticker.symbol)) };
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
  const plans = [...seenPlans.values()].map((record) => {
    // A cached suggestion remains visible, but cannot retain "confirmed" after it becomes stale.
    if (now - record.checkedAt <= CONFIRMATION_FRESHNESS) return record.plan;
    return { ...record.plan, status: "REVIEW" as const,
      nextStep: "Сценарій потребує повторного аналізу перед Demo Limit." };
  })
    .sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1) || b.score - a.score || b.riskReward - a.riskReward || a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_VISIBLE);
  if (visited.size === eligible.length) completedSweeps++;
  return { plans, scanned: data.result.list.length, eligible: eligible.length,
    analyzed: batch.length, covered: visited.size, category: "linear",
    universePages: registry.pages, universeInstruments: registry.eligibleSymbols.size,
    unsupportedInstruments: registry.rejectedUnsupported + registry.rejectedNonTrading,
    coveragePercent: Number((100 * visited.size / eligible.length).toFixed(1)),
    cycleCompleted: visited.size === eligible.length, completedSweeps,
    rejectionCounts };
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
  const url = `${DEMO_BYBIT_URL}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  const info = await response.json() as { retCode?: number; result?: { list?: InstrumentMeta[] } };
  if (info.retCode !== 0) return null;
  const meta = info.result?.list?.find((item) => item.symbol === symbol);
  return makePlan(ticker, () => null, meta);
}
