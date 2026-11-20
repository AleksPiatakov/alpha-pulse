import { DEMO_BYBIT_URL, roundPrice, type PlanDirection, type TradePlan } from "@/lib/trading";
import { calculatePlanningLevels, assessPlanningLevels } from "./trade-planning-engine.ts";
import { explainPlanLifecycle } from "./trade-plan-lifecycle.ts";
import { closedMarketFeatures } from "./closed-market-features.ts";
import { sealMarketInputSnapshot, type MarketInputSnapshot, type SnapshotTimeframes } from "./market-input-snapshot.ts";
import { compareFrozenMarketPlan } from "./snapshot-parity.ts";
import { assessLimitEntry24h } from "./limit-entry-24h.ts";
import { select24hLimitRecommendations } from "./24h-recommendations.ts";
import { orderMarketScan, selectSweepBatch } from "./market-scan-scheduler.ts";
import { summarize24hSelection, type SelectionDiagnostics } from "./scan-selection-diagnostics.ts";
import { closedBarAt, completedBarCutoff, observationMetadata, type MarketTimeframe } from "./market-observation-clock.ts";
import { ClosedCandleCache } from "./closed-candle-cache.ts";
import { updateWatchedScenario, ageWatchedScenario, selectWatchedScenarios, type WatchedScenario } from "./scenario-watchlist.ts";
import { assessScanFreshness } from "./scan-freshness.ts";
import { selectPriorityRechecks } from "./priority-recheck.ts";
import { fetchLinearUniverse, matchUniverseTickers, type UniverseResult, type InstrumentMeta } from "./bybit-universe.ts";
import { parseExecutionRules } from "./bybit-execution-rules.ts";
import { roundToTick } from "./technical-plan-core.ts";
import { emaValues as ema, atrBars, trendBars, nearestSwingLevel, type PriceBar } from "./technical-plan-core.ts";

type Ticker = { symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string };
type Candle = [string, string, string, string, string, string, string];
type Interval = MarketTimeframe;

function asBars(candles: Candle[]): PriceBar[] {
  return candles.map((bar) => ({ high: Number(bar[2]), low: Number(bar[3]), close: Number(bar[4]) }));
}
function atr(candles: Candle[]) { return atrBars(asBars(candles)); }
function trend(candles: Candle[]): PlanDirection | null { return trendBars(asBars(candles)); }
function nearestConfirmedLevel(candles: Candle[], direction: PlanDirection, price: number): number | null {
  return nearestSwingLevel(asBars(candles), direction, price);
}

