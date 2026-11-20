/**
 * Research-only diagnostic: is a fixed TP close to a visible daily swing
 * or the observed range extreme? Not a trading gate or price forecast.
 */
import {confirmedSwingLevels, type PriceBar, type TechnicalDirection} from "./technical-plan-core.ts";

export type TpObstacleDiagnostic={
  status:"NEAR_OBSTACLE"|"NO_NEAR_OBSTACLE"|"INSUFFICIENT_DATA";
  level:number|null;
  kind:"daily_swing"|"observed_extreme"|null;
  distancePercent:number|null;
  lookbackBars:number;
};
export function assessTpObstacle(
  daily:readonly PriceBar[],direction:TechnicalDirection,
  entry:number,stop:number,target:number,
):TpObstacleDiagnostic{
  const insufficient={status:"INSUFFICIENT_DATA" as const,level:null,kind:null,
    distancePercent:null,lookbackBars:daily.length};
  if(daily.length<30||![entry,stop,target].every(x=>Number.isFinite(x)&&x>0)||
    (direction==="LONG"?!(stop<entry&&target>entry):!(stop>entry&&target<entry))||
    daily.some(b=>![b.high,b.low,b.close].every(Number.isFinite)))return insufficient;
  const risk=Math.abs(entry-stop);
  const tolerance=Math.max(risk*0.45,target*0.003);
  const lowsOrHighs=daily.map(b=>direction==="SHORT"?b.low:b.high);
  const extreme=direction==="SHORT"?Math.min(...lowsOrHighs):Math.max(...lowsOrHighs);
  const swings=confirmedSwingLevels([...daily],direction,entry,"target");
  const nearest=swings.length?
    [...swings].sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0]:null;
  const nearSwing=nearest!==null&&Math.abs(nearest-target)<=tolerance;
  const nearExtreme=Math.abs(extreme-target)<=tolerance;
  const level=nearSwing?nearest:nearExtreme?extreme:nearest??extreme;
  return {
    status:nearSwing||nearExtreme?"NEAR_OBSTACLE":"NO_NEAR_OBSTACLE",
    level,
    kind:nearSwing?"daily_swing":nearExtreme?"observed_extreme":nearest!==null?"daily_swing":"observed_extreme",
    distancePercent:level===null?null:Number((Math.abs(level-target)/target*100).toFixed(2)),
    lookbackBars:daily.length,
  };
}
