import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const original=process.cwd();
const scratch=await mkdtemp(join(tmpdir(),"alpha-pulse-journal-test-"));
process.chdir(scratch);
const {recordScenarioTransitions,readScenarioHistory}=await import("../lib/scenario-event-journal.ts");
const now=1_000_000;
const base={
 symbol:"ASTERUSDT",direction:"SHORT",status:"REVIEW",score:91,
 readiness:{met:7,total:8,missing:["Недостатній обсяг"]},
 qualityGate:{passed:false,reasons:[]},
 entryPrice:100,stopLoss:102,takeProfit2:95,riskReward:2.5
};
test("persists transitions and ignores unchanged quotes",async()=>{
 assert.equal(await recordScenarioTransitions([{symbol:"ASTERUSDT",plan:base,unavailable:false}],now),1);
 assert.equal(await recordScenarioTransitions([{symbol:"ASTERUSDT",plan:{...base,currentPrice:99.9},unavailable:false}],now+1000),0);
 const history=await readScenarioHistory("ASTERUSDT",10);
 assert.equal(history.length,1);
 assert.equal(history[0].state,"NEAR_READY");
 assert.equal(history[0].readiness,"7/8");
 const payload=await readFile(join(scratch,".alpha-pulse-history","events.jsonl"),"utf8");
 assert.match(payload,/ASTERUSDT/);
});
test("records verified readiness changes and unverified data without promoting an order",async()=>{
 const ready={...base,status:"ACTIVE",score:94,
  readiness:{met:8,total:8,missing:[]},
  qualityGate:{passed:true,reasons:[]},
  structure:{confirmedEntry:true,confirmedTarget:true},
  limitEntry24h:{horizonHours:24,status:"HISTORICALLY_REACHABLE",sampleWindows:65}};
 assert.equal(await recordScenarioTransitions([{symbol:"ASTERUSDT",plan:ready,unavailable:false}],now+2000),1);
 assert.equal(await recordScenarioTransitions([{symbol:"ASTERUSDT",plan:null,unavailable:true}],now+3000),1);
 const history=await readScenarioHistory("ASTERUSDT",10);
 assert.deepEqual(history.slice(0,2).map(x=>x.state),["UNVERIFIED","READY"]);
 assert.equal(Object.hasOwn(history[0],"orderAuthorized"),false);
});
test.after(async()=>{process.chdir(original);await rm(scratch,{recursive:true,force:true});});
