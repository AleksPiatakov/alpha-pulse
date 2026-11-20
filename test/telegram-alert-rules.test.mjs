import assert from "node:assert/strict";
import {test} from "node:test";
import {reconcileAlerts,isAlertEligiblePlan} from "../lib/telegram-alert-rules.ts";
const now=1_000_000;
const base={symbol:"ASTERUSDT",direction:"SHORT",status:"ACTIVE",score:94,
 readiness:{met:8,total:8,missing:[]},qualityGate:{passed:true,reasons:[]},
 limitEntry24h:{horizonHours:24,status:"HISTORICALLY_REACHABLE",sampleWindows:64,distanceAtr:.4},
 structure:{confirmedEntry:true,confirmedTarget:true},riskReward:2.4,
 observation:{observedAt:now-20_000}};
test("requires the full ready gate and fresh market data",()=>{
 assert.equal(isAlertEligiblePlan(base,now),true);
 assert.equal(isAlertEligiblePlan({...base,score:89},now),false);
 assert.equal(isAlertEligiblePlan({...base,readiness:{met:7,total:8,missing:[]}},now),false);
 assert.equal(isAlertEligiblePlan({...base,qualityGate:{passed:false,reasons:[]}},now),false);
 assert.equal(isAlertEligiblePlan({...base,observation:{observedAt:now-300_000}},now),false);
 assert.equal(isAlertEligiblePlan({...base,limitEntry24h:{...base.limitEntry24h,distanceAtr:.9}},now),false);
});
test("only transition messages, not each poll",()=>{
 const alert={symbol:"ASTERUSDT",direction:"SHORT",score:94,readiness:8,
 entry:1,stop:1.02,target:.96,rr:2,riskPct:1,riskUsdt:50,verifiedAt:now,planId:"a"};
 assert.deepEqual(reconcileAlerts(new Set(),[alert]).map(x=>x.kind),["READY"]);
 assert.deepEqual(reconcileAlerts(new Set(["ASTERUSDT"]),[alert]),[]);
 assert.deepEqual(reconcileAlerts(new Set(["ASTERUSDT"]),[]).map(x=>x.kind),["CANCELLED"]);
});
