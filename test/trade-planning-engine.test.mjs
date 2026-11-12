import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePlanningLevels, assessPlanningLevels } from "../lib/trade-planning-engine.ts";

function bars() {
  const data = Array.from({ length: 80 }, (_, i) => ({
    close: 100 + i * 0.1, high: 100 + i * 0.1 + 1, low: 100 + i * 0.1 - 1,
  }));
  // Confirmed target pivot beyond entry, with two lower neighbors either side.
  data[65] = { close: 110, high: 140, low: 109 };
  return data;
}
test("single planner computes identical rounded levels from point-in-time inputs", () => {
  const input = { direction: "LONG", currentPrice: 110, atr30m: 1, atr1h: 1,
    supportLevels: [105, 106, null, 104], dailyBars: bars(), tickSize: 0.1 };
  const first = calculatePlanningLevels(input);
  const second = calculatePlanningLevels(structuredClone(input));
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.equal(first.entry, 106);
  assert.equal(first.stop, 104);
  assert.ok(first.target > first.entry);
  assert.equal(first.confirmedEntry, true);
  assert.equal(first.confirmedTarget, true);
  assert.ok(first.rewardRisk > 0);
});
test("missing confirmed support fails closed for replay but allows labeled scanner fallback", () => {
  const input = { direction: "LONG", currentPrice: 110, atr30m: 1, atr1h: 1,
    supportLevels: [null, null], dailyBars: bars(), tickSize: 0.1 };
  assert.equal(calculatePlanningLevels(input), null);
  const fallback = calculatePlanningLevels({ ...input, fallbackEntry: 105 });
  assert.ok(fallback);
  assert.equal(fallback.confirmedEntry, false);
});
test("same quality evaluation consumes exactly planner-produced levels", () => {
  const levels = calculatePlanningLevels({
    direction: "LONG", currentPrice: 110, atr30m: 1, atr1h: 1,
    supportLevels: [105], dailyBars: bars(), tickSize: 0.1,
  });
  assert.ok(levels);
  const result = assessPlanningLevels({
    direction: "LONG", levels, atr30m: 1, tickSize: 0.1,
    quality: {
      direction4h: "LONG", direction1h: "LONG", direction30m: "LONG",
      relativeVolume: 1.2, change24h: 0.01, turnover24h: 50_000_000,
      pivot1h: true, pivot4h: true, pivotDaily: true,
    },
  });
  assert.ok(Number.isFinite(result.scenario.score));
  assert.equal(result.gate.accepted, false);
  assert.ok(result.gate.reasons.some((x) => x.includes("далеко")));
});
test("invalid prices or zero ATR never produce executable levels", () => {
  const input = { direction: "SHORT", currentPrice: 100, atr30m: 0, atr1h: 1,
    supportLevels: [102], dailyBars: bars() };
  assert.equal(calculatePlanningLevels(input), null);
});
