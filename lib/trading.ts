import crypto from "crypto";
import { serverEnv } from "@/lib/server-env";
import { roundPlanPrice } from "./technical-plan-core.ts";

export const DEMO_BYBIT_URL = "https://api-demo.bybit.com";
export const PUBLIC_BYBIT_URL = "https://api.bybit.com";
export type PlanDirection = "LONG" | "SHORT";
export interface TradePlan {
  id: string; symbol: string; direction: PlanDirection; score: number; currentPrice: number;
  entryPrice: number; entryLow: number; entryHigh: number; stopLoss: number;
  takeProfit1: number; takeProfit2: number; riskReward: number; expiresAt: string;
  readiness?: { met: number; total: number; missing: string[] };
  qualityGate?: { passed: boolean; reasons: string[]; policy: "intraday-quality-v1"; stopAtr: number | null; rewardRisk: number | null };
  lifecycle?: { setupReview: string; stopProtection: string; pendingLimit: string };
  reasons: string[]; summary: string; caution: string; nextStep: string; explanationSource: "rule" | "ai"; invalidation: string; status: "ACTIVE" | "REVIEW" | "INVALID";
}
export function isDemoEnvironment() { return serverEnv("BYBIT_ENV") === "demo"; }
export function isDemoTradingEnabled() { return isDemoEnvironment(); }
export function getDemoCredentials() {
  const apiKey = serverEnv("BYBIT_API_KEY"); const apiSecret = serverEnv("BYBIT_API_SECRET");
  if (!apiKey || !apiSecret) throw new Error("Demo API ключі Bybit не налаштовані на сервері.");
  return { apiKey, apiSecret };
}
export async function bybitDemoRequest<T>(path: string, method: "GET" | "POST", payload?: string): Promise<T> {
  const { apiKey, apiSecret } = getDemoCredentials(); const timestamp = Date.now().toString(); const recvWindow = "5000";
  const signature = crypto.createHmac("sha256", apiSecret).update(timestamp + apiKey + recvWindow + (payload ?? "")).digest("hex");
  const response = await fetch(`${DEMO_BYBIT_URL}${path}`, { method, headers: { "Content-Type": "application/json", "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-SIGN": signature, "X-BAPI-RECV-WINDOW": recvWindow }, body: method === "POST" ? payload : undefined, cache: "no-store" });
  const data = (await response.json()) as T & { retCode?: number; retMsg?: string };
  if (!response.ok || data.retCode !== 0) throw new Error(data.retMsg || "Bybit API повернув помилку.");
  return data;
}
export const roundPrice = roundPlanPrice;
