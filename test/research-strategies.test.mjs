import assert from "node:assert/strict";
import { test } from "node:test";
import { trendPullback, breakoutRetest, evaluateResearchStrategies, RESEARCH_STRATEGIES } from "../lib/research-strategies.ts";
import { sealMarketInputSnapshot } from "../lib/market-input-snapshot.ts";
const makeBars = (n = 90) => Array.from({length:n},(_,i)=>{
  const close = 100+i*.3;
  return {close, high:close+.5, low:close-.5};
});
const ctx = () => ({symbol:"BTCUSDT",signalAt:Date.UTC(2026,10,12,16),
  tickSize:.1,m30:makeBars(),h1:makeBars(),h4:makeBars()});
test("strategy registry exposes two independent, non-executable research modules",()=>{
  assert.deepEqual(RESEARCH_STRATEGIES.map(s=>s.key),["trend-pullback-v1","breakout-retest-v1"]);
  assert.equal(trendPullback.evaluate(ctx()),null);
  assert.equal(breakoutRetest.evaluate(ctx()),null);
});
test("confirmed pullback uses only completed bars and returns explicit hypothetical levels",()=>{
  const input=ctx(), m=input.m30;
  // The previous candle pierces EMA20, current candle recovers above it.
  const prev=m.at(-2);
  prev.low-=5;prev.close-=2;
  const result=trendPullback.evaluate(input);
  assert.ok(result);
  assert.equal(result.direction,"LONG");
  assert.equal(result.strategy,"trend-pullback-v1");
  assert.equal(result.executable,false);
  assert.equal(result.experimental,true);
  assert.ok(result.stop<result.entry);
  assert.ok(result.target>result.entry);
});
test("retest strategy requires breakout, retest, and final confirmation",()=>{
  const input=ctx();
  assert.equal(breakoutRetest.evaluate(input),null);
  // Artificial high barrier and a qualifying breakout, retrace and close.
  const m=input.m30, history=m.slice(-23,-3);
  const level=Math.max(...history.map(b=>b.high));
  m[m.length-3]={high:level+3,low:level-.5,close:level+2};
  m[m.length-2]={high:level+1.5,low:level-.15,close:level+.2};
  m[m.length-1]={high:level+2.2,low:level+.2,close:level+1.8};
  const result=breakoutRetest.evaluate(input);
  assert.ok(result);
  assert.equal(result.direction,"LONG");
  assert.equal(result.executable,false);
});
test("unsealed/mutated snapshot rejected; same valid data never depends on current wall clock",()=>{
 const at=Date.UTC(2026,10,12,16);
 const sizes={"30":1800000,"60":3600000,"240":14400000,D:86400000};
 const candles=Object.fromEntries(Object.entries(sizes).map(([key,size])=>{
   const cutoff=Math.floor(at/size)*size;
   return [key,Array.from({length:90},(_,i)=>{
     const c=100+i*.3;
     return [String(cutoff-(90-i)*size),String(c),String(c+.5),String(c-.5),String(c),"100","10000"];
   })];
 }));
 const sealed=sealMarketInputSnapshot({
   schema:"alpha-pulse-market-input-v1",source:"bybit-demo",observedAt:at,symbol:"BTCUSDT",
   ticker:{symbol:"BTCUSDT",lastPrice:"127",price24hPcnt:"0.02",turnover24h:"100000"},
   instrument:{symbol:"BTCUSDT",status:"Trading",quoteCoin:"USDT",settleCoin:"USDT",priceFilter:{tickSize:".1"},lotSizeFilter:{qtyStep:".01",minOrderQty:".01"}},
   candles,
 });
 const first=evaluateResearchStrategies(sealed);
 assert.deepEqual(evaluateResearchStrategies(structuredClone(sealed)),first);
 sealed.snapshot.ticker.lastPrice="140";
 assert.throws(()=>evaluateResearchStrategies(sealed),/Невалідний/);
});
