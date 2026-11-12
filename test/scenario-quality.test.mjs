import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateScenarioQuality } from "../lib/scenario-quality.ts";

const baseline = {
  direction4h: "LONG", direction1h: "LONG", direction30m: "LONG",
  relativeVolume: 1.4, change24h: 0.018, turnover24h: 40_000_000,
  rewardRisk: 2.2, distanceAtr: 0.75,
  pivot1h: true, pivot4h: true, pivotDaily: true, hasTargetLevel: true,
};

test("strong aligned setup is technically confirmed", () => {
  const result = evaluateScenarioQuality(baseline);
  assert.equal(result.status, "ACTIVE");
  assert.deepEqual(result.checks, []);
  assert.ok(result.score > 60);
});

test("misaligned timeframes cannot be marked confirmed", () => {
  const result = evaluateScenarioQuality({ ...baseline, direction30m: "SHORT" });
  assert.equal(result.status, "REVIEW");
  assert.ok(result.score < evaluateScenarioQuality(baseline).score);
});

test("weak volume, insufficient reward, thin liquidity and distant entry downgrade", () => {
  for (const patch of [
    { relativeVolume: 0.5 }, { rewardRisk: 0.8 }, { turnover24h: 200_000 },
    { distanceAtr: 7 }, { hasTargetLevel: false }, { change24h: -0.02 },
  ]) {
    assert.equal(evaluateScenarioQuality({ ...baseline, ...patch }).status, "REVIEW");
  }
});

test("stronger confirmed levels and R:R improve score without guaranteeing profit", () => {
  const weak = evaluateScenarioQuality({
    ...baseline, pivot4h: false, pivotDaily: false, rewardRisk: 1.6,
  });
  const strong = evaluateScenarioQuality(baseline);
  assert.ok(strong.score > weak.score);
});

test("quality score is finite and constrained for invalid inputs", () => {
  const result = evaluateScenarioQuality({
    ...baseline, rewardRisk: Number.NaN, relativeVolume: Number.NaN,
  });
  assert.equal(result.status, "REVIEW");
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.score >= 1 && result.score <= 100);
});
