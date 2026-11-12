import assert from "node:assert/strict";
import { test } from "node:test";
import { replayHourlyLimitStrategy } from "../lib/backtest.ts";

const bars = Array.from({ length: 150 }, (_, i) => {
  const close = 100 + i * 0.1;
  return { time: i * 3600000, open: close, high: close + 0.6,
    low: close - 0.6, close };
});

test("does not invent trades without a confirmed prior pivot", () => {
  const result = replayHourlyLimitStrategy(bars);
  assert.equal(result.count, 0);
  assert.equal(result.winRate, null);
  assert.equal(result.averageNetR, null);
});
test("not enough historical candles produces no trades", () => {
  assert.equal(replayHourlyLimitStrategy(bars.slice(0, 100)).count, 0);
});
test("results remain deterministic, bounded and internally consistent", () => {
  const history = bars.map((bar, i) =>
    i === 90 ? { ...bar, low: bar.low - 3 } : bar);
  const first = replayHourlyLimitStrategy(history);
  const second = replayHourlyLimitStrategy(history);
  assert.deepEqual(first, second);
  assert.equal(first.trades.length, first.count);
  assert.equal(first.wins + first.losses, first.count);
  assert.ok(first.trades.every((trade) => Number.isFinite(trade.netR)));
});
