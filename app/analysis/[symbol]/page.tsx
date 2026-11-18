"use client";

import Link from "next/link";
import {useCallback, useEffect, useState} from "react";
import {useParams} from "next/navigation";
import type {TradePlan} from "@/lib/trading";
import {TradingChart} from "@/app/components/TradingChart";

type AiExplanation={summary:string;caution:string;nextStep:string};
type AiStatus={state:string;code:string;message:string;model?:string};
type AnalysisResponse={success:boolean;plan?:TradePlan|null;verified?:boolean;
  aiExplanation?:AiExplanation|null;aiStatus?:AiStatus;error?:string};
const number=(value:number)=>value.toLocaleString("uk-UA",{maximumFractionDigits:8});
const when=(timestamp:number)=>new Intl.DateTimeFormat("uk-UA",{
  timeZone:"Europe/Ljubljana",day:"2-digit",month:"2-digit",year:"numeric",
  hour:"2-digit",minute:"2-digit",timeZoneName:"short",
}).format(timestamp);
const bybit=(symbol:string)=>`https://www.bybit.com/trade/usdt/${symbol}`;

function AnalysisView(){
  const params=useParams();
  const symbol=String(params.symbol??"").toUpperCase();
  const [snapshot,setSnapshot]=useState<TradePlan|null>(null);
  const [current,setCurrent]=useState<TradePlan|null>(null);
  const [freshness,setFreshness]=useState<"checking"|"verified"|"not-found"|"unavailable">("checking");
  const [ai,setAi]=useState<AiExplanation|null>(null);
  const [aiStatus,setAiStatus]=useState<AiStatus|null>(null);
  const [aiLoading,setAiLoading]=useState(false);
  const [detailError,setDetailError]=useState("");
  useEffect(()=>{
    try{
      const raw=localStorage.getItem("alpha-pulse-plan-v1");
      if(raw){
        const parsed=JSON.parse(raw) as TradePlan;
        if(parsed.symbol===symbol)setSnapshot(parsed);
      }
    }catch{/* invalid stored snapshot is ignored */}
  },[symbol]);

  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(`/api/analysis/${encodeURIComponent(symbol)}`,{cache:"no-store"});
      const data=await response.json() as AnalysisResponse;
      if(!response.ok||!data.success)throw Error(data.error||"Помилка поточного аналізу.");
      setCurrent(data.plan??null);
      setFreshness(data.verified&&data.plan?"verified":"not-found");
      setDetailError("");
      // Previous AI text belongs to the older observation and must not
      // silently be presented as advice for a new market snapshot.
      setAi(null);setAiStatus(null);
    }catch(error){
      setFreshness("unavailable");
      setDetailError(error instanceof Error?error.message:"Не вдалося перевірити ринкові дані.");
    }
  },[symbol]);
  useEffect(()=>{
    const initial=window.setTimeout(()=>void refresh(),0);
    const interval=window.setInterval(()=>void refresh(),60_000);
    return ()=>{window.clearTimeout(initial);window.clearInterval(interval);};
  },[refresh]);
  const plan=current??snapshot;
  const verified=freshness==="verified"&&!!current;
  const ready=verified&&plan?.status==="ACTIVE"&&plan.qualityGate?.passed===true&&
    plan.structure?.confirmedEntry===true&&plan.structure?.confirmedTarget===true&&
    plan.limitEntry24h?.status==="HISTORICALLY_REACHABLE"&&
    plan.limitEntry24h?.sampleWindows>=60&&plan.riskReward>=2;
  const conditions=plan?[
    {label:"Технічний сигнал",ok:plan.status==="ACTIVE"},
    {label:"Дослідний фільтр якості",ok:plan.qualityGate?.passed===true},
    {label:"Структурний Entry",ok:plan.structure?.confirmedEntry===true},
    {label:"Структурна ціль TP",ok:plan.structure?.confirmedTarget===true},
    {label:"Історичні торкання Entry за 24h",ok:plan.limitEntry24h?.status==="HISTORICALLY_REACHABLE"},
    {label:"R:R не менше 1:2",ok:plan.riskReward>=2},
  ]:[];
  async function requestAi(){
    if(aiLoading||!verified)return;
    setAiLoading(true);setAi(null);setAiStatus(null);
    try{
      const response=await fetch(`/api/analysis/${encodeURIComponent(symbol)}?ai=1`,{cache:"no-store"});
      const data=await response.json() as AnalysisResponse;
      if(!response.ok||!data.success)throw Error(data.error||"AI-аналіз недоступний.");
      // Only display AI text if the server refreshed the exact displayed plan.
      if(!data.plan||data.plan.id!==current?.id||
        data.plan.observation?.observedAt!==current?.observation?.observedAt){
        setAiStatus({state:"stale",code:"DATA_CHANGED",message:"За час AI-запиту ринок змінився. Онови аналіз перед читанням."});
      }else{
        setAi(data.aiExplanation??null);
        setAiStatus(data.aiStatus??null);
      }
    }catch(error){
      setAiStatus({state:"fallback",code:"REQUEST_FAILED",message:error instanceof Error?error.message:"AI тимчасово недоступний."});
    }finally{setAiLoading(false);}
  }
  return <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 md:px-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-5">
      <div>
        <Link href="/" className="text-xs font-semibold text-emerald-300">← Усі можливості</Link>
        <h1 className="mt-2 text-2xl font-bold">{symbol} <span className="text-base font-normal text-slate-400">· повний аналіз</span></h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={()=>void refresh()} className="rounded-lg border border-slate-700 px-3 py-2 hover:border-cyan-500">↻ Оновити</button>
        <a href={bybit(symbol)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-cyan-700 px-3 py-2 text-cyan-200 hover:border-cyan-400">↗ Відкрити Bybit</a>
      </div>
    </header>

    {freshness==="checking"&&<p className="mb-4 text-sm text-slate-400">Перевіряємо свіжість сигналу за поточними даними…</p>}
    {!verified&&<p role="status" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-200">
      {freshness==="not-found"?"На поточних даних немає підтвердженого торгового сценарію для цієї пари.":
       freshness==="unavailable"?`Поточний аналіз недоступний: ${detailError}`:
       "Триває оновлення даних."}
      {snapshot?" Нижче може відображатися останній збережений знімок, не готова заявка.":""}
    </p>}
    {!plan?<div className="rounded-xl border border-slate-800 p-7 text-slate-300">
      Зараз немає даних для повного аналізу. Повернися до сканера або повтори перевірку.
    </div>:<>
      <section className="mb-5 grid gap-3 lg:grid-cols-[1fr_260px]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${ready?"bg-emerald-950 text-emerald-200":"bg-amber-950 text-amber-200"}`}>
              {ready?"Пройшов дослідний відбір":"Сценарій спостереження"}
            </span>
            <span className={`text-xs font-semibold ${plan.direction==="LONG"?"text-emerald-300":"text-rose-300"}`}>{plan.direction}</span>
            <span className="text-xs text-slate-400">Оцінка {plan.score}/100 · Готовність {plan.readiness.met}/{plan.readiness.total}</span>
          </div>
          <p className="mt-3 text-base font-medium">{ready?"Є технічно підтверджений план Limit-входу.":"Ідея аналізується; розміщення заявки передчасне."}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{plan.summary}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-3 sm:grid-cols-4">
            {[
              {name:"Limit-вхід",value:plan.entryPrice,color:"text-cyan-300"},
              {name:"Зона",value:null,color:"text-slate-100"},
              {name:"Take Profit",value:plan.takeProfit2,color:"text-emerald-300"},
              {name:"Stop Loss",value:plan.stopLoss,color:"text-rose-300"},
            ].map(item=><div key={item.name} className="min-w-0">
              <p className="text-xs text-slate-500">{item.name}</p>
              <p className={`mt-1 break-words text-sm font-semibold ${item.color}`}>{item.value===null?
                `${number(plan.entryLow)}–${number(plan.entryHigh)}`:number(item.value)}</p>
            </div>)}
          </div>
        </div>
        <aside className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <h2 className="font-semibold">Рішення за 10 секунд</h2>
          <p className="mt-2 text-slate-300">R:R <strong>1:{plan.riskReward.toFixed(2)}</strong></p>
          <p className="mt-2 text-slate-300">Поточна ціна <strong>{number(plan.currentPrice)}</strong></p>
          <p className="mt-2 text-slate-300">Оновлення <strong>{plan.observation?.observedAt?when(plan.observation.observedAt):"Невідомо"}</strong></p>
          <p className="mt-2 text-slate-300">Пошук Entry <strong>{plan.observation?.observedAt?`${when(plan.observation.observedAt)} – ${when(plan.observation.observedAt+86_400_000)}`:"До 24 годин від аналізу"}</strong></p>
          <p className="mt-3 border-t border-slate-800 pt-3 text-xs text-amber-200">Горизонт пошуку Entry не дорівнює часу дії GTC-ордера й не гарантує виконання.</p>
        </aside>
      </section>
      <section className="mb-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <h2 className="mb-2 px-2 text-sm font-semibold">Графік і рівні Entry / SL / TP</h2>
        <TradingChart plan={plan}/>
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Що має відбутися перед входом</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {ready?"Усі поточні дослідницькі умови виконано. Перед ручним рішенням перевір ціну, ризик і термін придатності плану.":
             "Це умовний сценарій. Числа Entry/SL/TP — попередня гіпотеза, а не дозвіл на Limit-заявку."}
          </p>
          <div className="mt-4 space-y-2">
            {conditions.map(c=><div key={c.label} className="flex items-center justify-between border-b border-slate-800/60 py-2 text-sm">
              <span>{c.label}</span><span className={c.ok?"text-emerald-300":"text-amber-300"}>{c.ok?"Підтверджено":"Очікується"}</span>
            </div>)}
          </div>
          <p className="mt-4 text-sm text-cyan-200"><strong>Наступна дія:</strong> {plan.nextStep}</p>
          <details className="mt-4 border-t border-slate-800 pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Всі технічні факти та незавершені умови</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
              {plan.reasons.map((r,i)=><li key={i}>{r}</li>)}
              {plan.qualityGate?.reasons.map((r,i)=><li key={`q-${i}`} className="text-amber-200">{r}</li>)}
            </ul>
          </details>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Ризики та AI-пояснення</h2>
          <p className="mt-2 text-sm text-amber-200"><strong>Основний ризик:</strong> {plan.caution}</p>
          <details className="mt-4 border-t border-slate-800 pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Коли сценарій скасовується, а Stop Loss спрацьовує</summary>
            <p className="mt-3 text-slate-300">{plan.lifecycle?.setupReview??plan.invalidation}</p>
            <p className="mt-3 text-rose-200">{plan.lifecycle?.stopProtection??"Після заявки перевір реальний захисний ордер."}</p>
            <p className="mt-3 text-slate-400">{plan.lifecycle?.pendingLimit??"GTC Limit слід перевіряти окремо."}</p>
          </details>
          <details className="mt-4 border-t border-slate-800 pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Розгорнутий аналіз AI-помічника</summary>
            <p className="mt-3 text-xs text-slate-400">AI отримує лише поточний незалежно перевірений торговий план. Він пояснює факти та ризики, але не підтверджує прибутковість або не приймає рішення замість тебе.</p>
            <button type="button" disabled={!verified||aiLoading} onClick={()=>void requestAi()}
              className="mt-3 rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-200 disabled:opacity-50">
              {aiLoading?"Перевіряю з AI…":"Отримати AI-аналіз цієї пари"}
            </button>
            {aiStatus&&<p role="status" className="mt-3 text-xs text-slate-400">{aiStatus.state==="ok"||aiStatus.state==="cached"?"AI відповів: ":"AI недоступний: "}{aiStatus.message}</p>}
            {ai&&<div className="mt-3 space-y-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3 leading-relaxed">
              <p><strong className="text-slate-100">Оцінка:</strong> {ai.summary}</p>
              <p><strong className="text-rose-200">Ризики:</strong> {ai.caution}</p>
              <p><strong className="text-cyan-200">Що далі:</strong> {ai.nextStep}</p>
            </div>}
          </details>
        </section>
      </div>
      <p className="mt-5 text-xs text-slate-500">Ця сторінка лише для аналізу. Вона не створює заявки. Дослідний статус не є прогнозом прибутковості; перед будь-якою Demo-заявкою потрібна окрема актуальна серверна перевірка.</p>
    </>}
  </main>;
}
export default AnalysisView;
