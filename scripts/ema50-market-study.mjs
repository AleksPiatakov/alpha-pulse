/**
 * Read-only one-off market study for EMA50. No API credentials or order calls.
 * Run: node --experimental-strip-types scripts/ema50-market-study.mjs
 * Results in /tmp? Output directory defaults to ./ema50-study-output, not committed.
 */
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {getEmaStudy, EMA50_CUTOFF} from "../lib/video-ema50-history.ts";
import {replayVideoEma50} from "../lib/video-ema50-backtest.ts";

const days=process.env.EMA50_DAYS==="365"?365:120;
const primary=["BTCUSDT","ETHUSDT","SOLUSDT"];
const possibleLow=["XRPUSDT","ADAUSDT","LTCUSDT","TRXUSDT","XLMUSDT","LINKUSDT","BCHUSDT","ETCUSDT"];
const observations={};
const errors={};
for(const symbol of [...primary,...possibleLow]){
  try{
    const snapshot=await getEmaStudy(symbol,days);
    const m=snapshot.candles;
    const models=[];
    for(const rr of ["video-3r","comparison-2r"])
      for(const cost of ["reference","conservative"]){
        const result=replayVideoEma50(symbol,m["15"],m["60"],m["240"],rr,cost);
        models.push(result);
      }
    observations[symbol]={
      symbol,volatilityAnnualizedPct:models[0].volatilityAnnualizedPct,
      snapshotSha256:snapshot.sha256,models,
    };
    const a=models.find(r=>r.model==="video-3r"&&r.costMode==="conservative");
    console.log(symbol+" vol="+a.volatilityAnnualizedPct+"% signals="+a.signals+
      " trades="+a.trades+" win="+a.winRate+"% netR="+a.totalNetR+
      " drawdownR="+a.maxDrawdownR);
  }catch(e){
    errors[symbol]=e instanceof Error?e.message:String(e);
    console.error(symbol+" EXCLUDED: "+errors[symbol]);
  }
}
const eligible=possibleLow.filter(s=>Number.isFinite(observations[s]?.volatilityAnnualizedPct))
  .sort((a,b)=>observations[a].volatilityAnnualizedPct-observations[b].volatilityAnnualizedPct);
const low=eligible.slice(0,3);
const result={
  schema:"alpha-pulse-ema50-study-v1",createdAt:new Date().toISOString(),
  cutoff:EMA50_CUTOFF,days,source:"bybit-public-linear",
  core:primary,lowVolatilityFrom:possibleLow,measuredLowerVolatility:low,
  selectionIsExploratory:true,independentHoldout:false,
  observed:observations,errors,
  warnings:[
    "Ретроспективний відбір менш волатильних пар на цьому ж періоді не є holdout.",
    "Витрати моделюються; реальні spread, funding, market impact не підтверджені.",
    "Немає підтвердженого статистичного торгового edge або дозволу на Demo-ордери.",
    "Без повної історії пара виключається з порівняння, а не отримує умовні результати.",
  ],
};
const directory=path.resolve("ema50-study-output");
await mkdir(directory,{recursive:true});
await writeFile(path.join(directory,"ema50-study-"+days+"d.json"),JSON.stringify(result,null,2));
console.log("CORE: "+primary.join(", "));
console.log("MEASURED LOW COHORT: "+(low.join(", ")||"NONE"));
console.log("SAVED: "+path.join(directory,"ema50-study-"+days+"d.json"));
if(!primary.every(s=>observations[s])||low.length<3){
  console.error("INSUFFICIENT DATA: primary group or measured low-vol cohort incomplete");
  process.exitCode=1;
}
