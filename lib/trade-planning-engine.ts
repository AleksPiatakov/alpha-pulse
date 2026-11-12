/**
 * Pure, deterministic planning primitives used by scanner and historical replay.
 * Does not fetch data, trade, estimate fills or claim a verified trading edge.
 */
import {
  nearestAcrossTimeframes, stopFromAtr, structuralTarget, roundedPlanLevels,
  type PriceBar, type TechnicalDirection,
} from "./technical-plan-core.ts";
import { evaluateScenarioQuality, type QualityInput } from "./scenario-quality.ts";
import { evaluateIntradayPlan } from "./intraday-quality.ts";

export type PlanningLevelsInput = {
  direction: TechnicalDirection;
  currentPrice: number;
  atr30m: number;
  atr1h: number;
  supportLevels: Array<number | null>;
  dailyBars: PriceBar[];
  // Scanner fallback remains REVIEW only; replay requires a confirmed level.
  fallbackEntry?: number;
  tickSize?: number;
};
export type PlannedLevels = {
  entry: number; stop: number; target: number; rewardRisk: number;
  distanceAtr: number; confirmedEntry: boolean; confirmedTarget: boolean;
};
export function calculatePlanningLevels(input: PlanningLevelsInput): PlannedLevels | null {
  if (![input.currentPrice, input.atr30m, input.atr1h].every(Number.isFinite) ||
      input.currentPrice <= 0 || input.atr30m <= 0 || input.atr1h <= 0) return null;
  const structuralEntry = nearestAcrossTimeframes(input.supportLevels, input.direction);
  const rawEntry = structuralEntry ?? input.fallbackEntry;
  if (!(rawEntry !== undefined && Number.isFinite(rawEntry) && rawEntry > 0)) return null;
  const stop = stopFromAtr(input.direction, rawEntry, input.atr1h, input.atr30m);
  if (!(stop > 0)) return null;
  const targetLevel = structuralTarget(input.direction, rawEntry, stop, input.dailyBars);
  const risk = Math.abs(rawEntry - stop);
  const rawTarget = targetLevel ?? rawEntry + (input.direction === "LONG" ? 2.4 : -2.4) * risk;
  const levels = roundedPlanLevels(input.direction, rawEntry, stop, rawTarget, input.tickSize);
  if (!levels) return null;
  return {
    entry: levels.entry, stop: levels.stop, target: levels.target,
    rewardRisk: levels.rr,
    distanceAtr: Math.abs(input.currentPrice - rawEntry) / input.atr30m,
    confirmedEntry: structuralEntry !== null,
    confirmedTarget: targetLevel !== null,
  };
}
export type PlanningAssessmentInput = {
  levels: PlannedLevels; quality: Omit<QualityInput, "rewardRisk" | "distanceAtr" | "hasTargetLevel">;
  atr30m: number; direction: TechnicalDirection; tickSize?: number;
};
export function assessPlanningLevels(input: PlanningAssessmentInput) {
  const scenario = evaluateScenarioQuality({
    ...input.quality, rewardRisk: input.levels.rewardRisk,
    distanceAtr: input.levels.distanceAtr, hasTargetLevel: input.levels.confirmedTarget,
  });
  const gate = evaluateIntradayPlan({
    direction: input.direction,
    entry: input.levels.entry, stop: input.levels.stop, target: input.levels.target,
    atr30m: input.atr30m, distanceAtr: input.levels.distanceAtr,
    score: scenario.score, readiness: scenario.confirmedConditions,
    rewardRisk: input.levels.rewardRisk, tickSize: input.tickSize,
  });
  return { scenario, gate };
}
