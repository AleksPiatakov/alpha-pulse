import assert from "node:assert/strict";
import {test} from "node:test";
import {selectNearEntryRechecks} from "../lib/near-entry-recheck.ts";
const now=1_000_000;
const plan=(symbol,distance,changes={})=>({
 symbol,status:"ACTIVE",score:93,readiness:{met:8,total:8},
 qualityGate:{passed:false,reasons:["Ціна занадто далеко від входу."]},
 limitEntry24h:{distanceAtr:distance},...changes
});
const record=(p,age=120_000)=>({plan:p,checkedAt:now-age});
test("focuses on nearly ready plans and never sweeps an instrument twice in a batch",()=>{
 const cache=new Map([
  ["ASTERUSDT",record(plan("ASTERUSDT",1.08))],
  ["ETHUSDT",record(plan("ETHUSDT",.90))],
  ["SOLUSDT",record(plan("SOLUSDT",1.25))],
 ]);
 assert.deepEqual(selectNearEntryRechecks(cache,new Set(["ETHUSDT"]),
  new Set(cache.keys()),now),["ASTERUSDT","SOLUSDT"]);
});
test("does not promote plans with other unmet conditions, stale data or unsuitable distance",()=>{
 const cache=new Map([
  ["A",record(plan("A",1.08,{qualityGate:{passed:false,reasons:["Ціна занадто далеко від входу.","Недостатня оцінка сигналу."]}}))],
  ["B",record(plan("B",1.08,{status:"REVIEW"}))],
  ["C",record(plan("C",.6))],
  ["D",record(plan("D",2.8))],
  ["E",record(plan("E",1.1),10_000)],
  ["F",record(plan("F",1.1),50*60_000)],
  ["G",record(plan("G",1.1,{score:80}))],
 ]);
 assert.deepEqual(selectNearEntryRechecks(cache,new Set(),new Set(cache.keys()),now),[]);
});
test("rechecks no more than four, and rejects invalid input",()=>{
 const cache=new Map(Array.from({length:8},(_,i)=>{
   const symbol="PAIR"+i;return [symbol,record(plan(symbol,.9+i*.01))];
 }));
 assert.equal(selectNearEntryRechecks(cache,new Set(),new Set(cache.keys()),now).length,4);
 assert.throws(()=>selectNearEntryRechecks(cache,new Set(),new Set(cache.keys()),now,5));
});
