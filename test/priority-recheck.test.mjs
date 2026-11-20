import assert from "node:assert/strict";
import {test} from "node:test";
import {selectPriorityRechecks,PRIORITY_RECHECK_LIMIT} from "../lib/priority-recheck.ts";

const now=1_000_000;
function record(symbol,overrides={},age=120_000){
  return {checkedAt:now-age,plan:{
    symbol,status:"REVIEW",score:88,readiness:{met:7,total:8},
    limitEntry24h:{distanceAtr:1.1},qualityGate:{passed:false,reasons:[]},
    ...overrides,
  }};
}
test("prioritizes near-entry ACTIVE, then other ACTIVE, then 7/8",()=>{
  const data=new Map([
    ["SEVEN",record("SEVEN")],
    ["ACTIVE",record("ACTIVE",{status:"ACTIVE",score:95,readiness:{met:8,total:8}})],
    ["ASTER",record("ASTER",{status:"ACTIVE",score:93,readiness:{met:8,total:8},qualityGate:{passed:false,reasons:["Ціна занадто далеко від входу."]}})],
  ]);
  assert.deepEqual(selectPriorityRechecks(data,new Set(),new Set(data.keys()),now),["ASTER","ACTIVE","SEVEN"]);
});
test("does not starve sweep, refresh recently checked plans or revive old records",()=>{
  const data=new Map([
    ["SWEEP",record("SWEEP")],
    ["RECENT",record("RECENT",{},10_000)],
    ["OLD",record("OLD",{},46*60_000)],
    ["WEAK",record("WEAK",{score:60,readiness:{met:6,total:8}})],
    ["OK",record("OK")],
  ]);
  assert.deepEqual(selectPriorityRechecks(data,new Set(["SWEEP"]),new Set(data.keys()),now),["OK"]);
});
test("bounded by maximum and rejects invalid input",()=>{
  const data=new Map(Array.from({length:20},(_,i)=>["P"+i,record("P"+i)]));
  assert.equal(selectPriorityRechecks(data,new Set(),new Set(data.keys()),now).length,PRIORITY_RECHECK_LIMIT);
  assert.throws(()=>selectPriorityRechecks(data,new Set(),new Set(data.keys()),now,9));
});
