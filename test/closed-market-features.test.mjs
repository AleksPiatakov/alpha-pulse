import assert from "node:assert/strict";
import { test } from "node:test";
import { closedMarketFeatures } from "../lib/closed-market-features.ts";
const bars = Array.from({length: 80}, (_,i)=>({
  close: 100+i*.5, volume: 10+i, turnover: 100000+i*1000,
}));
test("same close-of-hour features for scanner tuple and replay bar data", () => {
  const scanner = bars.map(b => [String(b.close),String(b.volume),String(b.turnover)])
    .map(([close,volume,turnover])=>({close:Number(close),volume:Number(volume),turnover:Number(turnover)}));
  assert.deepEqual(closedMarketFeatures(scanner),closedMarketFeatures(bars));
  const f=closedMarketFeatures(bars);
  assert.ok(f);
  assert.equal(f.source,"closed-1h-candles");
  assert.equal(f.change24h,bars[79].close/bars[55].close-1);
  assert.equal(f.turnover24h,bars.slice(-24).reduce((s,b)=>s+b.turnover,0));
  assert.equal(f.relativeVolume1h,bars[79].volume/(bars.slice(-31,-1).reduce((s,b)=>s+b.volume,0)/30));
});
test("missing, nonfinite or inadequate volume and price fail closed",()=>{
  assert.equal(closedMarketFeatures(bars.slice(-30)),null);
  assert.equal(closedMarketFeatures([...bars.slice(0,-1),{...bars.at(-1),volume:NaN}]),null);
  assert.equal(closedMarketFeatures(bars.map(b=>({...b,volume:0}))),null);
  assert.equal(closedMarketFeatures(bars.map(b=>({...b,turnover:Infinity}))),null);
  assert.equal(closedMarketFeatures(bars.map(b=>({...b,close:0}))),null);
});
