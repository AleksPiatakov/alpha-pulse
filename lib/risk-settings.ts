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

export function calculatePosition(input: {
  balance: number; activeCount: number; settings: RiskSettings;
  entryPrice: number; stopLoss: number; takeProfit: number;
  availableBalance?: number;
}) {
  const { balance, activeCount, settings, entryPrice, stopLoss, takeProfit } = input;
  // Cap notional to available USDT (1x conservative assumption); leverage is not inferred.
  // Clients must never substitute a guessed balance when authorizing an order.
  const available = Number.isFinite(input.availableBalance) && (input.availableBalance ?? 0) >= 0
    ? input.availableBalance! : balance;
  const valid = [balance, available, entryPrice, stopLoss, takeProfit].every(Number.isFinite) &&
    balance > 0 && available > 0 && entryPrice > 0 && stopLoss > 0 && takeProfit > 0;
  const riskPerPlan = valid ? balance * settings.riskPercent / 100 : 0;
  const totalRiskCap = valid ? balance * settings.maxTotalRiskPercent / 100 : 0;
  const remainingPortfolioRisk = Math.max(0, totalRiskCap - activeCount * riskPerPlan);
  const allowedRisk = Math.min(riskPerPlan, remainingPortfolioRisk);
  const stopDistance = valid ? Math.abs(entryPrice - stopLoss) : 0;
  const quantityByRisk = stopDistance > 0 ? allowedRisk / stopDistance : 0;
  const quantityByMargin = valid ? available / entryPrice : 0;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByMargin));
  const notional = quantity * entryPrice;
  const actualRisk = quantity * stopDistance;
  const potentialProfit = quantity * Math.abs(takeProfit - entryPrice);
  const slotsRemaining = Math.max(0, settings.maxPositions - activeCount);
  const canOpen = valid && slotsRemaining > 0 && actualRisk >= 0.01 && quantity > 0;
  return { riskPerPlan, totalRiskCap, remainingPortfolioRisk, allowedRisk, stopDistance,
    quantity, notional, actualRisk, potentialProfit, slotsRemaining,
    cappedByMargin: quantityByMargin < quantityByRisk, availableBalance: available, canOpen };
}
