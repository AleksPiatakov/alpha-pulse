import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closedBarAt, completedBarCutoff, selectClosedBars,
  TIMEFRAME_MS, observationMetadata,
} from "../lib/market-observation-clock.ts";

const hour = 3_600_000;
const at = Date.UTC(2026, 10, 12, 14, 35, 17);
test("scanner 30m/1h/4h/day close cutoffs use one observation instant", () => {
  const m = observationMetadata(at);
  assert.equal(m.last30mClose, Date.UTC(2026, 10, 12, 14, 30));
  assert.equal(m.last1hClose, Date.UTC(2026, 10, 12, 14, 0));
  assert.equal(m.last4hClose, Date.UTC(2026, 10, 12, 12, 0));
  assert.equal(m.lastDailyClose, Date.UTC(2026, 10, 12, 0, 0));
});
test("a forming candle is excluded on all timeframes", () => {
  for(const interval of ["30","60","240","D"]) {
    const lastClose = completedBarCutoff(at, interval);
    const duration = TIMEFRAME_MS[interval];
    assert.equal(closedBarAt(lastClose, interval, at), false);
    assert.equal(closedBarAt(lastClose-duration, interval, at), true);
    assert.equal(closedBarAt(lastClose-2*duration, interval, at), true);
  }
});
test("bar becomes available at exactly its close, never a millisecond early", () => {
  const open = Date.UTC(2026, 10, 12, 14, 0);
  assert.equal(closedBarAt(open, "60", open + hour - 1), false);
  assert.equal(closedBarAt(open, "60", open + hour), true);
});
test("scanner and historical replay see same closed data at identical cutoff", () => {
  const bars = Array.from({length:6},(_,i)=>({time:Date.UTC(2026,10,12,12,0)+i*30*60_000,close:i}));
  const scanner = selectClosedBars(bars,"30",at);
  const replay = bars.filter((bar)=>closedBarAt(bar.time,"30",at));
  assert.deepEqual(scanner,replay);
  assert.deepEqual(scanner.map(b=>b.close),[0,1,2,3,4]);
});
test("invalid/unaligned bars and invalid observation timestamps are excluded", () => {
  assert.equal(closedBarAt(NaN,"30",at),false);
  assert.equal(closedBarAt(at,"60",at),false);
  assert.equal(closedBarAt(Date.UTC(2026,10,12,13,0)+1,"60",at),false);
  assert.equal(completedBarCutoff(NaN,"D"),null);
});
