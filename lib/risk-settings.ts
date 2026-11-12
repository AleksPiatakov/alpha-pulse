export const RISK_SETTINGS_KEY = "alpha-pulse-risk-settings-v1";

export type RiskSettings = {
  riskPercent: number;
  maxPositions: number;
  maxTotalRiskPercent: number;
  fallbackBalance: number;
};

export const defaultRiskSettings: RiskSettings = {
  riskPercent: 1,
  maxPositions: 3,
  maxTotalRiskPercent: 3,
  fallbackBalance: 1000,
};

const bounded = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeRiskSettings(input: Partial<RiskSettings> | null | undefined): RiskSettings {
  return {
    riskPercent: bounded(Number(input?.riskPercent), 0.1, 10, defaultRiskSettings.riskPercent),
    maxPositions: Math.round(bounded(Number(input?.maxPositions), 1, 20, defaultRiskSettings.maxPositions)),
    maxTotalRiskPercent: bounded(Number(input?.maxTotalRiskPercent), 0.1, 25, defaultRiskSettings.maxTotalRiskPercent),
    fallbackBalance: bounded(Number(input?.fallbackBalance), 1, 10_000_000, defaultRiskSettings.fallbackBalance),
  };
}

export function calculatePosition(input: { balance: number; activeCount: number; settings: RiskSettings; entryPrice: number; stopLoss: number; takeProfit: number }) {
  const { balance, activeCount, settings, entryPrice, stopLoss, takeProfit } = input;
  const riskPerPlan = balance * settings.riskPercent / 100;
  const totalRiskCap = balance * settings.maxTotalRiskPercent / 100;
  const remainingPortfolioRisk = Math.max(0, totalRiskCap - activeCount * riskPerPlan);
  const allowedRisk = Math.min(riskPerPlan, remainingPortfolioRisk);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const quantity = stopDistance > 0 ? allowedRisk / stopDistance : 0;
  const notional = quantity * entryPrice;
  const potentialProfit = quantity * Math.abs(takeProfit - entryPrice);
  const slotsRemaining = Math.max(0, settings.maxPositions - activeCount);
  return { riskPerPlan, totalRiskCap, remainingPortfolioRisk, allowedRisk, stopDistance, quantity, notional, potentialProfit, slotsRemaining, canOpen: slotsRemaining > 0 && allowedRisk >= 0.01 && quantity > 0 };
}
