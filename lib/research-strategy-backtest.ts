/**
 * Independent walk-forward research simulator for the two experimental detectors.
 * No Bybit I/O, orders or future bars in signal generation.
 * Intrabar fill/order sequencing remains ambiguous: conservative SL-first.
 */
import { RESEARCH_STRATEGIES, type StrategyKey, type StrategyContext } from "./research-strategies.ts";
import { closedBarAt } from "./market-observation-clock.ts";
import type { ReplayBar, ReplayTimeframes } from "./mtf-backtest.ts";

export type ResearchExecution = "reference" | "conservative";
export type ResearchTrade = {
  strategy: StrategyKey; signalTime: number; entryTime: number; exitTime: number;
  direction: "LONG" | "SHORT"; entry: number; stop: number; target: number;
  exit: number; outcome: "SL" | "TP" | "TIMEOUT"; netR: number;
};
export type ResearchReplay = {
  strategy: StrategyKey; model: ResearchExecution; signals: number; unfilled: number;
  filled: number; wins: number; totalNetR: number; averageNetR: number | null;
  maxDrawdownR: number; trades: ResearchTrade[]; assumptions: string[];
};
const ms30 = 1_800_000;
function historyAt(bars: ReplayBar[], at: number, interval: "30"|"60"|"240"): ReplayBar[] {
  return bars.filter(b => closedBarAt(b.time, interval, at)).slice(-200);
}
function validSorted(raw: ReplayBar[]): ReplayBar[] {
  const bars = [...raw].sort((a,b)=>a.time-b.time);
  if(bars.some((b,i)=>!Number.isFinite(b.time) || b.time<0 ||
    (i>0 && b.time<=bars[i-1].time) || ![b.open,b.high,b.low,b.close].every(Number.isFinite) ||
    b.low<=0 || b.low>b.open || b.low>b.close || b.high<b.open || b.high<b.close))
    throw new Error("Історичні свічки пошкоджені або не впорядковані.");
  return bars;
}
const summary = (trades: ResearchTrade[]) => {
  let sum=0, peak=0, maxDrawdownR=0;
  for(const t of trades) {
    sum+=t.netR;peak=Math.max(peak,sum);maxDrawdownR=Math.max(maxDrawdownR,peak-sum);
  }
  return {wins:trades.filter(t=>t.netR>0).length,totalNetR:Number(sum.toFixed(3)),
    averageNetR:trades.length?Number((sum/trades.length).toFixed(3)):null,
    maxDrawdownR:Number(maxDrawdownR.toFixed(3))};
};
export function replayResearchStrategy(
  raw: ReplayTimeframes, symbol: string, tickSize: number, strategy: StrategyKey,
  model: ResearchExecution="conservative",
): ResearchReplay {
  if(!/^[A-Z0-9]{3,24}USDT$/.test(symbol) || !Number.isFinite(tickSize) || tickSize<=0)
    throw new Error("Невірна пара або tickSize.");
  const detector=RESEARCH_STRATEGIES.find(d=>d.key===strategy);
  if(!detector)throw new Error("Невідома дослідницька стратегія.");
  const bars={ "30":validSorted(raw["30"]), "60":validSorted(raw["60"]),
    "240":validSorted(raw["240"]) };
  let signals=0,unfilled=0;const trades:ResearchTrade[]=[];
  const fee=model==="conservative"?0.00075:0.00055;
  let i=0;
  while(i<bars["30"].length-1) {
    const decisionTime=bars["30"][i].time+ms30;
    const h30=historyAt(bars["30"],decisionTime,"30");
    const h1=historyAt(bars["60"],decisionTime,"60");
    const h4=historyAt(bars["240"],decisionTime,"240");
    if(h30.length<65 || h1.length<60 || h4.length<60){i++;continue;}
    const priceBars=(history:ReplayBar[])=>history.map(b=>({high:b.high,low:b.low,close:b.close}));
    const context: StrategyContext={symbol, signalAt:decisionTime,tickSize,
      m30:priceBars(h30),h1:priceBars(h1),h4:priceBars(h4)};
    const candidate=detector.evaluate(context);
    if(!candidate){i++;continue;}
    signals++;
    const {direction,entry,stop,target}=candidate;
    let entryIndex=-1;
    const endPending=Math.min(i+7,bars["30"].length); // 6 future 30m bars
    for(let j=i+1;j<endPending;j++) {
      const c=bars["30"][j];
      const touched=model==="conservative"
        ? (direction==="LONG"?c.low<=entry-tickSize:c.high>=entry+tickSize)
        : c.low<=entry&&c.high>=entry;
      if(touched){entryIndex=j;break;}
    }
    if(entryIndex<0){unfilled++;i=endPending;continue;}
    const endHolding=Math.min(entryIndex+48,bars["30"].length); // 24h max
    let closed=false;
    for(let j=entryIndex;j<endHolding;j++) {
      const c=bars["30"][j];
      const stopHit=direction==="LONG"?c.low<=stop:c.high>=stop;
      const targetHit=direction==="LONG"?c.high>=target:c.low<=target;
      const outcome=stopHit?"SL":targetHit?"TP":j===endHolding-1?"TIMEOUT":null;
      if(!outcome)continue;
      let exit=outcome==="SL"?stop:outcome==="TP"?target:c.close;
      if(model==="conservative" && outcome!=="TP"){
        if(outcome==="SL") exit=direction==="LONG"?Math.min(exit,c.open):Math.max(exit,c.open);
        exit*=direction==="LONG"
          ?1-(outcome==="SL"?10:5)/10000:1+(outcome==="SL"?10:5)/10000;
      }
      const risk=Math.abs(entry-stop);
      const net=(direction==="LONG"?exit-entry:entry-exit)-(entry+exit)*fee;
      trades.push({strategy,signalTime:decisionTime,entryTime:bars["30"][entryIndex].time,
        exitTime:c.time,direction,entry,stop,target,exit,outcome,
        netR:Number((net/risk).toFixed(4))});
      i=j+1;closed=true;break;
    }
    if(!closed)i=endHolding;
  }
  return {strategy,model,signals,unfilled,filled:trades.length,...summary(trades),trades,
    assumptions:[
      "Лише завершені свічки, рішення після закриття 30m; 1h/4h без підглядання майбутнього.",
      "Модель Limit-входу: до 6 наступних 30m свічок; консервативно потрібне проникнення 1 tick.",
      "Утримання до 24 годин після виконання; Stop Loss має пріоритет за одночасного торкання TP.",
      model==="conservative"?"Комісія 0.075% за сторону; SL 10 bps плюс несприятливий gap, TIMEOUT 5 bps.":"Комісія 0.055% за сторону; без додаткового прослизання.",
      "Одна модельна позиція/заявка на стратегію і пару. OHLC не показує реального порядку подій усередині свічки.",
      "Не враховано bid/ask spread, funding, ринковий вплив, портфельний ризик або зміну tickSize в історії.",
      "Сигнали з останніх свічок без достатнього майбутнього для моделювання не є підтвердженими результатами.",
      "Це дослідницька модель, не незалежна перевірка і не дозвіл на торгівлю.",
    ]};
}
