/**
 * Strategy Lab research metrics. Each symbol is an independent backtest.
 * Summing R is descriptive only: it is not a portfolio equity curve.
 */
export type LabTrade = { netR: number; result: "TP" | "SL" | "TIMEOUT"; signalTime: number };
export type LabRun = {
  key: string; label: string; filled: number; totalNetR: number;
  averageNetR: number | null; maxDrawdownR: number;
  trades: LabTrade[];
  periods: Array<{ totalNetR: number; trades: number }>;
};
export type LabAssessment = {
  trades: number; totalNetR: number; meanR: number | null; profitFactor: number | null;
  stopRate: number | null; firstHalfR: number; secondHalfR: number;
  profitableSymbols: number; testedSymbols: number; eligibleForDemoReview: false;
  reasons: string[];
};
export function assessLabRuns(runs: LabRun[]): LabAssessment {
  const trades = runs.flatMap((run) => run.trades ?? []);
  const grossProfit = trades.reduce((sum, trade) => sum + Math.max(0, trade.netR), 0);
  const grossLoss = trades.reduce((sum, trade) => sum + Math.max(0, -trade.netR), 0);
  const totalNetR = trades.reduce((sum, trade) => sum + trade.netR, 0);
  const firstHalfR = runs.reduce((sum, run) => sum + (run.periods?.[0]?.totalNetR ?? 0), 0);
  const secondHalfR = runs.reduce((sum, run) => sum + (run.periods?.[1]?.totalNetR ?? 0), 0);
  const profitableSymbols = runs.filter((run) => run.totalNetR > 0).length;
  const reasons = [
    "Ця вибірка вже використовувалась для розробки: не є незалежним holdout.",
    "Сума R по інструментах не враховує одночасні позиції та кореляції.",
  ];
  if (trades.length < 100) reasons.push("Менше 100 виконаних угод: висока невизначеність.");
  if (totalNetR <= 0) reasons.push("Сумарне очікування на досліджуваній історії непозитивне.");
  if (secondHalfR <= 0) reasons.push("Друга половина вибірки має непозитивний результат.");
  return {
    trades: trades.length,
    totalNetR: Number(totalNetR.toFixed(3)),
    meanR: trades.length ? Number((totalNetR / trades.length).toFixed(4)) : null,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : null,
    stopRate: trades.length ? Number((100 * trades.filter((trade) => trade.result === "SL").length / trades.length).toFixed(1)) : null,
    firstHalfR: Number(firstHalfR.toFixed(3)), secondHalfR: Number(secondHalfR.toFixed(3)),
    profitableSymbols, testedSymbols: runs.length, eligibleForDemoReview: false, reasons,
  };
}
export const LAB_CANDIDATES = [
  { key: "baseline", label: "A · Поточна MTF", description: "Чинні правила EMA / swing / ATR", state: "baseline" },
  { key: "near-entry", label: "A1 · Ближчий вхід", description: "MTF із додатковим фільтром відстані <= 1 ATR", state: "diagnostic" },
  { key: "moderate-trend", label: "A2 · Помірний тренд", description: "MTF із фільтром сили тренду 4h < 1 ATR", state: "diagnostic" },
  { key: "lower-volume", label: "A3 · Нижчий обсяг", description: "MTF із фільтром відносного обсягу < 1,2", state: "diagnostic" },
] as const;
