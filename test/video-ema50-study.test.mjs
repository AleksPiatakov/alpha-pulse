import assert from "node:assert/strict";
import {test} from "node:test";
import {emaSeries,emaSlopeDirection,evaluateVideoEma50,realizedVolatilityPercent,
  VIDEO_EMA_SETTINGS} from "../lib/video-ema50-strategy.ts";
import {replayVideoEma50} from "../lib/video-ema50-backtest.ts";
const at=Date.UTC(2026,10,12);
const makeBars=(n,ms,step=.3)=>Array.from({length:n},(_,i)=>{
  const close=100+i*step;
  return {time:at-(n-i)*ms,open:close-.1,high:close+.8,low:close-.8,close,volume:100};
});
test("EMA50 slope and flat-market filter are deterministic",()=>{
  const trending=makeBars(110,14400000);
  assert.equal(emaSlopeDirection(trending,VIDEO_EMA_SETTINGS),"LONG");
  const flat=makeBars(110,14400000,0);
  assert.equal(emaSlopeDirection(flat,VIDEO_EMA_SETTINGS),null);
  assert.equal(emaSeries(trending).length,trending.length);
});
test("EMA50 video detector requires 1h touch and completed 15m cross",()=>{
  const m15=makeBars(110,900000,.05),h1=makeBars(110,3600000),h4=makeBars(110,14400000);
  assert.equal(evaluateVideoEma50(m15,h1,h4),null);
  const hourlyEma=emaSeries(h1).at(-1);
  h1.at(-1).low=hourlyEma-.1;
  // Previous candle closes below its EMA; last candle closes above.
  m15.at(-2).close-=2;
  const signal=evaluateVideoEma50(m15,h1,h4);
  assert.ok(signal);
  assert.equal(signal.direction,"LONG");
  assert.equal(signal.settings,"ema50-video-v1");
  const withoutTouch=structuredClone(h1);
  withoutTouch.forEach(b=>b.low=b.close-.1);
  assert.equal(evaluateVideoEma50(m15,withoutTouch,h4),null);
});
test("research backtest respects fixed 2.5% stop and 3R/2R targets",()=>{
  const m15=makeBars(420,900000,.05),h1=makeBars(200,3600000),h4=makeBars(120,14400000);
  const first=replayVideoEma50("BTCUSDT",m15,h1,h4,"video-3r","reference");
  const comparison=replayVideoEma50("BTCUSDT",m15,h1,h4,"comparison-2r","conservative");
  assert.equal(first.stopPercent,2.5);
  assert.equal(first.takePercent,7.5);
  assert.equal(comparison.takePercent,5);
  assert.equal(first.feesPerSide,.00055);
  assert.equal(comparison.feesPerSide,.00075);
  assert.deepEqual(replayVideoEma50("BTCUSDT",structuredClone(m15),h1,h4,"video-3r","reference"),first);
});
test("invalid timestamps and malformed OHLC fail closed",()=>{
  const bars=makeBars(120,900000,.05),h1=makeBars(100,3600000),h4=makeBars(100,14400000);
  assert.throws(()=>replayVideoEma50("BTCUSDT",bars.map((b,i)=>i===5?{...b,time:b.time+1}:b),h1,h4),/Некоректна/);
  assert.throws(()=>replayVideoEma50("BTCUSDT",bars,h1.map((b,i)=>i===10?{...b,low:-2}:b),h4),/Некоректна/);
  assert.equal(realizedVolatilityPercent(h1.map(b=>({...b,close:100}))),0);
});
