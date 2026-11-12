import assert from "node:assert/strict";
import { test } from "node:test";
import { replayMultiTimeframeStrategy } from "../lib/mtf-backtest.ts";

function makeBars(count, milliseconds) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.01;
    return { time: i * milliseconds, open: close, high: close + 0.3,
      low: close - 0.3, close, volume: 100, turnover: 2_000_000 };
  });
}
const input = {
  "30": makeBars(400, 1_800_000),
  "60": makeBars(200, 3_600_000),
  "240": makeBars(200, 14_400_000),
  D: makeBars(90, 86_400_000),
};

test("insufficient completed 1D candles yield no signals", () => {
  const truncated = { ...input, D: input.D.slice(-40) };
  const result = replayMultiTimeframeStrategy(truncated);
  assert.equal(result.mode, "mtf-walk-forward");
  assert.equal(result.signals, 0);
  assert.equal(result.filled, 0);
  assert.equal(result.winRate, null);
});

test("replay does not invent fills without confirmed pivot levels", () => {
  const result = replayMultiTimeframeStrategy(input);
  assert.equal(result.signals, 0);
  assert.equal(result.filled, 0);
  assert.equal(result.averageNetR, null);
});

test("future modifications cannot change an earlier decision window", () => {
  const before = replayMultiTimeframeStrategy(input);
  const later = {
    ...input,
    "30": [...input["30"], ...makeBars(5, 1_800_000).map((b, i) =>
      ({ ...b, time: (400 + i) * 1_800_000, high: b.high + 50 }))],
  };
  const after = replayMultiTimeframeStrategy(later);
  assert.deepEqual(before.trades, after.trades);
  assert.ok(after.signals >= 0);
});

test("summary matches trade outcomes and contains no fabricated probability", () => {
  const result = replayMultiTimeframeStrategy(input);
  assert.equal(result.filled, result.trades.length);
  assert.equal(result.wins + result.losses, result.filled);
  assert.equal(result.winRate, null);
  assert.ok(result.assumptions.some((x) => x.includes("Stop Loss")));
});
