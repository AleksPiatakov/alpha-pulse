import { NextResponse } from "next/server";
import { PUBLIC_BYBIT_URL } from "@/lib/trading";
import { isCompletedBar } from "@/lib/technical-plan-core";
import { loadSnapshot, persistSnapshot, sealSnapshot } from "@/lib/backtest-snapshot";
import { replayMultiTimeframeStrategy, REPLAY_VARIANTS, EXECUTION_STRESS_CASES, type ReplayBar, type ReplayTimeframes } from "@/lib/mtf-backtest";

const symbolPattern = /^[A-Z0-9]{3,24}USDT$/;
type BybitCandle = [string, string, string, string, string, string, string];
type Interval = keyof ReplayTimeframes;
const intervals: Interval[] = ["30", "60", "240", "D"];
const duration: Record<Interval, number> = {
  "30": 1_800_000, "60": 3_600_000, "240": 14_400_000, D: 86_400_000,
};
// Explicit fixed cutoff for reproducible comparative experiments.
const COMPARISON_END = Date.parse("2026-11-12T00:00:00.000Z");
const cache = new Map<string, { until: number; payload: unknown }>();

const pagesPerInterval: Record<Interval, number> = { "30": 6, "60": 4, "240": 2, D: 1 };

type HistoryLoad = { bars: ReplayBar[]; warnings: string[]; pages: number };
const transientCode = new Set([10006, 10000, 10016, 10019]);
const retrySleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function requestCandles(symbol: string, interval: Interval, end: number | undefined): Promise<BybitCandle[]> {
  const params = new URLSearchParams({ category: "linear", symbol, interval, limit: "1000" });
  if (end !== undefined) params.set("end", String(end));
  let previous = "Невідома помилка Bybit.";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${PUBLIC_BYBIT_URL}/v5/market/kline?${params.toString()}`, {
        cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      const data = await response.json() as {
        retCode?: number; retMsg?: string; result?: { list?: BybitCandle[] };
      };
      if (response.ok && data.retCode === 0 && Array.isArray(data.result?.list)) return data.result.list;
      previous = `Bybit HTTP ${response.status}, code ${data.retCode ?? "unknown"}: ${data.retMsg ?? "Get kline failed"}`;
      if (response.status !== 429 && response.status < 500 && !transientCode.has(data.retCode ?? -1)) {
        throw new Error(previous);
      }
    } catch (caught) {
      previous = caught instanceof Error ? caught.message : previous;
      // Attempt a bounded retry, then report the failure to the caller.
    }
    if (attempt < 2) await retrySleep(300 * (attempt + 1));
  }
  throw Error(previous);
}

async function barsFor(symbol: string, interval: Interval, cutoff: number, pinned: boolean): Promise<HistoryLoad> {
  const byTime = new Map<number, ReplayBar>();
  const warnings: string[] = [];
  // Fetch backwards from exactly the same historical boundary on every run.
  let end: number | undefined = pinned ? cutoff - 1 : undefined;
  let pages = 0;
  for (let page = 0; page < pagesPerInterval[interval]; page++) {
    let list: BybitCandle[];
    try {
      list = await requestCandles(symbol, interval, end);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "невідома помилка";
      // Never discard valid earlier pages when an older Bybit history page fails.
      // Report partial coverage, not a silent complete backtest.
      if (page === 0 || byTime.size < 150) throw Error(`${interval}: ${message}`);
      warnings.push(`${interval}: історія часткова; сторінка ${page + 1} недоступна (${message}).`);
      break;
    }
    if (!list.length) break;
    pages++;
    let oldest = Infinity;
    for (const c of list) {
      const time = Number(c[0]);
      if (!Number.isFinite(time) || time < 0) continue;
      oldest = Math.min(oldest, time);
      if (!isCompletedBar(time, duration[interval], cutoff)) continue;
      byTime.set(time, {
        time, open: Number(c[1]), high: Number(c[2]), low: Number(c[3]),
        close: Number(c[4]), volume: Number(c[5]), turnover: Number(c[6]),
      });
    }
    if (!Number.isFinite(oldest) || (end !== undefined && oldest >= end)) break;
    end = oldest - 1;
    if (list.length < 1000) break;
  }
  return { bars: [...byTime.values()].sort((a, b) => a.time - b.time), warnings, pages };
}

async function instrumentTickSize(symbol: string): Promise<number> {
  const url = `${PUBLIC_BYBIT_URL}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  const json = await response.json() as { retCode?: number; retMsg?: string;
    result?: { list?: Array<{ symbol: string; priceFilter?: { tickSize?: string } }> } };
  if (!response.ok || json.retCode !== 0) throw Error(`Bybit instrument metadata: ${json.retMsg ?? response.status}`);
  const rawTick = json.result?.list?.find((item) => item.symbol === symbol)?.priceFilter?.tickSize;
  const tick = Number(rawTick);
  if (!rawTick || !Number.isFinite(tick) || !(tick > 0)) throw Error("Bybit не повернув дійсний tickSize контракту.");
  return tick;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") || "").toUpperCase();
  const experimental = params.get("experiment") === "1";
  const pinned = params.get("fixed") === "1";
  const exchangeTicks = params.get("ticks") === "1";
  const snapshotMode = params.get("snapshot") === "auto";
  if (snapshotMode && (!pinned || !exchangeTicks)) {
    return NextResponse.json({ success: false, error: "Знімки потребують fixed=1 і ticks=1." }, { status: 400 });
  }
  if (!symbolPattern.test(symbol)) {
    return NextResponse.json({ success: false, error: "Некоректний інструмент." }, { status: 400 });
  }
  const cacheKey = `${symbol}:${experimental ? "experiment" : "standard"}:${pinned ? "fixed" : "moving"}:${exchangeTicks ? "tick" : "decimal"}:${snapshotMode ? "snapshot" : "live"}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return NextResponse.json(cached.payload);
  try {
    const cutoff = pinned ? COMPARISON_END : Date.now();
    let snapshot = snapshotMode ? await loadSnapshot(symbol, cutoff) : null;
    let tickSize: number | undefined;
    let raw: ReplayTimeframes;
    let warnings: string[];
    let pages: number[];
    if (snapshot) {
      // No Bybit requests on repeated runs: prices, volume, timestamp and tick metadata
      // come from the exact same verified local file.
      raw = snapshot.bars;
      tickSize = snapshot.tickSize;
      warnings = snapshot.warnings;
      pages = snapshot.pages;
    } else {
      const [loaded, currentTick] = await Promise.all([
        Promise.all(intervals.map((interval) => barsFor(symbol, interval, cutoff, pinned))),
        exchangeTicks ? instrumentTickSize(symbol) : Promise.resolve(undefined),
      ]);
      const [halfHour, hourly, fourHour, daily] = loaded.map((item) => item.bars);
      warnings = loaded.flatMap((item) => item.warnings);
      pages = loaded.map((item) => item.pages);
      if (halfHour.length < 150 || hourly.length < 60 || fourHour.length < 60 || daily.length < 60) {
        throw Error("Недостатньо історії Bybit для чотирьох таймфреймів.");
      }
      raw = { "30": halfHour, "60": hourly, "240": fourHour, D: daily };
      tickSize = currentTick;
      if (snapshotMode) {
        if (warnings.length) throw Error("Часткову історію не можна фіксувати як перевірений знімок.");
        snapshot = sealSnapshot({
          schema: 1, symbol, cutoff, source: "bybit-public-linear",
          capturedAt: new Date().toISOString(), tickSize: tickSize!, bars: raw, warnings, pages,
        });
        await persistSnapshot(snapshot);
        // In parallel captures, another immutable snapshot may have won the race.
        snapshot = await loadSnapshot(symbol, cutoff);
        if (!snapshot) throw Error("Знімок не збережено.");
        raw = snapshot.bars;
        tickSize = snapshot.tickSize;
      }
    }
    const result = replayMultiTimeframeStrategy(raw, undefined, "baseline", tickSize);
    // Each hypothesis performs a new replay (with its own pending Limit orders and positions).
    // Never filter completed baseline trades and mistake that for a real strategy variant.
    const experiments = experimental ? REPLAY_VARIANTS.map(({ key, label }) => {
      const run = key === "baseline" ? result : replayMultiTimeframeStrategy(raw, undefined, key, tickSize);
      return { key, label, signals: run.signals, filled: run.filled,
        totalNetR: run.totalNetR, averageNetR: run.averageNetR,
        winRate: run.winRate, maxDrawdownR: run.maxDrawdownR, periods: run.periods, trades: run.trades };
    }) : undefined;
    // These stress runs share the *same frozen candles and tick metadata* with baseline.
    const conservativeExperiments = experimental && tickSize !== undefined
      ? REPLAY_VARIANTS.map(({ key, label }) => {
        const run = replayMultiTimeframeStrategy(raw, undefined, key, tickSize, "conservative");
        return { key, label, signals: run.signals, filled: run.filled, unfilled: run.unfilled,
          totalNetR: run.totalNetR, averageNetR: run.averageNetR,
          winRate: run.winRate, maxDrawdownR: run.maxDrawdownR,
          periods: run.periods, trades: run.trades, assumptions: run.assumptions };
      }) : undefined;
    // Factor isolation uses the exact same saved candles, metadata and baseline strategy.
    // Only change one execution assumption at a time.
    const executionAttribution = experimental && tickSize !== undefined
      ? EXECUTION_STRESS_CASES.map(({ key, label }) => {
        const run = key === "reference" ? result
          : key === "conservative"
            ? replayMultiTimeframeStrategy(raw, undefined, "baseline", tickSize, "conservative")
            : replayMultiTimeframeStrategy(raw, undefined, "baseline", tickSize, key);
        return {
          key, label, signals: run.signals, unfilled: run.unfilled, filled: run.filled,
          totalNetR: run.totalNetR, averageNetR: run.averageNetR,
          winRate: run.winRate, maxDrawdownR: run.maxDrawdownR,
          trades: run.trades, assumptions: run.assumptions,
        };
      }) : undefined;
    const payload = {
      success: true, symbol, warnings, partialHistory: warnings.length > 0,
      comparisonCutoff: cutoff, fixedComparison: pinned, tickSize: tickSize ?? null,
      snapshotSha256: snapshot?.sha256 ?? null,
      snapshotCapturedAt: snapshot?.capturedAt ?? null,
      snapshotStorage: snapshot ? "local-immutable-file" : "not-saved",
      roundingMode: exchangeTicks ? "bybit-tick-size" : "scanner-decimals",
      pages, bars: {
        "30": raw["30"].length, "60": raw["60"].length,
        "240": raw["240"].length, D: raw.D.length,
      },
      ...result, experiments, conservativeExperiments, executionAttribution, trades: result.trades,
    };
    if (cache.size > 50) cache.clear();
    cache.set(cacheKey, { until: Date.now() + 5 * 60_000, payload });
    return NextResponse.json(payload);
  } catch (caught) {
    return NextResponse.json({ success: false,
      error: caught instanceof Error ? caught.message : "Помилка історичних даних." }, { status: 502 });
  }
}
