import type {TradePlan} from "./trading.ts";
import {select24hLimitRecommendations} from "./24h-recommendations.ts";

export type ReadyAlert={
  symbol:string;direction:"LONG"|"SHORT";score:number;readiness:number;
  entry:number;stop:number;target:number;rr:number;riskPct:number;riskUsdt:number;
  verifiedAt:number;planId:string;
};
export type AlertEvent={kind:"READY"|"CANCELLED";symbol:string;alert?:ReadyAlert};
export function reconcileAlerts(previous:ReadonlySet<string>,current:readonly ReadyAlert[]):AlertEvent[]{
  const next=new Map(current.map(x=>[x.symbol,x]));
  return [...previous].filter(x=>!next.has(x)).sort().map(symbol=>({kind:"CANCELLED" as const,symbol}))
    .concat([...next.values()].filter(x=>!previous.has(x.symbol))
      .sort((a,b)=>a.symbol.localeCompare(b.symbol))
      .map(alert=>({kind:"READY" as const,symbol:alert.symbol,alert})));
}
export function isAlertEligiblePlan(plan:TradePlan,now:number):boolean{
  const at=plan.observation?.observedAt;
  return Number.isFinite(now)&&typeof at==="number"&&Number.isFinite(at)&&
    at<=now&&now-at<=4*60_000&&
    plan.score>=90&&plan.readiness?.total===8&&plan.readiness.met===8&&
    plan.qualityGate?.passed===true&&
    typeof plan.limitEntry24h?.distanceAtr==="number"&&
    Number.isFinite(plan.limitEntry24h.distanceAtr)&&
    plan.limitEntry24h.distanceAtr<=0.75&&
    select24hLimitRecommendations([plan]).length===1;
}
