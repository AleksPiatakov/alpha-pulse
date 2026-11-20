/**
 * Supplemental research-only deep rechecks.
 * Never replaces the fair full-market sweep and never authorizes an order.
 */
import type {TradePlan} from "./trading.ts";

export const PRIORITY_RECHECK_LIMIT=8;
export const PRIORITY_RECHECK_INTERVAL_MS=60_000;
export const PRIORITY_MAX_AGE_MS=45*60_000;

export function selectPriorityRechecks(
  cached: ReadonlyMap<string,{plan:TradePlan;checkedAt:number}>,
  alreadySelected: ReadonlySet<string>,
  available: ReadonlySet<string>,
  now:number,
  maximum=PRIORITY_RECHECK_LIMIT,
):string[]{
  if(!Number.isSafeInteger(now)||now<0||!Number.isInteger(maximum)||maximum<0||maximum>PRIORITY_RECHECK_LIMIT)
    throw new Error("Invalid priority scan parameters");
  const choices:Array<{symbol:string;tier:number;distance:number;score:number;checkedAt:number}>=[];
  for(const [symbol,record] of cached){
    const {plan:p,checkedAt}=record;
    if(!available.has(symbol)||alreadySelected.has(symbol)||
       !Number.isSafeInteger(checkedAt)||checkedAt>now||
       now-checkedAt<PRIORITY_RECHECK_INTERVAL_MS||
       now-checkedAt>PRIORITY_MAX_AGE_MS)continue;
    const readiness=p.readiness;
    if(!readiness||readiness.total!==8||!Number.isFinite(p.score))continue;
    const distance=p.limitEntry24h?.distanceAtr;
    // ACTIVE setups and 7/8 setups are research priorities, not approved trades.
    // A near-entry rejected ACTIVE plan has first priority.
    const nearEntry=p.status==="ACTIVE"&&p.qualityGate?.passed===false&&
      p.qualityGate.reasons?.length===1&&
      p.qualityGate.reasons[0]==="Ціна занадто далеко від входу."&&
      readiness.met===8&&p.score>=90&&typeof distance==="number"&&
      Number.isFinite(distance)&&distance>0.75&&distance<=1.5;
    const active=p.status==="ACTIVE"&&readiness.met===8&&p.score>=90;
    const nearlyReady=readiness.met>=7&&p.score>=85;
    if(!nearEntry&&!active&&!nearlyReady)continue;
    choices.push({
      symbol,tier:nearEntry?0:active?1:2,
      distance:typeof distance==="number"&&Number.isFinite(distance)?distance:Infinity,
      score:p.score,checkedAt
    });
  }
  choices.sort((a,b)=>a.tier-b.tier||a.checkedAt-b.checkedAt||
    a.distance-b.distance||b.score-a.score||a.symbol.localeCompare(b.symbol));
  return choices.slice(0,maximum).map(c=>c.symbol);
}
