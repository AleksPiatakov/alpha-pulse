/**
 * Local, research-only, durable scenario transition journal.
 * No API keys, no orders, no automatic trading. Server Node filesystem only.
 */
import {appendFile, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {TradePlan} from "./trading.ts";
import {select24hLimitRecommendations} from "./24h-recommendations.ts";

export type ScenarioEvent={
  at:number;symbol:string;direction:"LONG"|"SHORT";
  state:"READY"|"NEAR_READY"|"WATCHING"|"WITHDRAWN"|"UNVERIFIED";
  score:number;readiness:string;entry:number;stop:number;target:number;
  reasons:string[];
};
const folder=join(process.cwd(),".alpha-pulse-history");
const file=join(folder,"events.jsonl");
let loaded=false;
const previous=new Map<string,ScenarioEvent>();
const MAX_BYTES=20*1024*1024;

async function loadPrevious(){
  if(loaded)return;
  try{
    const contents=await readFile(file,"utf8");
    for(const line of contents.split("\n")){
      if(!line)continue;
      try{
        const event=JSON.parse(line) as ScenarioEvent;
        if(typeof event.symbol==="string"&&typeof event.state==="string"&&Number.isFinite(event.at))
          previous.set(event.symbol,event);
      }catch{ /* ignore incomplete trailing line */ }
    }
  }catch(err){
    if((err as NodeJS.ErrnoException).code!=="ENOENT")throw err;
  }
  loaded=true;
}
function eventFor(symbol:string, plan:TradePlan|null, at:number, unavailable:boolean):ScenarioEvent|null{
  const last=previous.get(symbol);
  if(!plan){
    if(!last||last.state==="WITHDRAWN"||last.state==="UNVERIFIED")return null;
    return {...last,at,state:unavailable?"UNVERIFIED":"WITHDRAWN",
      reasons:[unavailable?"Джерело Bybit не відповіло; сценарій не підтверджено.":"Новий аналіз не повернув чинного плану."]};
  }
  const ready=select24hLimitRecommendations([plan]).length===1;
  const near=plan.score>=85&&(plan.readiness?.met??0)>=7&&plan.readiness?.total===8;
  const tracked=ready||near||plan.status==="ACTIVE";
  if(!tracked&&!last)return null;
  const state:ScenarioEvent["state"]=ready?"READY":near?"NEAR_READY":tracked?"WATCHING":"WITHDRAWN";
  return {at,symbol,direction:plan.direction,state,score:plan.score,
    readiness:`${plan.readiness?.met??0}/${plan.readiness?.total??8}`,
    entry:plan.entryPrice,stop:plan.stopLoss,target:plan.takeProfit2,
    reasons:state==="WITHDRAWN"?["Сценарій більше не відповідає пріоритетним умовам."]:
      [...(plan.readiness?.missing??[]),...(plan.qualityGate?.reasons??[])].slice(0,6)};
}
function meaningful(event:ScenarioEvent,last?:ScenarioEvent){
  if(!last)return true;
  if(last.state!==event.state||last.direction!==event.direction)return true;
  if(event.state==="WITHDRAWN"||event.state==="UNVERIFIED")return false;
  // Record substantial level shifts, not every tiny quote movement.
  const moved=(a:number,b:number)=>a>0&&Math.abs(a-b)/a>=0.005;
  return moved(last.entry,event.entry)||moved(last.stop,event.stop)||moved(last.target,event.target);
}
export async function recordScenarioTransitions(
  observations:readonly {symbol:string;plan:TradePlan|null;unavailable:boolean}[],
  at:number,
):Promise<number>{
  if(!Number.isSafeInteger(at)||at<0)throw Error("Invalid scenario journal timestamp");
  await loadPrevious();
  const events:ScenarioEvent[]=[];
  for(const row of observations){
    const event=eventFor(row.symbol,row.plan,at,row.unavailable);
    if(event&&meaningful(event,previous.get(row.symbol))){
      events.push(event);
      previous.set(row.symbol,event);
    }
  }
  if(!events.length)return 0;
  await mkdir(folder,{recursive:true,mode:0o700});
  // Cap the journal size before growth becomes unbounded on always-on Macs.
  try{
    const info=await stat(file);
    if(info.size>MAX_BYTES){
      const current=await readFile(file,"utf8");
      const keep=current.split("\n").filter(Boolean).slice(-3000).join("\n")+"\n";
      await writeFile(file,keep,{mode:0o600});
    }
  }catch(err){if((err as NodeJS.ErrnoException).code!=="ENOENT")throw err;}
  await appendFile(file,events.map(x=>JSON.stringify(x)).join("\n")+"\n",{mode:0o600});
  return events.length;
}
export async function readScenarioHistory(symbol?:string,limit=100):Promise<ScenarioEvent[]>{
  if(!Number.isInteger(limit)||limit<1||limit>500)throw Error("Invalid history limit");
  try{
    const content=await readFile(file,"utf8");
    return content.split("\n").filter(Boolean).slice(-5000).reverse().flatMap(line=>{
      try{
        const event=JSON.parse(line) as ScenarioEvent;
        return event&&Number.isFinite(event.at)&&typeof event.symbol==="string"&&
          (!symbol||event.symbol===symbol)?[event]:[];
      }catch{return [];}
    }).slice(0,limit);
  }catch(err){
    if((err as NodeJS.ErrnoException).code==="ENOENT")return [];
    throw err;
  }
}
