import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TradePlan } from "@/lib/trading";

type Explanation = Pick<TradePlan, "summary" | "caution" | "nextStep">;
let cache: { until: number; explanations: Record<string, Explanation> } | undefined;

function responseText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = data.output as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> | undefined;
  return output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "";
}

function getApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const envFile = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    return envFile.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}

export async function createAiExplanations(plans: TradePlan[]): Promise<Record<string, Explanation>> {
  const apiKey = getApiKey();
  if (!apiKey || plans.length === 0) return {};
  if (cache && cache.until > Date.now()) return cache.explanations;
  const facts = plans.map((plan) => ({ id: plan.id, symbol: plan.symbol, direction: plan.direction, score: plan.score, currentPrice: plan.currentPrice, entryZone: [plan.entryLow, plan.entryHigh], stopLoss: plan.stopLoss, takeProfit1: plan.takeProfit1, takeProfit2: plan.takeProfit2, riskReward: plan.riskReward, technicalFacts: plan.reasons, invalidation: plan.invalidation }));
  const prompt = `Ти пояснюєш шість навчальних demo-trading планів українською для новачка. Працюй ВИКЛЮЧНО з фактами нижче. Не обіцяй прибуток, не називай сигнал гарантованим, не вигадуй новини, рівні або індикатори. Для кожного плану напиши різний, конкретний текст: summary — максимум 2 короткі речення, чому пара потрапила у відбір і чому це відкладений, а не ринковий вхід; caution — 1 коротке речення про головний ризик саме цього плану; nextStep — 1 коротка дія перед постановкою Demo Limit. Поверни ТІЛЬКИ JSON-масив об'єктів {"id","summary","caution","nextStep"}.\n\nФакти:\n${JSON.stringify(facts)}`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: "gpt-6-luna", input: [{ role: "developer", content: "Пиши нейтрально, коротко й зрозуміло. Це навчальний інтерфейс, не фінансова порада." }, { role: "user", content: prompt }], max_output_tokens: 1200 }), cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return {};
    const data = await response.json() as Record<string, unknown>;
    const parsed = JSON.parse(responseText(data).replace(/^```json\s*|\s*```$/g, "")) as Array<{ id?: string; summary?: string; caution?: string; nextStep?: string }>;
    const explanations = Object.fromEntries(parsed.filter((item) => typeof item.id === "string" && typeof item.summary === "string" && typeof item.caution === "string" && typeof item.nextStep === "string").map((item) => [item.id!, { summary: item.summary!, caution: item.caution!, nextStep: item.nextStep! }]));
    cache = { until: Date.now() + 5 * 60_000, explanations };
    return explanations;
  } catch { return {}; }
}
