import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePosition, defaultRiskSettings } from "../lib/risk-settings.ts";

const base = {
  balance: 100_000, activeCount: 0, settings: defaultRiskSettings,
  entryPrice: 100, stopLoss: 99, takeProfit: 102,
};
test("quantity cannot exceed free Bybit margin under conservative 1x cap", () => {
  const result = calculatePosition({ ...base, availableBalance: 2_500 });
  assert.equal(result.quantity, 25);
  assert.equal(result.notional, 2_500);
  assert.equal(result.actualRisk, 25);
  assert.equal(result.cappedByMargin, true);
});
test("actual risk is lower than permitted risk when margin is limiting", () => {
  const result = calculatePosition({ ...base, availableBalance: 1_000 });
  assert.ok(result.actualRisk < result.allowedRisk);
  assert.equal(result.actualRisk, 10);
});
test("missing or zero free margin cannot authorize an order", () => {
  for (const availableBalance of [0, NaN, -100]) {
    const result = calculatePosition({ ...base, availableBalance });
    assert.equal(result.canOpen, false);
    assert.equal(result.quantity, 0);
  }
});
test("normal risk cap and occupied positions still apply", () => {
  const result = calculatePosition({ ...base, availableBalance: 100_000, activeCount: 3 });
  assert.equal(result.canOpen, false);
  assert.equal(result.slotsRemaining, 0);
});
