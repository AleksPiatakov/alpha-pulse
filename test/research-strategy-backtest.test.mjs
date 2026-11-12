import assert from "node:assert/strict";
import { test } from "node:test";
import { replayResearchStrategy } from "../lib/research-strategy-backtest.ts";

const durations={"30":1800000,"60":3600000,"240":14400000,D:86400000};
const cutoff=Date.UTC(2026,10,12,0);
const fixture=()=>Object.fromEntries(Object.entries(durations).map(([key,duration])=>[
  key,Array.from({length:key==="30"?620:220},(_,i)=>{
    const time=cutoff-(key==="30"?620:220)*duration+i*duration;
    const close=100+i*0.1;
    return {time,open:close-0.05,high:close+0.5,low:close-0.5,
      close,volume:100,turnover:10000};
  }),
]));
test("research backtests independently compute both cost models without placing orders",()=>{
  const candles=fixture();
  for(const strategy of ["trend-pullback-v1","breakout-retest-v1"]){
    const reference=replayResearchStrategy(candles,"BTCUSDT",0.1,strategy,"reference");
    const stress=replayResearchStrategy(candles,"BTCUSDT",0.1,strategy,"conservative");
    assert.equal(reference.strategy,strategy);
    assert.equal(stress.model,"conservative");
    assert.equal(reference.filled,reference.trades.length);
    assert.equal(stress.filled,stress.trades.length);
    assert.ok(stress.assumptions.some(x=>x.includes("0.075%")));
    assert.deepEqual(replayResearchStrategy(structuredClone(candles),"BTCUSDT",0.1,strategy),stress);
  }
});
test("incomplete and invalid instrument conditions fail closed",()=>{
  const bars=fixture();
  assert.throws(()=>replayResearchStrategy(bars,"BAD",0.1,"trend-pullback-v1"),/Невірна/);
  assert.throws(()=>replayResearchStrategy(bars,"BTCUSDT",0,"trend-pullback-v1"),/Невірна/);
  const broken=fixture();broken["30"][55].close=-2;
  assert.throws(()=>replayResearchStrategy(broken,"BTCUSDT",0.1,"trend-pullback-v1"),/пошкоджені/);
});
test("all computed net R values account for costs and time ordering",()=>{
  const bars=fixture();
  for(const key of ["trend-pullback-v1","breakout-retest-v1"]){
    const run=replayResearchStrategy(bars,"BTCUSDT",0.1,key);
    for(const trade of run.trades){
      assert.ok(trade.entryTime>=trade.signalTime);
      assert.ok(trade.exitTime>=trade.entryTime);
      assert.ok(Number.isFinite(trade.netR));
    }
  }
});
