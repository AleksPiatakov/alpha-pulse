import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONSERVATIVE_EXECUTION, qualifiesLimitFill, stressedExitPrice,
  replayMultiTimeframeStrategy,
} from "../lib/mtf-backtest.ts";

function bar(low, high, open = 100, close = 100) {
  return { time: 0, open, high, low, close, volume: 100, turnover: 1_000_000 };
}

test("Limit mere touch does not count as a conservative fill", () => {
  assert.equal(qualifiesLimitFill(bar(100, 101), "LONG", 100, 0.1), false);
  assert.equal(qualifiesLimitFill(bar(99.8, 101), "LONG", 100, 0.1), true);
  assert.equal(qualifiesLimitFill(bar(99, 100), "SHORT", 100, 0.1), false);
  assert.equal(qualifiesLimitFill(bar(99, 100.2), "SHORT", 100, 0.1), true);
  assert.equal(qualifiesLimitFill(bar(98, 99), "LONG", 100, 0.1), false);
  assert.equal(qualifiesLimitFill(bar(101, 102), "SHORT", 100, 0.1), false);
});

test("Stop gap and slippage worsen long and short stop fills", () => {
  assert.equal(stressedExitPrice("LONG", "SL", 95, 90, 10), 90 * 0.999);
  assert.equal(stressedExitPrice("SHORT", "SL", 105, 110, 10), 110 * 1.001);
  assert.equal(stressedExitPrice("LONG", "TP", 110, 100, 10), 110);
  assert.equal(stressedExitPrice("SHORT", "TIMEOUT", 99, 100, 5), 99 * 1.0005);
  assert.equal(CONSERVATIVE_EXECUTION.feePerSide, 0.00075);
});

test("conservative simulation requires explicit price tick size", () => {
  const empty = { "30": [], "60": [], "240": [], D: [] };
  assert.throws(() => replayMultiTimeframeStrategy(empty, undefined, "baseline", undefined, "conservative"), /tickSize/);
  const result = replayMultiTimeframeStrategy(empty, undefined, "baseline", 0.1, "conservative");
  assert.equal(result.filled, 0);
  assert.ok(result.assumptions.some((item) => item.includes("0.075%")));
});
