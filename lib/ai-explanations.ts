import type { TradePlan } from "@/lib/trading";

type Explanation = Pick<TradePlan, "summary" | "caution" | "nextStep">;
export type AiStatus = {
  state: "ok" | "cached" | "fallback" | "no_plans";
  code: string;
  message: string;
  model?: string;
};
type Result = { explanations: Record<string, Explanation>; status: AiStatus };
type ApiResponse = {
  status?: string;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const schema = {
  type: "object", additionalProperties: false, required: ["plans"],
  properties: { plans: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["id", "summary", "caution", "nextStep"],
    properties: {
      id: { type: "string" }, summary: { type: "string" },
      caution: { type: "string" }, nextStep: { type: "string" },
    },
  } } },
};
let cache: { key: string; until: number; explanations: Record<string, Explanation> } | undefined;
function fallback(code: string, message: string, status?: number, requestId?: string | null): Result {
  // Only log controlled metadata. No tokens, raw prompts or response bodies.
  console.error("[Alpha Pulse AI]", { code, status: status ?? null, requestId: requestId?.replace(/[^\w-]/g, "").slice(0, 80) || null });
  return { explanations: {}, status: { state: "fallback", code, message } };
}
function outputText(data: ApiResponse): string {
  if (typeof data.output_text === "string") return data.output_text;
  return data.output?.flatMap((x) => x.content ?? []).filter((x) => x.type === "output_text").map((x) => x.text ?? "").join("") ?? "";
}
function validate(raw: unknown, expected: string[]): Record<string, Explanation> {
  if (!raw || typeof raw !== "object" || !("plans" in raw) || !Array.isArray(raw.plans) || raw.plans.length !== expected.length) throw Error("INVALID_SCHEMA");
  const ids = new Set(expected);
  const result: Record<string, Explanation> = {};
  for (const item of raw.plans) {
    if (!item || typeof item !== "object") throw Error("INVALID_ITEM");
    const { id, summary, caution, nextStep } = item;
    if (typeof id !== "string" || !ids.has(id) || Object.hasOwn(result, id) ||
      typeof summary !== "string" || !summary.trim() || typeof caution !== "string" || !caution.trim() ||
      typeof nextStep !== "string" || !nextStep.trim()) throw Error("INVALID_ITEM");
    result[id] = { summary: summary.trim(), caution: caution.trim(), nextStep: nextStep.trim() };
  }
  return result;
}
export async function createAiExplanations(plans: TradePlan[]): Promise<Result> {
  if (!plans.length) return { explanations: {}, status: { state: "no_plans", code: "NO_PLANS", message: "Немає сценаріїв для пояснення." } };
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return fallback("MISSING_API_KEY", "Сервер не має OPENAI_API_KEY.");
  const facts = plans.map((p) => ({ id: p.id, symbol: p.symbol, direction: p.direction, score: p.score,
    currentPrice: p.currentPrice, entryZone: [p.entryLow, p.entryHigh], stopLoss: p.stopLoss,
    takeProfit: p.takeProfit2, riskReward: p.riskReward, status: p.status, readiness: p.readiness, technicalFacts: p.reasons, invalidation: p.invalidation }));
  const cacheKey = JSON.stringify({ model, facts });
  if (cache && cache.key === cacheKey && cache.until > Date.now()) return { explanations: cache.explanations, status: { state: "cached", code: "CACHE_HIT", message: "AI-пояснення з кешу.", model } };
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, store: false,
        input: [
          { role: "developer", content: "Пояснюй навчальні Bybit Demo Limit-плани українською лише за переданими фактами. Score — евристичний потенціал, НЕ імовірність успіху. Статус ACTIVE означає виконання формальних умов, а REVIEW — непідтверджений сценарій. Для REVIEW обов’язково прямо назви відсутність підтвердження та ключову невиконану умову з readiness.missing; не називай його підтвердженим і не радь негайно відкривати угоду. Для ACTIVE теж не обіцяй прибуток. Для кожного id: summary — два короткі речення, caution — конкретний ризик, nextStep — обережний наступний крок. Без вигаданих показників. Не пропускай id." },
          { role: "user", content: JSON.stringify(facts) },
        ],
        text: { format: { type: "json_schema", name: "trade_explanations", strict: true, schema } },
        max_output_tokens: 3000,
      }),
      cache: "no-store", signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return fallback(timeout ? "TIMEOUT" : "NETWORK_ERROR", timeout ? "OpenAI не відповів за 20 секунд." : "Помилка з’єднання з OpenAI.");
  }
  const requestId = response.headers.get("x-request-id");
  if (!response.ok) {
    const codes: Record<number, [string, string]> = {
      400: ["BAD_REQUEST", "OpenAI відхилив параметри запиту."],
      401: ["AUTH_FAILED", "OpenAI відхилив ключ."],
      403: ["ACCESS_DENIED", "Немає доступу до моделі."],
      404: ["MODEL_NOT_FOUND", "Модель OpenAI недоступна."],
      429: ["RATE_LIMIT", "Ліміт запитів або квота OpenAI вичерпана."],
    };
    const [code, message] = codes[response.status] ?? (response.status >= 500 ? ["OPENAI_SERVER_ERROR", "Сервер OpenAI недоступний."] : ["OPENAI_HTTP_ERROR", "OpenAI повернув помилку."]);
    return fallback(code, message, response.status, requestId);
  }
  try {
    const data = await response.json() as ApiResponse;
    if (data.status !== "completed") throw Error("INCOMPLETE_RESPONSE");
    const explanations = validate(JSON.parse(outputText(data)), plans.map((p) => p.id));
    cache = { key: cacheKey, until: Date.now() + 300000, explanations };
    return { explanations, status: { state: "ok", code: "AI_SUCCESS", message: "AI-пояснення створено.", model } };
  } catch (e) {
    const code = e instanceof SyntaxError ? "INVALID_JSON" : e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : "INVALID_RESPONSE";
    return fallback(code, "OpenAI повернув некоректну або неповну відповідь.", response.status, requestId);
  }
}
