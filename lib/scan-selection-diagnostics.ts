/**
 * Research-only diagnostic counts across *currently retained* scanner plans.
 * These figures are not estimates for the entire Bybit market until coverage is fresh.
 */
import type { TradePlan } from "./trading.ts";
export type SelectionDiagnostics = {
  availablePlans:number; technicalActive:number; qualityPassed:number;
  structuralEntryAndTarget:number; historicallyReachable24h:number;
  eligible24h:number; hiddenByFreshness:number;
  qualityFailures: Array<{ reason:string; count:number }>;
  activeQualityFailures: number;
  activeExamples: Array<{symbol:string; score:number; readiness:string; rr:number; distanceAtr:number|null; stopAtr:number|null; reasons:string[]}>;
};
export function summarize24hSelection(plans:readonly TradePlan[]):SelectionDiagnostics {
  const active=plans.filter(p=>p.status==="ACTIVE");
  const quality=active.filter(p=>p.qualityGate?.passed===true);
  const structure=quality.filter(p=>p.structure?.confirmedEntry===true&&p.structure?.confirmedTarget===true);
  const reach=structure.filter(p=>p.limitEntry24h?.status==="HISTORICALLY_REACHABLE"&&p.limitEntry24h.sampleWindows>=60);
  const failures=new Map<string,number>();
  for(const plan of active) {
    if(plan.qualityGate?.passed===true)continue;
    for(const reason of new Set(plan.qualityGate?.reasons??["Фільтр якості не повернув причини."]))
      failures.set(reason,(failures.get(reason)??0)+1);
  }
  const qualityFailures=[...failures].map(([reason,count])=>({reason,count}))
    .sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason,"uk"));
  const activeExamples=active.filter(p=>p.qualityGate?.passed!==true)
    .sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))
    .slice(0,5).map(p=>({
      symbol:p.symbol,score:p.score,
      readiness:`${p.readiness?.met??0}/${p.readiness?.total??8}`,
      rr:p.riskReward,distanceAtr:p.limitEntry24h?.distanceAtr??null,
      stopAtr:p.qualityGate?.stopAtr??null,
      reasons:[...(p.qualityGate?.reasons??[])],
    }));
  return {
    activeExamples,
    qualityFailures,activeQualityFailures:active.length-quality.length,
    availablePlans:plans.length,technicalActive:active.length,qualityPassed:quality.length,
    structuralEntryAndTarget:structure.length,historicallyReachable24h:reach.length,
    eligible24h:reach.filter(p=>p.riskReward>=2).length,
    hiddenByFreshness:plans.filter(p=>p.status==="REVIEW"&&
      p.nextStep.includes("повторного аналізу")).length,
  };
}
