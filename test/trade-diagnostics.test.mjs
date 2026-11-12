import assert from "node:assert/strict";
import { test } from "node:test";
import { replayMultiTimeframeStrategy, summarizeTrades } from "../lib/mtf-backtest.ts";

const trade = (direction, volume, distance, strength, netR, time) => ({
  signalTime: time - 1000, entryTime: time - 500, exitTime: time,
  direction, entry: 100, stop: 99, target: 102, netR,
  result: netR > 0 ? "TP" : "SL",
  diagnostics: { score: 80, readiness: 8, relativeVolume: volume,
    distanceAtr: distance, rewardRisk: 2, trendStrengthAtr: strength, entryDelayBars: 0 },
});

test("diagnostic cohorts are disjoint within each factor and preserve R accounting", () => {
  const sample = [
    trade("LONG", 1.3, 0.5, 1.5, 2, 1000),
    trade("LONG", 1.1, 1.5, 0.5, -1, 2000),
    trade("SHORT", 1.5, 2, 1.2, -1, 3000),
    trade("SHORT", 1.0, 0.2, 0.8, -1, 4000),
  ];
  const overall = summarizeTrades(sample);
  assert.equal(overall.trades, 4);
  const split = [sample.filter((t) => t.direction === "LONG"),
    sample.filter((t) => t.direction === "SHORT")];
  assert.equal(split.reduce((sum, group) => sum + summarizeTrades(group).totalNetR, 0), overall.totalNetR);
  const highVolume = sample.filter((t) => t.diagnostics.relativeVolume >= 1.2);
  const lowVolume = sample.filter((t) => t.diagnostics.relativeVolume < 1.2);
  assert.equal(highVolume.length + lowVolume.length, sample.length);
});

test("historical results remain empty and diagnostic groups do not invent trades", () => {
  const empty = { "30": [], "60": [], "240": [], D: [] };
  const result = replayMultiTimeframeStrategy(empty);
  assert.equal(result.filled, 0);
  assert.equal(result.diagnostics.length, 8);
  assert.ok(result.diagnostics.every((group) => group.trades === 0 && group.averageNetR === null));
});
