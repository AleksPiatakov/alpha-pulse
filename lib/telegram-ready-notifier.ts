/**
 * Server-only, opt-in Telegram notifications for actionable Bybit DEMO research.
 * No order calls. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local.
 * Sent by the separately running scan worker route, not the browser.
 */
import "server-only";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {serverEnv} from "./server-env";
import {DEMO_BYBIT_URL,type TradePlan} from "./trading.ts";
import {calculatePosition,defaultRiskSettings} from "./risk-settings.ts";
import {parseExecutionRules,validateOrderPrecision} from "./bybit-execution-rules.ts";
import type {InstrumentMeta} from "./bybit-universe.ts";
import {isAlertEligiblePlan,reconcileAlerts,type ReadyAlert,type AlertEvent} from "./telegram-alert-rules.ts";
import {GET as getDemoAccount} from "../app/api/account/route";

const directory=join(process.cwd(),".alpha-pulse-history");
const file=join(directory,"telegram-alert-state.json");
type Stored={active:Record<string,ReadyAlert>;updatedAt:number};
let inFlight:Promise<{enabled:boolean;sent:number;errors:number}>|undefined;
const money=(value:number)=>value.toLocaleString("uk-UA",{maximumFractionDigits:8});
async function readState():Promise<Stored>{
  try{
    const raw=JSON.parse(await readFile(file,"utf8")) as Stored;
    if(!raw||typeof raw.active!=="object"||!raw.active||Array.isArray(raw.active))throw Error("Incorrect Telegram state");
    return raw;
  }catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return {active:{},updatedAt:0};
    throw e; // Do not flood Telegram if de-duplication state cannot be read.
  }
}
async function saveState(state:Stored){
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(file+".tmp",JSON.stringify(state),{mode:0o600});
  const fs=await import("node:fs/promises");
  await fs.rename(file+".tmp",file);
}
async function sendTelegram(token:string,chatId:string,text:string){
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true}),
    signal:AbortSignal.timeout(12_000),cache:"no-store",
  });
  const result=await response.json() as {ok?:boolean;description?:string};
  if(!response.ok||!result.ok)throw Error("Telegram sendMessage rejected: "+(result.description??response.status));
}
function format(event:AlertEvent):string{
  if(event.kind==="CANCELLED")return `⚠ ALPHA PULSE · DEMO\n${event.symbol}: попередній сигнал втратив актуальність.\nНе використовуйте старі Entry/SL/TP. Відкрийте Alpha Pulse для повторної перевірки. Жодних ордерів не створено.`;
  const a=event.alert!;
  const stamp=new Intl.DateTimeFormat("uk-UA",{timeZone:"Europe/Ljubljana",dateStyle:"short",timeStyle:"medium"}).format(a.verifiedAt);
  return `✅ ALPHA PULSE · BYBIT DEMO\nГотовий до ручної перевірки\n${a.symbol} · ${a.direction}\n\nОцінка: ${a.score}/100 · Готовність: ${a.readiness}/8 · R:R 1:${a.rr.toFixed(2)}\nEntry: ${money(a.entry)} USDT\nStop Loss: ${money(a.stop)} USDT\nTake Profit: ${money(a.target)} USDT\nРозрахунковий ризик: ${a.riskPct.toFixed(2)}% Demo-балансу (${a.riskUsdt.toFixed(2)} USDT)\nПеревірено: ${stamp} (Любляна)\n\n⚠ Сигнал може змінитися до відкриття сторінки. Limit-заявку НЕ створено. Потрібна остаточна серверна перевірка та ручне натискання Demo Limit.\nАналіз: http://localhost:3000/analysis/${encodeURIComponent(a.symbol)} (посилання відкривається лише на комп’ютері із запущеним Alpha Pulse).`;
}
async function validatedAlert(plan:TradePlan,now:number,account:{
  balance:number;availableBalance:number;activeCount:number
}):Promise<ReadyAlert|null>{
  if(!isAlertEligiblePlan(plan,now))return null;
  const size=calculatePosition({balance:account.balance,activeCount:account.activeCount,
    settings:defaultRiskSettings,entryPrice:plan.entryPrice,
    stopLoss:plan.stopLoss,takeProfit:plan.takeProfit2,availableBalance:account.availableBalance});
  if(!size.canOpen||!Number.isFinite(size.quantity)||size.actualRisk>account.balance*.01)return null;
  const url=`${DEMO_BYBIT_URL}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(plan.symbol)}`;
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(12_000)});
  if(!response.ok)return null;
  const metadata=await response.json() as {retCode?:number;result?:{list?:InstrumentMeta[]}};
  if(metadata.retCode!==0)return null;
  const rules=parseExecutionRules(metadata.result?.list?.find(x=>x.symbol===plan.symbol));
  if(!rules)return null;
  const units=Math.floor(size.quantity/rules.qtyStep+1e-9);
  const decimals=Math.min(12,(rules.qtyStep.toString().split(".")[1]??"").length);
  const quantity=Number((units*rules.qtyStep).toFixed(decimals));
  if(!quantity||validateOrderPrecision({entry:plan.entryPrice,stop:plan.stopLoss,
    target:plan.takeProfit2,quantity},rules).length)return null;
  const riskUsdt=quantity*Math.abs(plan.entryPrice-plan.stopLoss);
  const riskPct=100*riskUsdt/account.balance;
  if(!(riskPct>0&&riskPct<=1+1e-8)||quantity*plan.entryPrice>account.availableBalance)return null;
  return {symbol:plan.symbol,direction:plan.direction,score:plan.score,
    readiness:plan.readiness!.met,entry:plan.entryPrice,stop:plan.stopLoss,
    target:plan.takeProfit2,rr:plan.riskReward,riskPct,riskUsdt,
    verifiedAt:now,planId:plan.id};
}
async function processAlerts(plans:readonly TradePlan[]){
  const token=serverEnv("TELEGRAM_BOT_TOKEN");
  const chatId=serverEnv("TELEGRAM_CHAT_ID");
  if(!token||!chatId||serverEnv("TELEGRAM_ALERTS_ENABLED")!=="true")
    return {enabled:false,sent:0,errors:0};
  const response=await getDemoAccount();
  if(!response.ok)return {enabled:true,sent:0,errors:1};
  const account=await response.json() as {success?:boolean;balance?:number;availableBalance?:number|null;activeCount?:number};
  if(!account.success||typeof account.balance!=="number"||account.balance<=0||
      typeof account.availableBalance!=="number"||account.availableBalance<=0||
      !Number.isInteger(account.activeCount)||account.activeCount!<0||account.activeCount!>=3)
    return {enabled:true,sent:0,errors:1};
  const snapshot={balance:account.balance,availableBalance:account.availableBalance,activeCount:account.activeCount!};
  const now=Date.now();
  const alerts:ReadyAlert[]=[];
  let errors=0;
  for(const plan of plans.slice(0,10)){
    try{const alert=await validatedAlert(plan,now,snapshot);if(alert)alerts.push(alert);}
    catch{errors++;}
  }
  // If any validation was unavailable, do not interpret it as a cancellation.
  if(errors)return {enabled:true,sent:0,errors};
  const state=await readState();
  const events=reconcileAlerts(new Set(Object.keys(state.active)),alerts);
  let sent=0;
  for(const event of events){
    try{
      await sendTelegram(token,chatId,format(event));
      if(event.kind==="READY"&&event.alert)state.active[event.symbol]=event.alert;
      else delete state.active[event.symbol];
      state.updatedAt=Date.now();
      await saveState(state);
      sent++;
    }catch(err){
      errors++;
      console.warn("Alpha Pulse Telegram notification failed:",err instanceof Error?err.message:"send failed");
      break; // Retry on next worker poll, never mark an unsent alert as delivered.
    }
  }
  return {enabled:true,sent,errors};
}
export function dispatchTelegramAlerts(plans:readonly TradePlan[]){
  if(inFlight)return inFlight;
  inFlight=processAlerts(plans).finally(()=>{inFlight=undefined;});
  return inFlight;
}
