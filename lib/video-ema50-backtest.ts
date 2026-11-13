/** Close-only walk-forward for the exact EMA50 video setup.
 * No orders. A signal confirmed on a closed 15m bar enters at NEXT bar open
 * (market approximation). Stops/takes are fixed percentages of that fill.
 */
import { evaluateVideoEma50, realizedVolatilityPercent, VIDEO_EMA_SETTINGS,
  type EmaBar, type EmaDirection } from "./video-ema50-strategy.ts";
export type EmaCostMode="reference"|"conservative";
export type EmaRewardModel="video-3r"|"comparison-2r";
export type EmaReplayTrade={
 signalTime:number;entryTime:number;exitTime:number;direction:EmaDirection;
 entry:number;stop:number;target:number;exit:number;outcome:"TP"|"SL";
 netR:number;holdingBars:number;
};
export type VideoEmaResult={
 strategy:"ema50-video-v1";symbol:string;model:EmaRewardModel;costMode:EmaCostMode;
 volatilityAnnualizedPct:number|null;signals:number;trades:number;wins:number;losses:number;
 winRate:number|null;averageNetR:number|null;totalNetR:number;maxDrawdownR:number;
 stopPercent:2.5;takePercent:7.5|5;feesPerSide:number; censored:number;
 from:number|null;to:number|null;tradesJournal:EmaReplayTrade[];
 assumption:string[];
};
function validate(bars:EmaBar[],intervalMs:number):EmaBar[]{
  if(!Array.isArray(bars))throw Error("Немає свічок");
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(!Number.isSafeInteger(b.time)||b.time<0||b.time%intervalMs!==0||
      i>0&&b.time<=bars[i-1].time||
      ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||
      b.low<=0||b.volume<0||b.low>b.open||b.low>b.close||b.high<b.open||b.high<b.close)
      throw Error("Некоректна або невпорядкована історична свічка");
  }
  return bars;
}
export function replayVideoEma50(symbol:string,m15:EmaBar[],h1:EmaBar[],h4:EmaBar[],
  model:EmaRewardModel="video-3r",costMode:EmaCostMode="conservative"):VideoEmaResult {
  if(!/^[A-Z0-9]{3,24}USDT$/.test(symbol))throw Error("Невірна пара");
  validate(m15,900000);validate(h1,3600000);validate(h4,14400000);
  const takePercent=model==="video-3r"?7.5:5;
  const fee=costMode==="conservative"?.00075:.00055;
  const trades:EmaReplayTrade[]=[];
  let signals=0,censored=0;
  const lastSignalIndex=m15.length-2; // next bar open needed
  let i=0,one=0,four=0;
  while(i<=lastSignalIndex){
    const decisionTime=m15[i].time+900000;
    while(one<h1.length&&h1[one].time+3600000<=decisionTime)one++;
    while(four<h4.length&&h4[four].time+14400000<=decisionTime)four++;
    if(i<60||one<60||four<60){i++;continue;}
    const signal=evaluateVideoEma50(
      m15.slice(Math.max(0,i-199),i+1),
      h1.slice(Math.max(0,one-199),one),
      h4.slice(Math.max(0,four-199),four),VIDEO_EMA_SETTINGS);
    if(!signal){i++;continue;}
    signals++;
    const next=i+1,entry=m15[next].open,dir=signal.direction;
    const stop=entry*(dir==="LONG"?.975:1.025);
    const target=entry*(dir==="LONG"?1+takePercent/100:1-takePercent/100);
    const risk=Math.abs(entry-stop);
    const end=m15.length; // Video does not specify a time stop; hold until TP/SL or end of available history.
    let finished=false;
    for(let j=next;j<end;j++){
      const bar=m15[j];
      const sl=dir==="LONG"?bar.low<=stop:bar.high>=stop;
      const tp=dir==="LONG"?bar.high>=target:bar.low<=target;
      // Unknown intrabar order: stop has priority over take.
      const outcome=sl?"SL":tp?"TP":null;
      if(!outcome)continue;
      let exit=outcome==="SL"?stop:target;
      if(costMode==="conservative"&&outcome==="SL"){
        exit=dir==="LONG"?Math.min(exit,bar.open):Math.max(exit,bar.open);
        exit*=dir==="LONG"?.999:1.001;
      }
      // Market entry: adverse 5 bps spread/slippage reference only in conservative.
      const actualEntry=costMode==="conservative"
        ?entry*(dir==="LONG"?1.0005:.9995):entry;
      const gross=dir==="LONG"?exit-actualEntry:actualEntry-exit;
      const net=gross-fee*(actualEntry+exit);
      trades.push({signalTime:decisionTime,entryTime:m15[next].time,exitTime:bar.time,
        direction:dir,entry:actualEntry,stop,target,exit,outcome,holdingBars:j-next+1,
        netR:Number((net/risk).toFixed(4))});
      i=j+1;finished=true;break;
    }
    if(!finished){censored++;i=end;}
  }
  let cumulative=0,peak=0,maxDD=0;
  for(const t of trades){cumulative+=t.netR;peak=Math.max(peak,cumulative);maxDD=Math.max(maxDD,peak-cumulative);}
  const wins=trades.filter(t=>t.netR>0).length;
  return {strategy:"ema50-video-v1",symbol,model,costMode,
    volatilityAnnualizedPct:realizedVolatilityPercent(h1),
    signals,trades:trades.length,wins,losses:trades.length-wins,
    winRate:trades.length?Number((wins/trades.length*100).toFixed(2)):null,
    averageNetR:trades.length?Number((cumulative/trades.length).toFixed(4)):null,
    totalNetR:Number(cumulative.toFixed(4)),maxDrawdownR:Number(maxDD.toFixed(4)),
    stopPercent:2.5,takePercent,feesPerSide:fee,censored,
    from:m15[0]?.time??null,to:m15.at(-1)?.time??null,tradesJournal:trades,
    assumption:[
      "EMA50 4h та 1h: нахил за 10 свічок ≥0,3%; 1h торкання EMA за останні 16 закритих свічок із допуском 0,2%.",
      "15m: підтверджений перехід ціни закриття через EMA50 у напрямку старшого тренду.",
      "Вхід на open НАСТУПНОЇ 15m свічки, лише завершені на момент сигналу 1h/4h.",
      "Stop 2,5% від входу; Take 7,5% або 5%, для порівняння 3R та 2R без оптимізації.",
      "Одна позиція за раз; часовий вихід у відео не визначений, тримаємо до SL/TP або кінця історії. При одночасному дотику SL має пріоритет.",
      costMode==="conservative"
        ?"Комісія 0,075% на бік, 5 bps несприятливий вхід, SL gap +10 bps."
        :"Комісія 0,055% на бік, без додаткового прослизання.",
      "Позиції без фактичного досягнення SL/TP до кінця історії — censored; не враховано funding та реальну чергу ордерів.",
      "Результати не є перевіреною перевагою чи дозволом на Demo-заявки.",
    ]};
}
