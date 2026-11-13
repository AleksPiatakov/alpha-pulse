/**
 * EMA50 MTF strategy from the supplied video's explicit rules.
 * Independent research-only detector: 4h+1h EMA slope, 1h EMA touch,
 * 15m completed-candle cross in trend direction.
 * Settings from video: slope lookback 10, flat threshold .3%, touch last 16
 * completed 1h bars with .2% tolerance. All percentages are relative to EMA.
 */
export type EmaBar = {time:number;open:number;high:number;low:number;close:number;volume:number};
export type EmaDirection = "LONG"|"SHORT";
export type EmaSettings = {
  period:50;slopeBars:10;flatPercent:number;touchLookback:number;touchTolerancePercent:number;
};
export const VIDEO_EMA_SETTINGS:Readonly<EmaSettings> = Object.freeze({
  period:50,slopeBars:10,flatPercent:0.3,touchLookback:16,touchTolerancePercent:0.2,
});
export type EmaSignal = {
  direction:EmaDirection; signalTime:number; close:number; ema15:number;
  ema1h:number;ema4h:number; touchedHourAt:number;settings:"ema50-video-v1";
};
export function emaSeries(bars:ReadonlyArray<EmaBar>, period=50):number[] {
  if(!Number.isInteger(period)||period<2)throw Error("Невірний період EMA");
  const values = new Array<number>(bars.length).fill(NaN);
  if(bars.length<period)return values;
  let current=bars.slice(0,period).reduce((sum,b)=>sum+b.close,0)/period;
  values[period-1]=current;
  const alpha=2/(period+1);
  for(let i=period;i<bars.length;i++) {
    current+=alpha*(bars[i].close-current);values[i]=current;
  }
  return values;
}
export function emaSlopeDirection(bars:ReadonlyArray<EmaBar>, settings:EmaSettings):EmaDirection|null {
  const emas=emaSeries(bars,settings.period);
  const last=emas.at(-1)!;
  const earlier=emas[emas.length-1-settings.slopeBars];
  if(!Number.isFinite(last)||!Number.isFinite(earlier)||!(earlier>0))return null;
  const pct=100*(last/earlier-1);
  if(Math.abs(pct)<settings.flatPercent)return null;
  const price=bars.at(-1)!.close;
  return pct>0&&price>last?"LONG":pct<0&&price<last?"SHORT":null;
}
function touchedEma(bar:EmaBar,ema:number,tolerance:number):boolean {
  const pad=ema*tolerance/100;
  return bar.low<=ema+pad && bar.high>=ema-pad;
}
export function evaluateVideoEma50(
  m15:ReadonlyArray<EmaBar>,h1:ReadonlyArray<EmaBar>,h4:ReadonlyArray<EmaBar>,
  settings:EmaSettings=VIDEO_EMA_SETTINGS,
):EmaSignal|null {
  if(m15.length<settings.period+1||h1.length<settings.period+settings.slopeBars||
    h4.length<settings.period+settings.slopeBars)return null;
  const d4=emaSlopeDirection(h4,settings),d1=emaSlopeDirection(h1,settings);
  if(!d4||d4!==d1)return null;
  const hours=emaSeries(h1,settings.period);
  let touchedHourAt=-1;
  for(let j=h1.length-1;j>=Math.max(settings.period-1,h1.length-settings.touchLookback);j--){
    if(touchedEma(h1[j],hours[j],settings.touchTolerancePercent)){
      touchedHourAt=h1[j].time;break;
    }
  }
  if(touchedHourAt<0)return null;
  const short=emaSeries(m15,settings.period);
  const last=m15.at(-1)!,previous=m15.at(-2)!;
  const lastEma=short.at(-1)!,priorEma=short.at(-2)!;
  const crossing=d1==="LONG"
    ? previous.close<=priorEma && last.close>lastEma
    : previous.close>=priorEma && last.close<lastEma;
  if(!crossing)return null;
  return {direction:d1,signalTime:last.time+900000,close:last.close,
    ema15:lastEma,ema1h:hours.at(-1)!,ema4h:emaSeries(h4,settings.period).at(-1)!,
    touchedHourAt,settings:"ema50-video-v1"};
}
/** Realized volatility of closed 1h log returns: annualized %, not a popularity measure. */
export function realizedVolatilityPercent(hourly:ReadonlyArray<EmaBar>):number|null {
  if(hourly.length<49)return null;
  const returns:number[]=[];
  for(let i=1;i<hourly.length;i++){
    if(!(hourly[i].close>0&&hourly[i-1].close>0))return null;
    returns.push(Math.log(hourly[i].close/hourly[i-1].close));
  }
  const avg=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-avg)**2,0)/(returns.length-1);
  return Number((Math.sqrt(variance)*Math.sqrt(24*365)*100).toFixed(2));
}
