/**
 * Research-only intraday setup gate, applied after a signal is calculated.
 * Thresholds are hypotheses, not calibrated estimates of future win probability.
 * No order placement or external services.
 */
export type IntradayPlan = {
  direction: "LONG" | "SHORT";
  entry: number; stop: number; target: number;
  tickSize?: number;
  atr30m: number;
  distanceAtr: number;
  score: number;
  readiness: number;
  rewardRisk: number;
};
export type IntradayDecision = { accepted: boolean; reasons: string[]; stopAtr: number; rewardRisk: number };
export const INTRADAY_POLICY_V1 = {
  minRR: 2,
  minScore: 90,
  minReadiness: 8,
  maxDistanceAtr: 0.75,
  minStopAtr: 0.8,
  maxStopAtr: 3,
  maxPendingBars30m: 6,
  maxHoldingBars30m: 48,
} as const;
export function evaluateIntradayPlan(plan: IntradayPlan): IntradayDecision {
  const reasons: string[] = [];
  const { direction, entry, stop, target, tickSize, atr30m, rewardRisk, score, readiness, distanceAtr } = plan;
  const valid = [entry, stop, target, atr30m, distanceAtr, score, readiness, rewardRisk].every(Number.isFinite) &&
    entry > 0 && stop > 0 && target > 0 && atr30m > 0 &&
    (direction === "LONG" ? stop < entry && target > entry : stop > entry && target < entry);
  if (!valid) return { accepted: false, reasons: ["Некоректні ціни або ATR."], stopAtr: NaN, rewardRisk: NaN };
  const stopAtr = Math.abs(entry - stop) / atr30m;
  const rr = Math.abs(target - entry) / Math.abs(entry - stop);
  if (tickSize !== undefined &&
      (!(tickSize > 0 && Number.isFinite(tickSize)) ||
        [entry, stop, target].some((price) => Math.abs(price / tickSize - Math.round(price / tickSize)) > 1e-6))) {
    reasons.push("Ціни не відповідають біржовому кроку.");
  }
  if (score < INTRADAY_POLICY_V1.minScore) reasons.push("Недостатня оцінка сигналу.");
  if (readiness < INTRADAY_POLICY_V1.minReadiness) reasons.push("Не всі умови готовності виконані.");
  if (distanceAtr > INTRADAY_POLICY_V1.maxDistanceAtr) reasons.push("Ціна занадто далеко від входу.");
  if (stopAtr < INTRADAY_POLICY_V1.minStopAtr) reasons.push("Стоп надто вузький щодо волатильності.");
  if (stopAtr > INTRADAY_POLICY_V1.maxStopAtr) reasons.push("Стоп надто широкий щодо волатильності.");
  if (rr < INTRADAY_POLICY_V1.minRR || rewardRisk < INTRADAY_POLICY_V1.minRR - 1e-6) {
    reasons.push("Недостатня потенційна винагорода відносно ризику.");
  }
  return { accepted: reasons.length === 0, reasons, stopAtr, rewardRisk: rr };
}