class InsufficientCandleHistory extends Error {}
const closedCandleCache = new ClosedCandleCache<Candle[]>(1800);
async function candlesFor(symbol: string, interval: Interval, observedAt: number) {
  const cutoff=completedBarCutoff(observedAt,interval);
  if (cutoff===null)return null;
  try {
    return await closedCandleCache.get(`${symbol}:${interval}`,cutoff,observedAt,async()=>{
      const limit=200;
      const response = await fetch(`${DEMO_BYBIT_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`,
        { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if(!response.ok)throw new Error(`Bybit Kline ${symbol} ${interval}: HTTP ${response.status}`);
      const data=await response.json() as {retCode:number;result?:{list?:Candle[]}};
      if(data.retCode!==0||!data.result?.list)throw new Error(`Bybit Kline ${symbol} ${interval}: invalid response`);
      const closed=[...data.result.list].reverse().filter(c=>
        closedBarAt(Number(c[0]),interval,observedAt)&&
        [c[2],c[3],c[4],c[5],c[6]].every(n=>n!==undefined&&Number.isFinite(Number(n))));
      if(closed.length<60)throw new InsufficientCandleHistory();
      return closed;
    });
  } catch(error) {
    if(error instanceof InsufficientCandleHistory)return null;
    throw error;
  }
}

export type FilterReason = "candles" | "trend" | "volume" | "momentum" | "distance" | "prices" | "daily_level" | "reward_risk" | "error";
async function makePlan(ticker: Ticker, reject: (reason: FilterReason) => null, meta?: InstrumentMeta, observedAt = Date.now(), candleInput?: SnapshotTimeframes): Promise<TradePlan | null> {
  const rules = parseExecutionRules(meta);
  if (!rules) return reject("prices");
  const [candles30, candles1h, candles4h, dailyCandles] = candleInput
    ? [candleInput["30"], candleInput["60"], candleInput["240"], candleInput.D]
    : await Promise.all([candlesFor(ticker.symbol, "30", observedAt), candlesFor(ticker.symbol, "60", observedAt), candlesFor(ticker.symbol, "240", observedAt), candlesFor(ticker.symbol, "D", observedAt)]);
  if (!candles30 || !candles1h || !candles4h || !dailyCandles) return reject("candles");
  const price = Number(ticker.lastPrice);
  const features = closedMarketFeatures(candles1h.map((bar) => ({
    close: Number(bar[4]), volume: Number(bar[5]), turnover: Number(bar[6]),
  })));
  if (!features) return reject("volume");
  const change = features.change24h;
  const direction4h = trend(candles4h), direction1h = trend(candles1h), direction30m = trend(candles30);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) return reject("prices");
  const direction: PlanDirection = direction4h ?? direction1h ?? direction30m ?? (change >= 0 ? "LONG" : "SHORT");
  const volatility1h = atr(candles1h), volatility30m = atr(candles30);
  const relativeVolume = features.relativeVolume1h;
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
      change24h: change, turnover24h: features.turnover24h,
      pivot1h: h1Pivot !== null, pivot4h: h4Pivot !== null, pivotDaily: dPivot !== null,
    },
  });
  const reach = assessLimitEntry24h({ direction, currentPrice: price, entryPrice,
    atr30m: volatility30m, closed30m: asBars(candles30) });
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
    structure: { confirmedEntry: levels.confirmedEntry, confirmedTarget: levels.confirmedTarget },
    limitEntry24h: reach,
    currentPrice: roundToTick(price, rules.tickSize),
    entryPrice,
    entryLow: roundToTick(entry - zoneHalfWidth, rules.tickSize),
    entryHigh: roundToTick(entry + zoneHalfWidth, rules.tickSize),
    stopLoss: roundedStop,
    takeProfit1: roundedTarget,
    takeProfit2: roundedTarget,
    riskReward: Number(actualRR.toFixed(2)),
    // Plan refresh remains 2h; the 24h window is for entry reachability, NOT a 24h stale quote.
    expiresAt: new Date(observedAt + 2 * 60 * 60 * 1000).toISOString(),
    observation: observationMetadata(observedAt),
    featureSource: features.source,
    reasons: [`24h Limit-вхід: ${reach.status}; історичні торкання ${reach.historicalTouchRate === null ? "недоступні" : (reach.historicalTouchRate * 100).toFixed(1) + "%"} (${reach.sampleWindows} перекривних вікон). Це не ймовірність виконання.`, `4h EMA: ${direction4h ?? "без напрямку"}`, `1h EMA: ${direction1h ?? "без напрямку"}`, `30m EMA: ${direction30m ?? "без напрямку"}`, hasDailyTarget ? `TP обмежено денним swing-рівнем` : `Ціль попередня: денний рівень не підтверджений`, `24h імпульс закритих свічок ${(change * 100).toFixed(2)}% · 24h оборот закритих свічок ${features.turnover24h.toFixed(0)} USDT · 1h обсяг ${relativeVolume.toFixed(1)}× · до входу ${entryDistanceAtr.toFixed(2)} ATR`, ...quality.checks],
    summary: `${quality.status === "ACTIVE" ? "Технічні умови узгоджені" : "Сценарій спостереження"} ${direction}. Очікується Limit-рівень ${entryPrice}.`,
    caution,
    nextStep: quality.status === "ACTIVE" ? "Перевірте актуальний план і ризик перед Demo-заявкою." : "Дочекайтеся додаткового підтвердження або випробуйте сценарій у Demo.",
    explanationSource: "rule",
    invalidation: explainPlanLifecycle(direction, roundedStop).setupReview,
    lifecycle: explainPlanLifecycle(direction, roundedStop),
    status: quality.status,
  };
}

const CYCLE_BATCH = 64; // Larger deep-analysis batch, NOT a market-universe cap.
const CYCLE_CONCURRENCY = 8; // Bounded request parallelism to protect exchange limits.
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
const monitoredScenarios = new Map<string,WatchedScenario>();
const visited = new Set<string>();
const visitedAt = new Map<string,number>();
const failedInSweep = new Set<string>();
let scanCursor = 0;
let pinnedSweepOrder: string[] = [];
let completedSweeps = 0;
let latestScan: { until: number; value: ScanResult } | undefined;
let activeScan: Promise<ScanResult> | undefined;
const SCAN_INTERVAL = 8_000;
const PLAN_TTL = 45 * 60_000;
const CONFIRMATION_FRESHNESS = 4 * 60_000;
export type ScanResult = {
  plans: TradePlan[];
  recommended24h: TradePlan[];
  watchedScenarios: WatchedScenario[];
  watchStatusCounts: {watching:number;ready:number;stale:number;expired:number;unavailable:number};
  recommended24hComplete: boolean;
  entryHorizonHours: 24;
  scanned: number;
  eligible: number;
  analyzed: number;
  covered: number;
  batchSize: number;
  scanConcurrency: number;
  deepScannedInSweep: number;
  selectionDiagnostics: SelectionDiagnostics;
  category: "linear";
  universePages: number; universeInstruments: number; unsupportedInstruments: number;
  coveragePercent: number; cycleCompleted: boolean; completedSweeps: number;
  freshChecked: number; staleChecked: number; failedChecked: number; unchecked: number; oldestCheckedAgeSeconds: number | null;
  rejectionCounts: Record<FilterReason, number>;
  batchDurationMs:number; priorityRechecked:number;
};

