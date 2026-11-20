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
import {isAlertEligiblePlan,type ReadyAlert,type AlertEvent} from "./telegram-alert-rules.ts";
import {shouldRetireTelegramSignal} from "./telegram-message-lifecycle.ts";
import {GET as getDemoAccount} from "../app/api/account/route";
import {verifyCurrentTechnicalPlan} from "./market-scan.ts";

const directory=join(process.cwd(),".alpha-pulse-history");
const file=join(directory,"telegram-alert-state.json");
type SentAlert={
  alert:ReadyAlert;messageId:number|null;chatId:string;lastConfirmedAt:number;misses:number;
};
type Stored={active:Record<string,SentAlert>;updatedAt:number};
let inFlight:Promise<{enabled:boolean;sent:number;errors:number}>|undefined;
const money=(value:number)=>value.toLocaleString("uk-UA",{maximumFractionDigits:8});
async function readState():Promise<Stored>{
  try{
    const raw=JSON.parse(await readFile(file,"utf8")) as Stored;
    if(!raw||typeof raw.active!=="object"||!raw.active||Array.isArray(raw.active))throw Error("Incorrect Telegram state");
    // Migration from initial dedup-only state: old records have no message ID.
    // We must NEVER guess an ID or delete unrelated channel messages.
    const active:Record<string,SentAlert>={};
    for(const [symbol,record] of Object.entries(raw.active)){
      const entry=record as unknown as Partial<SentAlert>&ReadyAlert;
      if(entry?.alert?.symbol===symbol){
        active[symbol]={...entry,messageId:Number.isSafeInteger(entry.messageId)&&
          (entry.messageId??0)>0?entry.messageId!:null,
          lastConfirmedAt:Number.isFinite(entry.lastConfirmedAt)?entry.lastConfirmedAt:entry.alert.verifiedAt,
          misses:Number.isInteger(entry.misses)&&entry.misses>=0?entry.misses:0};
      }else if(entry?.symbol===symbol){
        active[symbol]={alert:entry,messageId:null,chatId:"",lastConfirmedAt:entry.verifiedAt||0,misses:0};
      }
    }
    return {active,updatedAt:raw.updatedAt||0};
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
async function callTelegram(token:string,method:string,payload:Record<string,unknown>){
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(12_000),cache:"no-store",
  });
  const result=await response.json() as {ok?:boolean;description?:string;result?:unknown};
  if(!response.ok||!result.ok)throw Error("Telegram "+method+" rejected: "+(result.description??response.status));
  return result.result;
}
async function sendTelegram(token:string,chatId:string,text:string){
  const result=await callTelegram(token,"sendMessage",{chat_id:chatId,text,disable_web_page_preview:true});
  const messageId=(result as {message_id?:number}|null)?.message_id;
  if(!Number.isSafeInteger(messageId)||!(messageId!>0))
    throw Error("Telegram did not return a valid message_id; cannot safely track cleanup.");
  return messageId!;
}
async function retireMessage(token:string,chatId:string,symbol:string,record:SentAlert){
  // An earlier bot implementation may not have saved message_id.
  if(!record.messageId||record.chatId!==chatId)return "untracked";
  try{
    await callTelegram(token,"deleteMessage",{chat_id:chatId,message_id:record.messageId});
    return "deleted";
  }catch(error){
    // Telegram generally limits deletion of old messages; editing is a fallback,
    // not a fabricated successful deletion.
    try{
      await callTelegram(token,"editMessageText",{
        chat_id:chatId,message_id:record.messageId,
        text:`⛔ НЕАКТУАЛЬНИЙ СИГНАЛ · ALPHA PULSE DEMO\n${symbol}\nПопередні Entry, SL і TP більше не підтверджені. Не створюйте заявку за цим повідомленням.`,
        disable_web_page_preview:true,
      });
      return "edited";
    }catch(editError){
      throw new Error(`Cannot remove or mark old Telegram message: ${String(error)}; ${String(editError)}`);
    }
  }
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
  // Reconfirm the exact proposed levels from fresh Bybit inputs; a cached
  // scan result alone is NOT sufficient to trigger a time-sensitive alert.
  const fresh=await verifyCurrentTechnicalPlan(plan.symbol);
  if(!fresh||!isAlertEligiblePlan(fresh,Date.now())||
    fresh.id!==plan.id||fresh.direction!==plan.direction||
    fresh.entryPrice!==plan.entryPrice||fresh.stopLoss!==plan.stopLoss||
    fresh.takeProfit2!==plan.takeProfit2)return null;
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
  let sent=0;
  // Reconfirm active signals while tracking consecutive missing checks.
  // Absence from one rotating TOP list must never delete a live message.
  const current=new Map(alerts.map(a=>[a.symbol,a]));
  for(const [symbol,record] of Object.entries(state.active)){
    if(record.chatId&&record.chatId!==chatId)continue; // Never mutate another channel.
    const verified=current.get(symbol);
    if(verified){
      record.alert=verified;
      record.lastConfirmedAt=Date.now();
      record.misses=0;
      continue;
    }
    record.misses+=1;
    if(!shouldRetireTelegramSignal(record.misses,record.lastConfirmedAt,Date.now()))continue;
    try{
      const outcome=await retireMessage(token,chatId,symbol,record);
      if(outcome==="untracked")
        console.warn("Telegram previous message has no tracked ID; cannot remove:",symbol);
      delete state.active[symbol];
      await saveState(state);
    }catch(error){
      errors++;
      console.warn("Telegram old signal cleanup failed:",error instanceof Error?error.message:"unknown error");
    }
  }
  // Persist latest confirmed timestamps so delayed scans do not erase messages.
  await saveState(state);
  for(const alert of alerts){
    if(state.active[alert.symbol])continue;
    try{
      const messageId=await sendTelegram(token,chatId,format({kind:"READY",symbol:alert.symbol,alert}));
      state.active[alert.symbol]={
        alert,messageId,chatId,lastConfirmedAt:Date.now(),misses:0,
      };
      await saveState(state);
      sent++;
    }catch(error){
      errors++;
      console.warn("Alpha Pulse Telegram notification failed:",error instanceof Error?error.message:"send failed");
      break;
    }
  }
  return {enabled:true,sent,errors};
}
export function dispatchTelegramAlerts(plans:readonly TradePlan[]){
  if(inFlight)return inFlight;
  inFlight=processAlerts(plans).finally(()=>{inFlight=undefined;});
  return inFlight;
}
