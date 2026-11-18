import assert from "node:assert/strict";
import {test} from "node:test";
import {updateWatchedScenario,ageWatchedScenario,selectWatchedScenarios,
  SCENARIO_ENTRY_HORIZON_MS,SCENARIO_FRESHNESS_MS} from "../lib/scenario-watchlist.ts";
const now=Date.UTC(2026,10,18,10);
const plan=(other={})=>({
 symbol:"BTCUSDT",direction:"LONG",score:81,status:"REVIEW",entryPrice:100,
 stopLoss:97,takeProfit2:110,riskReward:3.33,observation:{observedAt:now},
 readiness:{met:5,total:8,missing:["Немає підтвердження 30m"]},
 qualityGate:{passed:false,reasons:["Оцінка сигналу недостатня"],policy:"intraday-quality-v1"},
 structure:{confirmedEntry:true,confirmedTarget:true},
 limitEntry24h:{horizonHours:24,status:"HISTORICALLY_REACHABLE",sampleWindows:120},
 ...other,
});
test("watch potential entry with explicit pending conditions and original 24h deadline",()=>{
 const first=updateWatchedScenario(undefined,plan(),now);
 assert.ok(first);assert.equal(first.state,"WATCHING");
 assert.equal(first.firstSeenAt,now);
 assert.equal(first.validUntil-now,SCENARIO_ENTRY_HORIZON_MS);
 assert.ok(first.pendingConditions.includes("Пройдено дослідний фільтр якості"));
 assert.equal(first.orderAuthorized,false);
 const later=updateWatchedScenario(first,plan({score:86,observation:{observedAt:now+60000}}),now+60000);
 assert.equal(later?.firstSeenAt,now);
 assert.equal(later?.state,"WATCHING");
 assert.equal(later?.validUntil,first.validUntil);
});
test("only strict quality and structure promote plan to review-ready",()=>{
 const watching=updateWatchedScenario(undefined,plan(),now);
 const readyPlan=plan({status:"ACTIVE",score:94,
 qualityGate:{passed:true,reasons:[],policy:"intraday-quality-v1"},
 readiness:{met:8,total:8,missing:[]}});
 const updated=updateWatchedScenario(watching,readyPlan,now+3000);
 assert.equal(updated.state,"READY_FOR_REVIEW");
 assert.equal(updated.transitions,1);
 assert.equal(updated.pendingConditions.length,0);
 assert.equal(updated.orderAuthorized,false);
});
test("stale, vanished and expired are not recommendations; errors must not promote",()=>{
 const first=updateWatchedScenario(undefined,plan(),now);
 const stale=ageWatchedScenario(first,now+SCENARIO_FRESHNESS_MS+1);
 assert.equal(stale.state,"STALE");assert.equal(stale.hasFreshPlan,false);
 const vanished=updateWatchedScenario(first,null,now+6000);
 assert.equal(vanished.state,"NO_CURRENT_PLAN");
 assert.equal(selectWatchedScenarios([stale,vanished]).length,0);
 assert.equal(ageWatchedScenario(first,now+SCENARIO_ENTRY_HORIZON_MS).state,"EXPIRED");
 assert.throws(()=>updateWatchedScenario(first,plan({observation:{observedAt:now}}),now+SCENARIO_FRESHNESS_MS+1),/stale/);
});
test("a new direction starts a new forecast episode; never exceed specified shortlist",()=>{
 const first=updateWatchedScenario(undefined,plan(),now);
 const opposite=updateWatchedScenario(first,plan({direction:"SHORT",observation:{observedAt:now+1000}}),now+1000);
 assert.equal(opposite.firstSeenAt,now+1000);
 assert.equal(opposite.transitions,0);
 assert.equal(selectWatchedScenarios([first,opposite],1).length,1);
 assert.equal(selectWatchedScenarios([],10).length,0);
});