async function doScan(): Promise<ScanResult> {
  const observedAt = Date.now();
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
  for (const symbol of monitoredScenarios.keys()) if (!universe.has(symbol)) monitoredScenarios.delete(symbol);
  for (const symbol of visited) if (!universe.has(symbol)) { visited.delete(symbol); visitedAt.delete(symbol); }
  // One inexpensive all-market ticker pass chooses priority. Every symbol still
  // receives the expensive four-timeframe analysis during the sweep.
  if (scanCursor === 0 || pinnedSweepOrder.length === 0) {
    pinnedSweepOrder = orderMarketScan(eligible);
    visited.clear();
    visitedAt.clear();
    failedInSweep.clear();
  }
  const quotes = new Map(eligible.map(t => [t.symbol,t]));
  const chosen = selectSweepBatch(pinnedSweepOrder,scanCursor,CYCLE_BATCH);
  scanCursor = chosen.nextCursor;
  // Independently recheck near-ready plans; bounded overhead and no change
  // to the pinned full-market sweep cursor or order authorization.
  const prioritySymbols = selectPriorityRechecks(
    seenPlans, new Set(chosen.symbols), universe, observedAt
  );
  const batch = [...chosen.symbols, ...prioritySymbols]
    .map(symbol => quotes.get(symbol)).filter((ticker): ticker is Ticker => ticker !== undefined);
  const rejectionCounts: Record<FilterReason, number> = {
    candles: 0, trend: 0, volume: 0, momentum: 0,
    distance: 0, prices: 0, daily_level: 0, reward_risk: 0, error: 0,
  };
  // Limit concurrency to avoid bursts of dozens of simultaneous Bybit requests.
  const results: PromiseSettledResult<TradePlan | null>[] = new Array(batch.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(CYCLE_CONCURRENCY, batch.length) }, async () => {
    while (index < batch.length) {
      const current = index++;
      const ticker = batch[current];
      try {
        results[current] = { status: "fulfilled",
          value: await makePlan(ticker, (reason) => { rejectionCounts[reason]++; return null; }, metadataBySymbol.get(ticker.symbol), observedAt) };
      } catch (reason) {
        results[current] = { status: "rejected", reason };
      }
    }
  }));
  const now = Date.now();
  const batchDurationMs = now - observedAt;
  results.forEach((result, i) => {
    const symbol = batch[i].symbol;
    visited.add(symbol);
    visitedAt.set(symbol,now);
    if (result.status === "rejected") failedInSweep.add(symbol);
    else failedInSweep.delete(symbol);
    if (result.status === "fulfilled" && result.value) {
      seenPlans.set(symbol, { plan: result.value, checkedAt: now });
      const updated=updateWatchedScenario(monitoredScenarios.get(symbol),result.value,now);
      if(updated)monitoredScenarios.set(symbol,updated);
    } else {
      seenPlans.delete(symbol);
      if(result.status==="rejected"){
        rejectionCounts.error++;
        // Network failure is NOT evidence that the technical setup was invalidated.
      }else {
        const updated=updateWatchedScenario(monitoredScenarios.get(symbol),null,now);
        if(updated)monitoredScenarios.set(symbol,updated);
      }
    }
  });
  for (const [symbol, record] of seenPlans) {
    if (now - record.checkedAt > PLAN_TTL) seenPlans.delete(symbol);
  }
  const allPlans = [...seenPlans.values()].map((record) => {
    // A cached suggestion remains visible, but cannot retain "confirmed" after it becomes stale.
    if (now - record.checkedAt <= CONFIRMATION_FRESHNESS) return record.plan;
    return { ...record.plan, status: "REVIEW" as const,
      nextStep: "Сценарій потребує повторного аналізу перед Demo Limit." };
  });
  const plans = [...allPlans].sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1) || b.score - a.score || b.riskReward - a.riskReward || a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_VISIBLE);
  // Keep a separate, strictly gated Top-10 shortlist. Until the current
  // sweep visits all symbols it is ONLY provisional, never a market-wide Top 10.
  for(const [symbol,scenario] of monitoredScenarios){
    if(now-scenario.validUntil>60*60_000){
      monitoredScenarios.delete(symbol);
      continue;
    }
    monitoredScenarios.set(symbol,ageWatchedScenario(scenario,now));
  }
  const watchedValues=[...monitoredScenarios.values()];
  const watchedScenarios=selectWatchedScenarios(watchedValues,20);
  const watchStatusCounts={
    watching:watchedValues.filter(s=>s.state==="WATCHING").length,
    ready:watchedValues.filter(s=>s.state==="READY_FOR_REVIEW").length,
    stale:watchedValues.filter(s=>s.state==="STALE").length,
    expired:watchedValues.filter(s=>s.state==="EXPIRED").length,
    unavailable:watchedValues.filter(s=>s.state==="NO_CURRENT_PLAN").length,
  };
  const recommended24h = select24hLimitRecommendations(allPlans,10);
  const selectionDiagnostics = summarize24hSelection(allPlans);
  if (visited.size === eligible.length) completedSweeps++;
  // Sweep progress and reliable freshness are different: failed requests
  // cannot count as successfully observed instruments.
  const freshness = assessScanFreshness(
    eligible.map(t => t.symbol), visitedAt, failedInSweep, now, CONFIRMATION_FRESHNESS
  );
  const {freshChecked, staleChecked, failedChecked, unchecked, oldestCheckedAgeSeconds} = freshness;
  const allSymbolsRecentlyChecked = freshness.completeAndFresh;
  return { plans, recommended24h, watchedScenarios, watchStatusCounts, recommended24hComplete: allSymbolsRecentlyChecked,
    entryHorizonHours: 24 as const, scanned: data.result.list.length, eligible: eligible.length,
    analyzed: batch.length, covered: visited.size,
    batchSize: CYCLE_BATCH, scanConcurrency: CYCLE_CONCURRENCY,
    deepScannedInSweep: visited.size, selectionDiagnostics, category: "linear",
    universePages: registry.pages, universeInstruments: registry.eligibleSymbols.size,
    unsupportedInstruments: registry.rejectedUnsupported + registry.rejectedNonTrading,
    coveragePercent: Number((100 * visited.size / eligible.length).toFixed(1)),
    cycleCompleted: visited.size === eligible.length, completedSweeps,
    freshChecked, staleChecked, failedChecked, unchecked, oldestCheckedAgeSeconds,
    rejectionCounts, batchDurationMs, priorityRechecked:prioritySymbols.length };
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
  return makePlan(ticker, () => null, meta, Date.now());
}

