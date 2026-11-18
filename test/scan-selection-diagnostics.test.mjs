import assert from "node:assert/strict";
import {test} from "node:test";
import {summarize24hSelection} from "../lib/scan-selection-diagnostics.ts";
const plan=(extras={})=>({
 symbol:"BTCUSDT",status:"ACTIVE",riskReward:2.5,score:95,
 qualityGate:{passed:true},structure:{confirmedEntry:true,confirmedTarget:true},
 limitEntry24h:{status:"HISTORICALLY_REACHABLE",sampleWindows:120,horizonHours:24},
 nextStep:"Перевірте план",...extras,
});
test("selection diagnostics explain each strict filtering stage",()=>{
 const r=summarize24hSelection([
  plan(),plan({qualityGate:{passed:false}}),
  plan({structure:{confirmedEntry:false,confirmedTarget:true}}),
  plan({limitEntry24h:{status:"INSUFFICIENT_HISTORY",sampleWindows:0,horizonHours:24}}),
  plan({riskReward:1}),
  plan({status:"REVIEW",nextStep:"Сценарій потребує повторного аналізу"}),
 ]);
 assert.deepEqual(r,{availablePlans:6,technicalActive:5,qualityPassed:4,
  structuralEntryAndTarget:3,historicallyReachable24h:2,eligible24h:1,
  hiddenByFreshness:1,activeQualityFailures:1,qualityFailures:[{reason:"Фільтр якості не повернув причини.",count:1}]});
});
test("empty sample stays empty rather than fabricating candidate",()=>{
 assert.equal(summarize24hSelection([]).eligible24h,0);
});

test("reports independent reasons for each rejected ACTIVE candidate",()=>{
 const result=summarize24hSelection([
  plan({qualityGate:{passed:false,reasons:["Недостатня оцінка сигналу.","Низька готовність."]}}),
  plan({qualityGate:{passed:false,reasons:["Недостатня оцінка сигналу."]}}),
  plan({status:"REVIEW",qualityGate:{passed:false,reasons:["Не враховувати REVIEW."]}}),
 ]);
 assert.equal(result.activeQualityFailures,2);
 assert.deepEqual(result.qualityFailures,[
  {reason:"Недостатня оцінка сигналу.",count:2},
  {reason:"Низька готовність.",count:1},
 ]);
});
