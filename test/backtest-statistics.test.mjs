import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTrades } from "../lib/mtf-backtest.ts";

const trade = (exitTime, netR) => ({
  signalTime: exitTime - 1000, entryTime: exitTime - 500, exitTime,
  direction: "LONG", entry: 100, stop: 99, target: 102,
  result: netR > 0 ? "TP" : "SL", netR,
});

test("drawdown uses chronological cumulative R instead of price or notional", () => {
  const stats = summarizeTrades([
    trade(4000, -0.5), trade(1000, 2), trade(3000, -1), trade(2000, -1),
  ]);
  assert.equal(stats.trades, 4);
  assert.equal(stats.wins, 1);
  assert.equal(stats.winRate, 25);
  assert.equal(stats.totalNetR, -0.5);
  assert.equal(stats.averageNetR, -0.125);
  assert.equal(stats.maxDrawdownR, 2.5);
});

test("empty trade sample reports missing win rate, not zero percent", () => {
  const stats = summarizeTrades([]);
  assert.equal(stats.winRate, null);
  assert.equal(stats.averageNetR, null);
  assert.equal(stats.maxDrawdownR, 0);
});

test("drawdown is zero for strictly profitable cumulative results", () => {
  assert.equal(summarizeTrades([trade(1000, 0.2), trade(2000, 0.5)]).maxDrawdownR, 0);
});
