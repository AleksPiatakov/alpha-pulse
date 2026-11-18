/**
 * Research-only diagnostic counts across *currently retained* scanner plans.
 * These figures are not estimates for the entire Bybit market until coverage is fresh.
 */
import type { TradePlan } from "./trading.ts";
export type SelectionDiagnostics = {
  availablePlans:number; technicalActive:number; qualityPassed:number;
  structuralEntryAndTarget:number; historicallyReachable24h:number;
  eligible24h:number; hiddenByFreshness:number;
};
export function summarize24hSelection(plans:readonly TradePlan[]):SelectionDiagnostics {
  const active=plans.filter(p=>p.status==="ACTIVE");
  const quality=active.filter(p=>p.qualityGate?.passed===true);
  const structure=quality.filter(p=>p.structure?.confirmedEntry===true&&p.structure?.confirmedTarget===true);
  const reach=structure.filter(p=>p.limitEntry24h?.status==="HISTORICALLY_REACHABLE"&&p.limitEntry24h.sampleWindows>=60);
  return {
    availablePlans:plans.length,technicalActive:active.length,qualityPassed:quality.length,
    structuralEntryAndTarget:structure.length,historicallyReachable24h:reach.length,
    eligible24h:reach.filter(p=>p.riskReward>=2).length,
    hiddenByFreshness:plans.filter(p=>p.status==="REVIEW"&&
      p.nextStep.includes("повторного аналізу")).length,
  };
}
