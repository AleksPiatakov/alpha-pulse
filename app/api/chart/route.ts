import { NextResponse } from "next/server";
import { PUBLIC_BYBIT_URL } from "@/lib/trading";

const symbolPattern = /^[A-Z0-9]{3,24}USDT$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  const interval = url.searchParams.get("interval") || "60";
  if (!symbolPattern.test(symbol)) return NextResponse.json({ success: false, error: "Некоректний символ." }, { status: 400 });
  if (!new Set(["1", "5", "15", "30", "60", "240", "D"]).has(interval)) return NextResponse.json({ success: false, error: "Некоректний таймфрейм." }, { status: 400 });
  try {
    const response = await fetch(`${PUBLIC_BYBIT_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=120`, { cache: "no-store" });
    const data = await response.json() as { retCode: number; retMsg?: string; result?: { list?: string[][] } };
    if (!response.ok || data.retCode !== 0 || !data.result?.list) throw new Error(data.retMsg || "Bybit не повернув свічки.");
    const candles = data.result.list.reverse().map(([time, open, high, low, close]) => ({ time: Number(time), open: Number(open), high: Number(high), low: Number(low), close: Number(close) }));
    return NextResponse.json({ success: true, candles });
  } catch (caught) { return NextResponse.json({ success: false, error: caught instanceof Error ? caught.message : "Помилка завантаження графіка." }, { status: 502 }); }
}
