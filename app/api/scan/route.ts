import { NextResponse } from "next/server";
import { DEMO_BYBIT_URL, roundPrice, type PlanDirection, type TradePlan } from "@/lib/trading";
import { createAiExplanations } from "@/lib/ai-explanations";

type Ticker = { symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string };
type Candle = [string, string, string, string, string, string];
type Interval = "30" | "60" | "240" | "D";

const ema = (values: number[], period: number) => values.slice(1).reduce((result, value) => value * (2 / (period + 1)) + result * (1 - 2 / (period + 1)), values[0]);
const directionLabel = (direction: PlanDirection) => direction === "LONG" ? "вище" : "нижче";

function atr(candles: Candle[]) {
  const ranges = candles.slice(-15).map((candle, index, values) => {
    const high = Number(candle[2]), low = Number(candle[3]), previous = index === 0 ? Number(candle[4]) : Number(values[index - 1][4]);
    return Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function trend(candles: Candle[], marketPrice: number): PlanDirection | null {
  const closes = candles.map((candle) => Number(candle[4]));
  const fast = ema(closes.slice(-25), 20), slow = ema(closes, 50);
  if (marketPrice > fast && fast > slow) return "LONG";
  if (marketPrice < fast && fast < slow) return "SHORT";
  return null;
}

function structuralTarget(direction: PlanDirection, fallback: number, dailyCandles: Candle[]) {
  const lows = dailyCandles.map((candle) => Number(candle[3]));
  const highs = dailyCandles.map((candle) => Number(candle[2]));
  // Never project a first extension through the 200-day extreme without a confirmed breakout.
  return direction === "SHORT" ? Math.max(fallback, Math.min(...lows) * 1.003) : Math.min(fallback, Math.max(...highs) * .997);
}

async function candlesFor(symbol: string, interval: Interval) {
  const limit = interval === "D" ? 200 : 60;
  const response = await fetch(`${DEMO_BYBIT_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`, { cache: "no-store" });
  const data = await response.json() as { retCode: number; result?: { list?: Candle[] } };
  const candles = data.result?.list?.reverse();
  return data.retCode === 0 && candles && candles.length >= 50 ? candles : null;
}

async function makePlan(ticker: Ticker): Promise<TradePlan | null> {
  const [candles30, candles1h, candles4h, dailyCandles] = await Promise.all([candlesFor(ticker.symbol, "30"), candlesFor(ticker.symbol, "60"), candlesFor(ticker.symbol, "240"), candlesFor(ticker.symbol, "D")]);
  if (!candles30 || !candles1h || !candles4h || !dailyCandles) return null;
  const price = Number(ticker.lastPrice), change = Number(ticker.price24hPcnt);
  const direction4h = trend(candles4h, price), direction1h = trend(candles1h, price), direction30m = trend(candles30, price);
  if (!Number.isFinite(price) || !direction4h || direction4h !== direction1h || direction1h !== direction30m) return null;
  const direction = direction1h;
  const volatility1h = atr(candles1h), volatility30m = atr(candles30);
  const averageVolume = candles1h.slice(-31, -1).reduce((sum, candle) => sum + Number(candle[5]), 0) / 30;
  const relativeVolume = Number(candles1h.at(-1)?.[5] ?? 0) / averageVolume;
  const entryEma30m = ema(candles30.map((candle) => Number(candle[4])).slice(-25), 20);
  if (!Number.isFinite(volatility1h) || volatility1h <= 0 || !Number.isFinite(volatility30m) || volatility30m <= 0 || !Number.isFinite(relativeVolume)) return null;
  if ((direction === "LONG" && change <= .003) || (direction === "SHORT" && change >= -.003)) return null;
  const entry = direction === "LONG" ? Math.min(entryEma30m, price - volatility30m * .25) : Math.max(entryEma30m, price + volatility30m * .25);
  const zoneHalfWidth = volatility30m * .45;
  const risk = Math.max(volatility1h * 1.25, volatility30m * 2);
  const stopLoss = direction === "LONG" ? entry - risk : entry + risk;
  const rawTakeProfit2 = direction === "LONG" ? entry + risk * 2.4 : entry - risk * 2.4;
  const takeProfit2 = structuralTarget(direction, rawTakeProfit2, dailyCandles);
  const roundedStop = roundPrice(stopLoss);
  const roundedTarget = roundPrice(takeProfit2);
  const actualRisk = Math.abs(entryPrice - roundedStop);
  const actualReward = direction === "LONG" ? roundedTarget - entryPrice : entryPrice - roundedTarget;
  if (!(actualRisk > 0 && actualReward > 0)) return null;
  const actualRR = actualReward / actualRisk;
  if (actualRR < 1.5) return null;
  const score = Math.min(95, Math.round(62 + Math.min(Math.abs(change) * 550, 14) + Math.min(relativeVolume * 5, 10) + 9));
  const entryPrice = roundPrice(entry);
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
    reasons: [`4h тренд: ціна ${directionLabel(direction)} EMA20 і EMA50`, `1h структура: ціна ${directionLabel(direction)} EMA20 і EMA50`, `30m підтвердження входу: ${direction}`, `Take-profit обмежено 1D підтримкою/опором`, `24h імпульс ${(change * 100).toFixed(2)}% · обсяг ${relativeVolume.toFixed(1)}×`],
    summary: `4h, 1h і 30m узгоджені для ${direction}. Limit-вхід очікує повернення ціни до ${entryPrice}.`,
    caution,
    nextStep: "Дочекайтеся Limit-зони; автоаналіз скасує рекомендацію, якщо таймфрейми розійдуться.",
    explanationSource: "rule",
    invalidation: direction === "LONG" ? `1h закриття нижче ${roundPrice(stopLoss)}` : `1h закриття вище ${roundPrice(stopLoss)}`,
    status: "ACTIVE",
  };
}

export async function scanTechnicalPlans() {
  const response = await fetch(`${DEMO_BYBIT_URL}/v5/market/tickers?category=linear`, { cache: "no-store" });
  if (!response.ok) throw new Error("Bybit market unavailable.");
  const data = await response.json() as { retCode: number; retMsg?: string; result?: { list?: Ticker[] } };
  if (data.retCode !== 0 || !data.result?.list) throw new Error(data.retMsg || "Не вдалося отримати ринок Bybit.");
  const eligible = data.result.list.filter((ticker) => ticker.symbol.endsWith("USDT") && Number(ticker.turnover24h) >= 20_000_000);
  const analyzed = eligible.sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h)).slice(0, 18);
  const plans = (await Promise.all(analyzed.map(makePlan))).filter((plan): plan is TradePlan => plan !== null).sort((a, b) => b.score - a.score).slice(0, 6);
  return { plans, scanned: data.result.list.length, eligible: eligible.length, analyzed: analyzed.length };
}

export async function GET() {
  try {
    const { plans, scanned, eligible, analyzed } = await scanTechnicalPlans();
    const ai = await createAiExplanations(plans);
    const enrichedPlans = plans.map((plan) => ai.explanations[plan.id] ? { ...plan, ...ai.explanations[plan.id], explanationSource: "ai" as const } : plan);
    return NextResponse.json({ success: true, scanned, eligible, analyzed, plans: enrichedPlans, aiStatus: ai.status, generatedAt: new Date().toISOString() });
  } catch (caught) {
    return NextResponse.json({ success: false, error: caught instanceof Error ? caught.message : "Помилка сканування." }, { status: 502 });
  }
}
