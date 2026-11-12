/**
 * Explanations only: this module never changes exchange order behavior.
 * A closed-candle thesis check must never be mistaken for a protective stop trigger.
 */
export type PlanSide = "LONG" | "SHORT";
export type PlanLifecycle = {
  setupReview: string;
  stopProtection: string;
  pendingLimit: string;
};
export function explainPlanLifecycle(direction: PlanSide, stop: number): PlanLifecycle {
  if (!Number.isFinite(stop) || stop <= 0) throw new Error("Invalid protective stop");
  const relation = direction === "LONG" ? "нижче" : "вище";
  return {
    setupReview: `До виконання входу: закриття 1h свічки ${relation} ${stop} вимагає скасування або повторної оцінки торгової ідеї.`,
    stopProtection: `Після відкриття позиції: захисний Stop Loss встановлено на ${stop}, тригер Bybit MarkPrice. Він може спрацювати до закриття 1h свічки; фактична ціна виконання може відрізнятися.`,
    pendingLimit: "Limit-заявка в Demo зараз використовує GTC і не скасовується автоматично після завершення терміну актуальності сценарію. Її необхідно контролювати та скасовувати окремо.",
  };
}
