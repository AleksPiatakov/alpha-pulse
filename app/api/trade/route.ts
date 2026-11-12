import { NextResponse } from "next/server";
import { bybitDemoRequest, isDemoTradingEnabled } from "@/lib/trading";

const symbolPattern = /^[A-Z0-9]{3,24}USDT$/;
const error = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const positiveNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
  if (symbol && !symbolPattern.test(symbol)) return error("Некоректний символ.");
  try {
    const query = symbol ? `category=linear&symbol=${symbol}` : "category=linear&settleCoin=USDT&openOnly=0&limit=50";
    const response = await bybitDemoRequest<{ result: { list: unknown[] } }>(`/v5/order/realtime?${query}`, "GET", query);
    return NextResponse.json({ success: true, list: response.result.list, environment: "demo" });
  } catch (caught) { return error(caught instanceof Error ? caught.message : "Помилка синхронізації Bybit.", 502); }
}

export async function POST(request: Request) {
  if (!isDemoTradingEnabled()) return error("Виставлення заявок вимкнене. Увімкніть лише Demo-режим через BYBIT_ENV=demo і BYBIT_TRADING_ENABLED=true.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    const side = body.side === "Buy" || body.side === "Sell" ? body.side : null;
    const qty = positiveNumber(body.qty), price = positiveNumber(body.entryPrice), stopLoss = positiveNumber(body.stopLoss), takeProfit = positiveNumber(body.takeProfit);
    if (!symbolPattern.test(symbol) || !side || !qty || !price || !stopLoss || !takeProfit) return error("Неповний або некоректний торговий план.");
    if ((side === "Buy" && !(stopLoss < price && takeProfit > price)) || (side === "Sell" && !(stopLoss > price && takeProfit < price))) return error("Stop-loss або take-profit не відповідають напрямку позиції.");
    const payload = JSON.stringify({ category: "linear", symbol, side, orderType: "Limit", qty: String(qty), price: String(price), timeInForce: "GTC", positionIdx: 0, stopLoss: String(stopLoss), takeProfit: String(takeProfit), tpTriggerBy: "MarkPrice", slTriggerBy: "MarkPrice", orderLinkId: `ap-${Date.now()}` });
    const response = await bybitDemoRequest<{ result: { orderId: string; orderLinkId: string } }>("/v5/order/create", "POST", payload);
    return NextResponse.json({ success: true, data: response.result, environment: "demo" });
  } catch (caught) { return error(caught instanceof Error ? caught.message : "Не вдалося поставити заявку.", 502); }
}

export async function DELETE(request: Request) {
  if (!isDemoTradingEnabled()) return error("Виставлення заявок вимкнене.", 403);
  try {
    const body = await request.json() as { symbol?: unknown; orderId?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "", orderId = typeof body.orderId === "string" ? body.orderId : "";
    if (!symbolPattern.test(symbol) || !orderId) return error("Некоректні дані для скасування.");
    const payload = JSON.stringify({ category: "linear", symbol, orderId });
    const response = await bybitDemoRequest<{ result: { orderId: string } }>("/v5/order/cancel", "POST", payload);
    return NextResponse.json({ success: true, data: response.result, environment: "demo" });
  } catch (caught) { return error(caught instanceof Error ? caught.message : "Не вдалося скасувати заявку.", 502); }
}
