import { NextResponse } from "next/server";
import { PUBLIC_BYBIT_URL } from "@/lib/trading";
import { replayMultiTimeframeStrategy, type ReplayBar, type ReplayTimeframes } from "@/lib/mtf-backtest";

const symbolPattern = /^[A-Z0-9]{3,24}USDT$/;
type BybitCandle = [string, string, string, string, string, string, string];
type Interval = keyof ReplayTimeframes;
const intervals: Interval[] = ["30", "60", "240", "D"];
const duration: Record<Interval, number> = {
  "30": 1_800_000, "60": 3_600_000, "240": 14_400_000, D: 86_400_000,
};
const cache = new Map<string, { until: number; payload: unknown }>();

const pagesPerInterval: Record<Interval, number> = { "30": 6, "60": 4, "240": 2, D: 1 };

async function barsFor(symbol: string, interval: Interval, now: number): Promise<ReplayBar[]> {
  const byTime = new Map<number, ReplayBar>();
  let end: number | undefined;
  for (let page = 0; page < pagesPerInterval[interval]; page++) {
    const params = new URLSearchParams({
      category: "linear", symbol, interval, limit: "1000",
    });
    if (end !== undefined) params.set("end", String(end));
    const response = await fetch(`${PUBLIC_BYBIT_URL}/v5/market/kline?${params.toString()}`, {
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`Bybit: не отримано свічки ${interval} (сторінка ${page + 1}).`);
    const data = await response.json() as {
      retCode: number; result?: { list?: BybitCandle[] }; retMsg?: string;
    };
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw Error(data.retMsg || `Немає історії для ${interval}.`);
    }
    if (!data.result.list.length) break;
    let oldest = Infinity;
    for (const c of data.result.list) {
      const time = Number(c[0]);
      if (!Number.isFinite(time) || time < 0) continue;
      oldest = Math.min(oldest, time);
      if (time + duration[interval] > now) continue;
      byTime.set(time, {
        time, open: Number(c[1]), high: Number(c[2]), low: Number(c[3]),
        close: Number(c[4]), volume: Number(c[5]), turnover: Number(c[6]),
      });
    }
    if (!Number.isFinite(oldest) || (end !== undefined && oldest >= end)) break;
    end = oldest - 1; // Cursor always moves backward. Avoid repeated overlapping pages.
    if (data.result.list.length < 1000) break;
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
  if (!symbolPattern.test(symbol)) {
    return NextResponse.json({ success: false, error: "Некоректний інструмент." }, { status: 400 });
  }
  const cached = cache.get(symbol);
  if (cached && cached.until > Date.now()) return NextResponse.json(cached.payload);
  try {
    const now = Date.now();
    const [halfHour, hourly, fourHour, daily] = await Promise.all(
      intervals.map((interval) => barsFor(symbol, interval, now)),
    );
    if (halfHour.length < 150 || hourly.length < 60 || fourHour.length < 60 || daily.length < 60) {
      throw Error("Недостатньо історії Bybit для чотирьох таймфреймів.");
    }
    const result = replayMultiTimeframeStrategy({
      "30": halfHour, "60": hourly, "240": fourHour, D: daily,
    });
    const payload = {
      success: true, symbol, bars: {
        "30": halfHour.length, "60": hourly.length,
        "240": fourHour.length, D: daily.length,
      },
      ...result, trades: result.trades.slice(-30),
    };
    if (cache.size > 50) cache.clear();
    cache.set(symbol, { until: now + 5 * 60_000, payload });
    return NextResponse.json(payload);
  } catch (caught) {
    return NextResponse.json({ success: false,
      error: caught instanceof Error ? caught.message : "Помилка історичних даних." }, { status: 502 });
  }
}
