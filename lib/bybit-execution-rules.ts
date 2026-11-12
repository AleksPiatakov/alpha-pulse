/** Exchange filters for USDT linear contracts. Fail closed on missing metadata. */
import type { InstrumentMeta } from "./bybit-universe.ts";
export type ExecutionRules = {
  tickSize: number; qtyStep: number; minOrderQty: number; minNotionalValue: number;
};
export function parseExecutionRules(meta: InstrumentMeta | undefined): ExecutionRules | null {
  const tickSize = Number(meta?.priceFilter?.tickSize);
  const qtyStep = Number(meta?.lotSizeFilter?.qtyStep);
  const minOrderQty = Number(meta?.lotSizeFilter?.minOrderQty);
  const rawMinNotional = meta?.lotSizeFilter?.minNotionalValue;
  const minNotionalValue = rawMinNotional === undefined ? 0 : Number(rawMinNotional);
  if (!meta || meta.status !== "Trading" ||
      meta.quoteCoin !== "USDT" || meta.settleCoin !== "USDT" ||
      !Number.isFinite(tickSize) || tickSize <= 0 ||
      !Number.isFinite(qtyStep) || qtyStep <= 0 ||
      !Number.isFinite(minOrderQty) || minOrderQty <= 0 ||
      !Number.isFinite(minNotionalValue) || minNotionalValue < 0) return null;
  return { tickSize, qtyStep, minOrderQty, minNotionalValue };
}
export function isOnStep(value: number, step: number): boolean {
  if (![value, step].every(Number.isFinite) || value <= 0 || step <= 0) return false;
  const units = value / step;
  return Math.abs(units - Math.round(units)) <= 1e-7;
}
export function validateOrderPrecision(
  levels: { entry: number; stop: number; target: number; quantity: number },
  rules: ExecutionRules,
): string[] {
  const issues: string[] = [];
  if (!isOnStep(levels.entry, rules.tickSize) ||
      !isOnStep(levels.stop, rules.tickSize) ||
      !isOnStep(levels.target, rules.tickSize)) issues.push("Ціни не відповідають tickSize Bybit.");
  if (!isOnStep(levels.quantity, rules.qtyStep)) issues.push("Кількість не відповідає qtyStep Bybit.");
  if (!Number.isFinite(levels.quantity) || levels.quantity < rules.minOrderQty)
    issues.push("Кількість менша за minOrderQty Bybit.");
  if (!(levels.entry * levels.quantity >= rules.minNotionalValue))
    issues.push("Номінал менший за мінімум Bybit.");
  return issues;
}