/**
 * On-demand single-symbol research snapshot. Fetches no account/private data and
 * does not place orders. The plan is computed from the EXACT sealed inputs.
 */
export async function captureAndEvaluateMarketSnapshot(symbol: string) {
  if (!/^[A-Z0-9]{3,24}USDT$/.test(symbol)) throw new Error("Некоректний символ.");
  const observedAt = Date.now();
  const [tickerResponse, metadataResponse, m30, h1, h4, daily] = await Promise.all([
    fetch(`${DEMO_BYBIT_URL}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`,
      {cache:"no-store", signal:AbortSignal.timeout(12000)}),
    fetch(`${DEMO_BYBIT_URL}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`,
      {cache:"no-store", signal:AbortSignal.timeout(12000)}),
    candlesFor(symbol, "30", observedAt), candlesFor(symbol, "60", observedAt),
    candlesFor(symbol, "240", observedAt), candlesFor(symbol, "D", observedAt),
  ]);
  if (!tickerResponse.ok || !metadataResponse.ok || !m30 || !h1 || !h4 || !daily)
    throw new Error("Не вдалося отримати повний набір ринкових даних Bybit Demo.");
  const tickerData = await tickerResponse.json() as {retCode?:number;result?:{list?:Ticker[]}};
  const metaData = await metadataResponse.json() as {retCode?:number;result?:{list?:InstrumentMeta[]}};
  const ticker = tickerData.retCode === 0 ? tickerData.result?.list?.find(x=>x.symbol===symbol) : undefined;
  const instrument = metaData.retCode === 0 ? metaData.result?.list?.find(x=>x.symbol===symbol) : undefined;
  if (!ticker || !instrument) throw new Error("Немає актуального тикера або параметрів контракту.");
  const snapshot: MarketInputSnapshot = {
    schema: "alpha-pulse-market-input-v1", source: "bybit-demo", observedAt, symbol,
    ticker, instrument, candles: {"30":m30,"60":h1,"240":h4,D:daily},
  };
  const sealed = sealMarketInputSnapshot(snapshot);
  const plan = await makePlan(ticker, ()=>null, instrument, observedAt, snapshot.candles);
  const repeated = await makePlan(ticker, ()=>null, instrument, observedAt, snapshot.candles);
  if (JSON.stringify(plan) !== JSON.stringify(repeated))
    throw new Error("Невідтворюваний результат плану на одному знімку.");
  const parity = compareFrozenMarketPlan(sealed, plan);
  if (!parity.scannerMatches)
    throw new Error(`Знайдено розбіжності незалежної перевірки: ${parity.mismatches.join(", ")}.`);
  return {...sealed, plan, parity, deterministic: true, orderEnabled: false as const};
}
