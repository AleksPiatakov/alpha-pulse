/** Research-only strict 24h Limit shortlist. Not order authorization. */
import type { TradePlan } from "./trading.ts";
export function select24hLimitRecommendations(plans: readonly TradePlan[], maximum=10): TradePlan[] {
  if(!Number.isInteger(maximum)||maximum<0||maximum>100) throw Error("Некоректний розмір рейтингу.");
  return plans.filter(p =>
    p.status==="ACTIVE" &&
    p.qualityGate?.passed===true &&
    p.limitEntry24h?.horizonHours===24 &&
    p.limitEntry24h.status==="HISTORICALLY_REACHABLE" &&
    p.limitEntry24h.sampleWindows>=60 &&
    p.structure?.confirmedEntry===true &&
    p.structure?.confirmedTarget===true &&
    Number.isFinite(p.riskReward)&&p.riskReward>=2
  ).sort((a,b)=>b.score-a.score||b.riskReward-a.riskReward||
    a.symbol.localeCompare(b.symbol)).slice(0,maximum);
}
