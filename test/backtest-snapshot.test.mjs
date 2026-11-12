import assert from "node:assert/strict";
import { test } from "node:test";
import { sealSnapshot, verifySnapshot } from "../lib/backtest-snapshot.ts";
const lengths = { "30": 1_800_000, "60": 3_600_000, "240": 14_400_000, D: 86_400_000 };
const cutoff = Date.UTC(2026, 10, 12);
function bars(step) {
  return Array.from({ length: 70 }, (_, i) => ({
    time: cutoff - 70 * step + i * step,
    open: 100 + i / 100, high: 101 + i / 100,
    low: 99 + i / 100, close: 100 + i / 100,
    volume: 100, turnover: 10000,
  }));
}
function input() {
  return {
    schema: 1, symbol: "BTCUSDT", cutoff, capturedAt: "2026-11-12T13:00:00.000Z",
    tickSize: 0.1, source: "bybit-public-linear", warnings: [], pages: [1, 1, 1, 1],
    bars: Object.fromEntries(Object.entries(lengths).map(([interval, duration]) => [interval, bars(duration)])),
  };
}
test("exact research candles and metadata produce a stable SHA-256", () => {
  const a = sealSnapshot(input());
  const b = sealSnapshot(input());
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.sha256.length, 64);
  assert.equal(verifySnapshot(a, "BTCUSDT", cutoff), a);
});
test("modified candle is detected before any replay", () => {
  const a = sealSnapshot(input());
  a.bars["30"][4].close += 0.01;
  assert.throws(() => verifySnapshot(a, "BTCUSDT", cutoff), /Контрольна сума/);
});
test("reject future or duplicate bar and incorrect symbol", () => {
  const inputFuture = input();
  inputFuture.bars["60"][69].time = cutoff;
  assert.throws(() => sealSnapshot(inputFuture), /Некоректні свічки/);
  const inputDuplicates = input();
  inputDuplicates.bars["30"][3].time = inputDuplicates.bars["30"][2].time;
  assert.throws(() => sealSnapshot(inputDuplicates), /Некоректні свічки/);
  const good = sealSnapshot(input());
  assert.throws(() => verifySnapshot(good, "ETHUSDT", cutoff), /не відповідає/);
});
