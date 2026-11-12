import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emaValues, emaBars, atrBars, trendBars, nearestSwingLevel,
  nearestAcrossTimeframes, stopFromAtr, structuralTarget, rewardRisk,
} from "../lib/technical-plan-core.ts";

const bars = Array.from({ length: 90 }, (_, i) => {
  const close = 100 + i * 0.4;
  return { close, high: close + 1, low: close - 1 };
});
const tuples = bars.map((b, i) =>
  [String(i * 1_800_000), String(b.close), String(b.high), String(b.low), String(b.close), "100"]);

test("scanner tuple adapter and replay numeric bars have identical EMA / ATR / trend", () => {
  const parsed = tuples.map((c) => ({ high: +c[2], low: +c[3], close: +c[4] }));
  assert.equal(emaValues(tuples.map((c) => +c[4]), 20), emaBars(parsed, 20));
  assert.equal(atrBars(parsed), atrBars(bars));
  assert.equal(trendBars(parsed), trendBars(bars));
  assert.equal(trendBars(parsed), "LONG");
});

test("swing must be confirmed by two later CLOSED bars and calculated identically", () => {
  const sample = bars.map((bar) => ({ ...bar }));
  sample[75] = { ...sample[75], low: 80 };
  const parsed = sample.map((b) => ({ ...b }));
  assert.equal(nearestSwingLevel(sample, "LONG", 142), 80);
  assert.equal(nearestSwingLevel(parsed, "LONG", 142), 80);
  assert.equal(nearestSwingLevel(sample.slice(0, 77), "LONG", 142), null);
  assert.equal(nearestAcrossTimeframes([null, 80, 89, null], "LONG"), 89);
  assert.equal(nearestAcrossTimeframes([null, 130, 126], "SHORT"), 126);
});

test("same shared stop target and R:R functions apply to both calculation paths", () => {
  const entry = 120;
  const stop = stopFromAtr("LONG", entry, 2, 1);
  assert.equal(stop, 117.5);
  const daily = bars.map((b) => ({ ...b }));
  daily[72] = { ...daily[72], high: 155 };
  const target = structuralTarget("LONG", entry, stop, daily);
  assert.ok(target !== null && target > entry);
  const rr = rewardRisk("LONG", entry, stop, target);
  assert.ok(rr > 0);
  assert.equal(rewardRisk("SHORT", 100, 103, 94), 2);
  assert.ok(Number.isNaN(rewardRisk("LONG", 100, 100, 102)));
});

test("not enough history fails safely in EMA, ATR, and trend", () => {
  assert.ok(Number.isNaN(emaBars(bars.slice(0, 10), 20)));
  assert.ok(Number.isNaN(atrBars(bars.slice(0, 10))));
  assert.equal(trendBars(bars.slice(0, 10)), null);
});
