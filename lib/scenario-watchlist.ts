/**
 * Research-only lifecycle for potential 24-hour pending Limit entries.
 * This tracks *conditions*, not an exchange order or an expected fill.
 * No orders, no background process, no market requests.
 */
import type {TradePlan} from "./trading.ts";
import {select24hLimitRecommendations} from "./24h-recommendations.ts";

export const SCENARIO_ENTRY_HORIZON_MS=86_400_000;
export const SCENARIO_FRESHNESS_MS=4*60_000;

export type ScenarioState="WATCHING"|"READY_FOR_REVIEW"|"STALE"|"EXPIRED"|"NO_CURRENT_PLAN";
export type WatchedScenario={
 symbol:string; direction:TradePlan["direction"]; state:ScenarioState;
 firstSeenAt:number; lastCheckedAt:number; validUntil:number; transitions:number;
 entry:number; stop:number; target:number; rr:number; score:number;
 confirmedConditions:string[]; pendingConditions:string[];
 note:string; hasFreshPlan:boolean; orderAuthorized:false;
};
function conditions(plan:TradePlan):{confirmed:string[];pending:string[]} {
 const checks:[string,boolean][]=[
  ["Технічний сценарій ACTIVE",plan.status==="ACTIVE"],
  ["Пройдено дослідний фільтр якості",plan.qualityGate?.passed===true],
  ["Структурний Limit Entry підтверджений",plan.structure?.confirmedEntry===true],
  ["Структурний Take Profit підтверджений",plan.structure?.confirmedTarget===true],
  ["Історичний 24h рух до Entry спостерігався",plan.limitEntry24h?.status==="HISTORICALLY_REACHABLE"&&
    (plan.limitEntry24h?.sampleWindows??0)>=60],
  ["R:R не менше 1:2",Number.isFinite(plan.riskReward)&&plan.riskReward>=2],
 ];
 return {confirmed:checks.filter(x=>x[1]).map(x=>x[0]),
  pending:checks.filter(x=>!x[1]).map(x=>x[0])};
}
export function updateWatchedScenario(
 previous:WatchedScenario|undefined, plan:TradePlan|null, now:number,
):WatchedScenario|undefined {
 if(!Number.isSafeInteger(now)||now<0)throw Error("Invalid observation time");
 if(!plan&&!previous)return undefined;
 if(!plan){
   const prior=previous!;
   const state:ScenarioState=now>=prior.validUntil?"EXPIRED":"NO_CURRENT_PLAN";
   return {...prior,state,lastCheckedAt:now,hasFreshPlan:false,orderAuthorized:false,
     transitions:prior.transitions+Number(state!==prior.state),
     note:state==="EXPIRED"?"24-годинний горизонт спостереження завершився.":
       "Повторний аналіз не підтвердив чинний план. Це не сигнал до заявки."};
 }
 const observed=plan.observation?.observedAt??now;
 if(!Number.isSafeInteger(observed)||observed>now||now-observed>SCENARIO_FRESHNESS_MS)
   throw Error("Cannot promote a stale or future market observation");
 const freshEpisode=!previous||previous.direction!==plan.direction||now>=previous.validUntil;
 const firstSeenAt=freshEpisode?observed:previous.firstSeenAt;
 const validUntil=firstSeenAt+SCENARIO_ENTRY_HORIZON_MS;
 const checks=conditions(plan);
 const ready=select24hLimitRecommendations([plan]).length===1;
 const state:ScenarioState=ready?"READY_FOR_REVIEW":"WATCHING";
 return {
   symbol:plan.symbol,direction:plan.direction,state,firstSeenAt,lastCheckedAt:now,validUntil,
   transitions:freshEpisode?0:previous.transitions+Number(previous.state!==state),
   entry:plan.entryPrice,stop:plan.stopLoss,target:plan.takeProfit2,
   rr:plan.riskReward,score:plan.score,confirmedConditions:checks.confirmed,
   pendingConditions:checks.pending,hasFreshPlan:true,orderAuthorized:false,
   note:ready?
     "Усі дослідницькі фільтри виконано. Перед ручною Demo-заявкою необхідна окрема серверна перевірка.":
     "Перспективний сценарій спостереження, не готова рекомендація. Очікуємо невиконані умови.",
 };
}
export function ageWatchedScenario(scenario:WatchedScenario,now:number):WatchedScenario {
 if(!Number.isSafeInteger(now)||now<0)throw Error("Invalid observation time");
 const state:ScenarioState=now>=scenario.validUntil?"EXPIRED":
   now-scenario.lastCheckedAt>SCENARIO_FRESHNESS_MS?"STALE":scenario.state;
 if(state===scenario.state)return scenario;
 return {...scenario,state,hasFreshPlan:false,orderAuthorized:false,
   transitions:scenario.transitions+1,
   note:state==="EXPIRED"?"Минув 24-годинний горизонт від першого аналізу.":
     "Дані застаріли. Очікуємо повторну перевірку цієї пари.",
 };
}
export function selectWatchedScenarios(scenarios:readonly WatchedScenario[],maximum=20):WatchedScenario[]{
 if(!Number.isInteger(maximum)||maximum<0||maximum>100)throw Error("Invalid watchlist limit");
 return scenarios.filter(s=>s.state==="WATCHING"&&s.hasFreshPlan&&s.pendingConditions.length>0)
   .sort((a,b)=>b.confirmedConditions.length-a.confirmedConditions.length||
      b.score-a.score||b.rr-a.rr||a.symbol.localeCompare(b.symbol))
   .slice(0,maximum);
}
