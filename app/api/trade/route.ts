import { NextResponse } from "next/server";
import { bybitDemoRequest, isDemoTradingEnabled, DEMO_BYBIT_URL } from "@/lib/trading";
import { parseExecutionRules, validateOrderPrecision } from "@/lib/bybit-execution-rules";
import type { InstrumentMeta } from "@/lib/bybit-universe";
import { verifyCurrentTechnicalPlan } from "@/lib/market-scan";
import { GET as getDemoAccount } from "@/app/api/account/route";

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
  if (!isDemoTradingEnabled()) return error("Виставлення заявок доступне лише за BYBIT_ENV=demo.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    const side = body.side === "Buy" || body.side === "Sell" ? body.side : null;
    const qty = positiveNumber(body.qty), price = positiveNumber(body.entryPrice), stopLoss = positiveNumber(body.stopLoss), takeProfit = positiveNumber(body.takeProfit);
    if (!symbolPattern.test(symbol) || !side || !qty || !price || !stopLoss || !takeProfit) return error("Неповний або некоректний торговий план.");
    if ((side === "Buy" && !(stopLoss < price && takeProfit > price)) || (side === "Sell" && !(stopLoss > price && takeProfit < price))) return error("Stop-loss або take-profit не відповідають напрямку позиції.");
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return error("Не передано ідентифікатор плану. Оновіть сторінку.", 409);

    // The browser cannot authorize prices, stop/target levels or risk on its own.
    // Recalculate this exact Bybit symbol independently, including REVIEW limit setups.
    const verified = await verifyCurrentTechnicalPlan(symbol);
    const plan = verified?.id === planId ? verified : null;
    if (!plan || plan.status === "INVALID" || new Date(plan.expiresAt).getTime() <= Date.now()) {
      return error("Торговий план застарів або більше не входить до актуального відбору.", 409);
    }
    const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-9);
    if (side !== (plan.direction === "LONG" ? "Buy" : "Sell") ||
        !same(price, plan.entryPrice) ||
        !same(stopLoss, plan.stopLoss) ||
        !same(takeProfit, plan.takeProfit2) ||
        plan.riskReward < 0.5) {
      return error("Дані заявки не відповідають поточному серверному плану. Оновіть сторінку.", 409);
    }

    // Independent fresh exchange precision check; no order if metadata is missing.
    const metaResponse = await fetch(
      `${DEMO_BYBIT_URL}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`,
      { cache: "no-store", signal: AbortSignal.timeout(12000) },
    );
    if (!metaResponse.ok) return error("Bybit: неможливо перевірити точність ордера.", 503);
    const metadata = await metaResponse.json() as {
      retCode?: number; result?: { list?: InstrumentMeta[] };
    };
    if (metadata.retCode !== 0) return error("Bybit: не вдалося перевірити параметри інструмента.", 503);
    const instrument = metadata.result?.list?.find((item) => item.symbol === symbol);
    const rules = parseExecutionRules(instrument);
    if (!rules) return error("Немає достовірних tickSize/qtyStep для інструмента.", 503);
    const precisionErrors = validateOrderPrecision({
      entry: price, stop: stopLoss, target: takeProfit, quantity: qty,
    }, rules);
    if (precisionErrors.length) return error(precisionErrors.join(" "), 409);

    const accountResponse = await getDemoAccount();
    if (!accountResponse.ok) return error("Неможливо підтвердити Demo-баланс і ризик. Заявку заблоковано.", 503);
    const account = await accountResponse.json() as { success?: boolean; balance?: number; availableBalance?: number | null; activeCount?: number };
    const equity = account.balance ?? 0;
    const activeCount = account.activeCount ?? 0;
    if (!account.success || !Number.isFinite(equity) || equity <= 0 || !Number.isInteger(activeCount) || activeCount < 0) {
      return error("Недоступні достовірні дані Demo-рахунку.", 503);
    }
    if (activeCount >= 3) return error("Досягнуто серверного ліміту: 3 активні позиції або заявки.", 409);
    const freeMargin = account.availableBalance;
    if (typeof freeMargin !== "number" || !Number.isFinite(freeMargin) || freeMargin <= 0) {
      return error("Bybit не повернув доступну маржу. Безпечний розмір Demo-заявки не підтверджено.", 503);
    }
    // Never rely on browser position sizing. Conservative 1x cap; no assumed leverage.
    const notional = qty * price;
    if (!Number.isFinite(notional) || notional > freeMargin + 1e-6) {
      return error("Номінал Demo-заявки перевищує доступну маржу Bybit (ліміт 1x).", 409);
    }
    const expectedRisk = qty * Math.abs(price - stopLoss);
    if (!Number.isFinite(expectedRisk) || expectedRisk > equity * 0.01 + 1e-8) {
      return error("Ризик заявки перевищує серверний ліміт 1% Demo-балансу.", 409);
    }
    if (expectedRisk < 0.01) return error("Ризик заявки занадто малий.", 400);
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
