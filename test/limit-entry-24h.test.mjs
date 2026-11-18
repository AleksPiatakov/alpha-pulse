import assert from "node:assert/strict";
import {test} from "node:test";
import {assessLimitEntry24h, LIMIT_ENTRY_HORIZON_MS} from "../lib/limit-entry-24h.ts";

const history = (n=200) => Array.from({length:n}, (_,i)=>({
  high:101+(i%4)*0.2, low:99-(i%4)*0.2, close:100,
}));
test("horizon is 24h; historical reach is a diagnostic, not a probability",()=>{
  assert.equal(LIMIT_ENTRY_HORIZON_MS,86_400_000);
  const r=assessLimitEntry24h({direction:"LONG",currentPrice:100,entryPrice:99.5,
    atr30m:1,closed30m:history()});
  assert.equal(r.horizonHours,24);
  assert.equal(r.status,"HISTORICALLY_REACHABLE");
  assert.equal(r.sampleWindows,152);
  assert.ok(r.historicalTouchRate>0);
  assert.ok(r.caution.includes("НЕ"));
});
test("far unobserved pullbacks are excluded and no entry on wrong side",()=>{
  const input={direction:"LONG",currentPrice:100,atr30m:1,closed30m:history()};
  assert.equal(assessLimitEntry24h({...input,entryPrice:50}).status,"OUTSIDE_OBSERVED_RANGE");
  assert.equal(assessLimitEntry24h({...input,entryPrice:105}).status,"ALREADY_AT_OR_BEYOND");
  assert.equal(assessLimitEntry24h({...input,direction:"SHORT",entryPrice:99}).status,"ALREADY_AT_OR_BEYOND");
});
test("refuses too little history or malformed candles rather than claiming a fill",()=>{
  const input={direction:"SHORT",currentPrice:100,entryPrice:100.5,atr30m:1,closed30m:history(80)};
  assert.equal(assessLimitEntry24h(input).status,"INSUFFICIENT_HISTORY");
  assert.equal(assessLimitEntry24h({...input,closed30m:[{high:99,low:101,close:100}]}).status,"INVALID");
  assert.equal(assessLimitEntry24h({...input,atr30m:0}).status,"INVALID");
});
test("same data yields identical result; direction matters",()=>{
  const input={direction:"SHORT",currentPrice:100,entryPrice:101,atr30m:1,closed30m:history()};
  assert.deepEqual(assessLimitEntry24h(input),assessLimitEntry24h(structuredClone(input)));
  assert.equal(assessLimitEntry24h(input).status,"HISTORICALLY_REACHABLE");
});
