/**
 * Fixed-cutoff Bybit public linear history for independent EMA50 study.
 * Explicit 120/365 day windows, checked history coverage, immutable local
 * sealed snapshots. Never private API or order endpoints.
 */
import {createHash} from "node:crypto";
import {readFile, mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
const PUBLIC_BYBIT_URL = "https://api.bybit.com"; // Public market candles only; no account API.
import type {EmaBar} from "./video-ema50-strategy.ts";
export const EMA50_CUTOFF = Date.parse("2026-11-12T00:00:00.000Z");
export type EmaStudyPeriod = 120|365;
type Frame="15"|"60"|"240";
const frames:Record<Frame,number>={"15":900000,"60":3600000,"240":14400000};
type DataContent={schema:1;source:"bybit-public-linear";symbol:string;
  cutoff:number;days:EmaStudyPeriod;capturedAt:string;
  candles:Record<Frame,EmaBar[]>;};
export type SavedEmaStudy=DataContent&{sha256:string};
function digest(content:DataContent):string{
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
function filepath(symbol:string,days:EmaStudyPeriod){
  if(!/^[A-Z0-9]{3,24}USDT$/.test(symbol)||![120,365].includes(days))
    throw Error("Некоректні параметри.");
  return path.join(process.cwd(),".alpha-pulse-ema50-snapshots",symbol+"-"+days+"-"+EMA50_CUTOFF+".json");
}
function verify(document:SavedEmaStudy):SavedEmaStudy {
  const {sha256,...content}=document;
  if(content.schema!==1||content.source!=="bybit-public-linear"||
      content.cutoff!==EMA50_CUTOFF||![120,365].includes(content.days)||
      !/^[A-Z0-9]{3,24}USDT$/.test(content.symbol)||
      !Number.isFinite(Date.parse(content.capturedAt))||digest(content)!==sha256)
    throw Error("Некоректний або змінений історичний знімок EMA50.");
  const start=EMA50_CUTOFF-content.days*86400000;
  for(const frame of Object.keys(frames) as Frame[]){
    const list=content.candles[frame],duration=frames[frame];
    if(!Array.isArray(list)||!list.length)throw Error("Немає історії "+frame);
    let last=-1;
    for(const b of list){
      if(!Number.isSafeInteger(b.time)||b.time<start||b.time+duration>EMA50_CUTOFF||
        b.time<=last||b.time%duration!==0||
        ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||
        b.low<=0||b.high<b.low||b.volume<0||b.open<b.low||b.open>b.high||
        b.close<b.low||b.close>b.high)
        throw Error("Некоректні історичні свічки "+frame);
      last=b.time;
    }
    if(list[0].time>start+duration*2||list.at(-1)!.time+duration<EMA50_CUTOFF-duration*2||
      list.length<Math.floor(content.days*86400000/duration*.9))
      throw Error("Неповна історія "+frame+"; неможливо чесно порівняти період.");
  }
  return document;
}
export async function loadEmaStudy(symbol:string,days:EmaStudyPeriod):Promise<SavedEmaStudy|null>{
  try{return verify(JSON.parse(await readFile(filepath(symbol,days),"utf8")) as SavedEmaStudy);}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return null;
    throw e;
  }
}
type BybitRow=[string,string,string,string,string,string,string];
async function getPage(symbol:string,frame:Frame,end:number):Promise<BybitRow[]> {
  const url=new URL(PUBLIC_BYBIT_URL+"/v5/market/kline");
  url.searchParams.set("category","linear");
  url.searchParams.set("symbol",symbol);url.searchParams.set("interval",frame);
  url.searchParams.set("limit","1000");url.searchParams.set("end",String(end));
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(15000)});
      const raw=await response.text();
      let data:{retCode?:number;retMsg?:string;result?:{list?:BybitRow[]}};
      try{data=JSON.parse(raw) as typeof data;}
      catch{throw Error(`Bybit HTTP ${response.status}: сервер повернув не JSON; історія недоступна з цього середовища.`);}
      if(response.ok&&data.retCode===0&&Array.isArray(data.result?.list))return data.result.list;
      if(response.status!==429&&response.status<500&&data.retCode!==10006)
        throw Error(`Bybit HTTP ${response.status}, код ${data.retCode??"unknown"}: ${data.retMsg||"історія недоступна"}`);
    }catch(e){if(attempt===2)throw e;}
  }
  throw Error("Bybit не повернув свічки.");
}
async function fetchFrame(symbol:string,frame:Frame,days:EmaStudyPeriod):Promise<EmaBar[]>{
  const start=EMA50_CUTOFF-days*86400000, duration=frames[frame];
  const byTime=new Map<number,EmaBar>();
  let end=EMA50_CUTOFF-1;
  const maxPages=Math.ceil(days*86400000/duration/1000)+3;
  for(let page=0;page<maxPages;page++){
    const list=await getPage(symbol,frame,end);
    if(!list.length)break;
    let oldest=Infinity;
    for(const row of list){
      const time=Number(row[0]);if(!Number.isFinite(time))continue;
      oldest=Math.min(time,oldest);
      if(time<start||time+duration>EMA50_CUTOFF)continue;
      byTime.set(time,{time,open:Number(row[1]),high:Number(row[2]),
        low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])});
    }
    if(oldest<=start||list.length<1000)break;
    if(!Number.isFinite(oldest)||oldest>=end)throw Error("Bybit не просуває пагінацію.");
    end=oldest-1;
  }
  return [...byTime.values()].sort((a,b)=>a.time-b.time);
}
export async function getEmaStudy(symbol:string,days:EmaStudyPeriod):Promise<SavedEmaStudy>{
  const previous=await loadEmaStudy(symbol,days);
  if(previous)return previous;
  const [m15,h1,h4]=await Promise.all([
    fetchFrame(symbol,"15",days),fetchFrame(symbol,"60",days),fetchFrame(symbol,"240",days)]);
  const content:DataContent={schema:1,source:"bybit-public-linear",symbol,days,
    cutoff:EMA50_CUTOFF,capturedAt:new Date().toISOString(),
    candles:{"15":m15,"60":h1,"240":h4}};
  const sealed=verify({...content,sha256:digest(content)});
  const file=filepath(symbol,days);
  await mkdir(path.dirname(file),{recursive:true});
  try{await writeFile(file,JSON.stringify(sealed),{flag:"wx",mode:0o600});}
  catch(e){
    if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
    const existing=await loadEmaStudy(symbol,days);
    if(!existing)throw Error("Не вдалося перевірити вже збережений знімок.");
    return existing;
  }
  return sealed;
}
