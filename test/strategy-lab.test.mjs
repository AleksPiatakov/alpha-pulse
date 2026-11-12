import assert from "node:assert/strict";
import { test } from "node:test";
import { assessLabRuns, LAB_CANDIDATES } from "../lib/strategy-lab.ts";

const run = (key, values) => ({
  key, label: key, filled: values.length, totalNetR: values.reduce((a,b) => a+b, 0),
  averageNetR: 0, maxDrawdownR: 1,
  trades: values.map((netR, i) => ({ netR, result: netR < 0 ? "SL" : "TP", signalTime: i })),
  periods: [{totalNetR: values[0], trades: 1}, {totalNetR: values.slice(1).reduce((a,b)=>a+b,0), trades: values.length - 1}],
});
test("lab assessment counts independent symbol results without claiming a portfolio", () => {
  const value = assessLabRuns([run("a", [2, -1]), run("b", [-2, 1])]);
  assert.equal(value.trades, 4);
  assert.equal(value.totalNetR, 0);
  assert.equal(value.profitFactor, 1);
  assert.equal(value.stopRate, 50);
  assert.equal(value.profitableSymbols, 1);
  assert.equal(value.testedSymbols, 2);
  assert.equal(value.eligibleForDemoReview, false);
  assert.ok(value.reasons.some((x) => x.includes("holdout")));
});
test("zero trades is reported as insufficient data, not as a win", () => {
  const value = assessLabRuns([]);
  assert.equal(value.meanR, null);
  assert.equal(value.profitFactor, null);
  assert.equal(value.stopRate, null);
  assert.equal(value.eligibleForDemoReview, false);
});
test("candidate keys are unique and research-only", () => {
  assert.equal(new Set(LAB_CANDIDATES.map((x) => x.key)).size, LAB_CANDIDATES.length);
  assert.ok(LAB_CANDIDATES.some((x) => x.key === "baseline"));
  assert.ok(LAB_CANDIDATES.every((x) => x.state === "baseline" || x.state === "diagnostic"));
});
