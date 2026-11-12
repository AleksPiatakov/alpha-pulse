import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIntradayPlan, INTRADAY_POLICY_V1 } from "../lib/intraday-quality.ts";
const healthy = {
  direction: "LONG", entry: 100, stop: 98, target: 105,
  tickSize: 0.1, atr30m: 1, distanceAtr: 0.2,
  score: 95, readiness: 8, rewardRisk: 2.5,
};
test("accepts geometrically valid intraday entry with sufficient buffer and RR", () => {
  const value = evaluateIntradayPlan(healthy);
  assert.equal(value.accepted, true);
  assert.equal(value.stopAtr, 2);
  assert.equal(value.rewardRisk, 2.5);
});
test("rejects too-close stop, poor reward risk and chasing entry", () => {
  const value = evaluateIntradayPlan({
    ...healthy, stop: 99.5, target: 100.5, distanceAtr: 1.2,
  });
  assert.equal(value.accepted, false);
  assert.ok(value.reasons.some((x) => x.includes("Стоп")));
  assert.ok(value.reasons.some((x) => x.includes("винагорода")));
  assert.ok(value.reasons.some((x) => x.includes("далеко")));
});
test("rejects wrong-side stops, unaligned tick prices and unconfirmed score", () => {
  assert.equal(evaluateIntradayPlan({ ...healthy, stop: 101 }).accepted, false);
  assert.ok(evaluateIntradayPlan({ ...healthy, stop: 97.95 }).reasons.some((x) => x.includes("кроку")));
  assert.equal(evaluateIntradayPlan({ ...healthy, score: 85 }).accepted, false);
  assert.equal(evaluateIntradayPlan({ ...healthy, readiness: 7 }).accepted, false);
});
test("supports SHORT direction symmetrically", () => {
  const value = evaluateIntradayPlan({
    ...healthy, direction: "SHORT", stop: 102, target: 95,
  });
  assert.equal(value.accepted, true);
});
test("does not define or enforce a daily trade count quota", () => {
  assert.equal("maxTradesPerDay" in INTRADAY_POLICY_V1, false);
  assert.equal(INTRADAY_POLICY_V1.maxPendingBars30m, 6);
  assert.equal(INTRADAY_POLICY_V1.maxHoldingBars30m, 48);
});
