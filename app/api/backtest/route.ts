import { NextResponse } from "next/server";
import { PUBLIC_BYBIT_URL } from "@/lib/trading";
import { replayHourlyLimitStrategy, type HistoryBar } from "@/lib/backtest";

const symbolPattern = /^[A-Z0-9]{3,24}USDT$/;
type BybitCandle = [string, string, string, string, string, string];
let cache = new Map<string, { until: number; payload: unknown }>();

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
  if (!symbolPattern.test(symbol)) return NextResponse.json({ success: false, error: "Некоректний інструмент." }, { status: 400 });
  const cached = cache.get(symbol);
  if (cached && cached.until > Date.now()) return NextResponse.json(cached.payload);
  try {
    const response = await fetch(`${PUBLIC_BYBIT_URL}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=60&limit=1000`, {
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("Bybit відхилив запит історії.");
    const data = await response.json() as { retCode: number; result?: { list?: BybitCandle[] }; retMsg?: string };
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) throw Error(data.retMsg || "Історія недоступна.");
    const now = Date.now();
    const bars: HistoryBar[] = [...data.result.list].reverse().map((c) => ({
      time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]),
    })).filter((b) => b.time + 3_600_000 <= now);
    if (bars.length < 120) throw Error("Замало закритих свічок для діагностичної перевірки.");
    const result = replayHourlyLimitStrategy(bars);
    const payload = { success: true, symbol, bars: bars.length, from: bars[0].time, to: bars.at(-1)!.time,
      ...result, trades: result.trades.slice(-20) };
    if (cache.size > 50) cache.clear();
    cache.set(symbol, { until: now + 5 * 60_000, payload });
    return NextResponse.json(payload);
  } catch (caught) {
    return NextResponse.json({ success: false, error: caught instanceof Error ? caught.message : "Помилка історичних даних." }, { status: 502 });
  }
}
