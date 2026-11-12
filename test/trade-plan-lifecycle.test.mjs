import assert from "node:assert/strict";
import { test } from "node:test";
import { explainPlanLifecycle } from "../lib/trade-plan-lifecycle.ts";

test("LONG: candle thesis review is not the protective stop trigger", () => {
  const plan = explainPlanLifecycle("LONG", 100.5);
  assert.match(plan.setupReview, /1h/);
  assert.match(plan.setupReview, /нижче 100.5/);
  assert.match(plan.stopProtection, /MarkPrice/);
  assert.match(plan.stopProtection, /до закриття/);
  assert.match(plan.pendingLimit, /GTC/);
  assert.match(plan.pendingLimit, /не скасовується автоматично/);
});
test("SHORT: separate thesis condition and protective stop", () => {
  const plan = explainPlanLifecycle("SHORT", 123.45);
  assert.match(plan.setupReview, /вище 123.45/);
  assert.match(plan.stopProtection, /123.45/);
});
test("invalid stop fails closed", () => {
  assert.throws(() => explainPlanLifecycle("LONG", 0), /Invalid protective stop/);
  assert.throws(() => explainPlanLifecycle("SHORT", Number.NaN), /Invalid protective stop/);
});
