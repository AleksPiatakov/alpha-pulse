import assert from "node:assert/strict";
import {test} from "node:test";
import {select24hLimitRecommendations} from "../lib/24h-recommendations.ts";
const plan=(symbol,overrides={})=>({
  symbol,status:"ACTIVE",score:90,riskReward:2.3,
  qualityGate:{passed:true},structure:{confirmedEntry:true,confirmedTarget:true},
  limitEntry24h:{horizonHours:24,status:"HISTORICALLY_REACHABLE",sampleWindows:120},
  ...overrides,
});
test("strict 24h top-10 requires quality plus structural entry and target",()=>{
 const candidates=[
   plan("GOODUSDT"),plan("BADENTRYUSDT",{structure:{confirmedEntry:false,confirmedTarget:true},score:100}),
   plan("BADTPUSDT",{structure:{confirmedEntry:true,confirmedTarget:false},score:100}),
   plan("BADHISTORYUSDT",{limitEntry24h:{horizonHours:24,status:"INSUFFICIENT_HISTORY",sampleWindows:0},score:100}),
   plan("WRONGSIDUSDT",{limitEntry24h:{horizonHours:24,status:"ALREADY_AT_OR_BEYOND",sampleWindows:120},score:100}),
   plan("POORUSDT",{qualityGate:{passed:false},score:100}),
   plan("WAITUSDT",{status:"REVIEW",score:100}),
   plan("LOWRRUSDT",{riskReward:0.5,score:100}),
 ];
 assert.deepEqual(select24hLimitRecommendations(candidates).map(p=>p.symbol),["GOODUSDT"]);
});
test("shortlist returns no filler and ranks deterministically by score and RR",()=>{
 const items=Array.from({length:20},(_,i)=>plan("PAIR"+i+"USDT",{score:i,riskReward:2+i/10}));
 const top=select24hLimitRecommendations(items);
 assert.equal(top.length,10);
 assert.equal(top[0].symbol,"PAIR19USDT");
 assert.deepEqual(select24hLimitRecommendations(structuredClone(items)),top);
 assert.deepEqual(select24hLimitRecommendations([],10),[]);
 assert.throws(()=>select24hLimitRecommendations(items,-1));
});
