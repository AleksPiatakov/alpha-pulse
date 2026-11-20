"use client";

import Link from "next/link";
import {Suspense, useCallback, useEffect, useState} from "react";
import {useParams} from "next/navigation";
import type {TradePlan} from "@/lib/trading";
import {TradingChart} from "@/app/components/TradingChart";
import {calculatePosition, defaultRiskSettings} from "@/lib/risk-settings";

type AiExplanation={marketContext:string;entryLogic:string;confirmationConditions:string[];invalidation:string;riskAnalysis:string;beginnerExplanation:string;nextAction:string};
type AiStatus={state:string;code:string;message:string;model?:string};
type AnalysisResponse={success:boolean;plan?:TradePlan|null;verified?:boolean;
  aiExplanation?:AiExplanation|null;aiStatus?:AiStatus;error?:string};
const number=(value:number)=>value.toLocaleString("uk-UA",{maximumFractionDigits:8});
const when=(timestamp:number)=>new Intl.DateTimeFormat("uk-UA",{
  timeZone:"Europe/Ljubljana",day:"2-digit",month:"2-digit",year:"numeric",
  hour:"2-digit",minute:"2-digit",timeZoneName:"short",
}).format(timestamp);
const bybit=(symbol:string)=>`https://www.bybit.com/trade/usdt/${symbol}`;
const planSignature=(p:TradePlan)=>JSON.stringify([p.direction,p.entryPrice,p.stopLoss,p.takeProfit2,p.status,p.qualityGate?.passed,p.readiness?.met,p.readiness?.total,p.qualityGate?.reasons]);

function AnalysisView(){
  const params=useParams();
  const symbol=String(params.symbol??"").toUpperCase();
  const [snapshot,setSnapshot]=useState<TradePlan|null>(null);
  const [current,setCurrent]=useState<TradePlan|null>(null);
  const [freshness,setFreshness]=useState<"checking"|"verified"|"not-found"|"unavailable">("checking");
  const [ai,setAi]=useState<AiExplanation|null>(null);
  const [aiSignature,setAiSignature]=useState<string|null>(null);
  const [aiStatus,setAiStatus]=useState<AiStatus|null>(null);
  const [aiLoading,setAiLoading]=useState(false);
  const [detailError,setDetailError]=useState("");
  const [history,setHistory]=useState<Array<{time:number;signature:string;label:string}>>([]);
  const [account,setAccount]=useState<{balance:number;availableBalance:number;activeCount:number}|null>(null);
  const [accountError,setAccountError]=useState("");
  const [placing,setPlacing]=useState(false);
  const [orderMessage,setOrderMessage]=useState("");
  const [expandedHistory,setExpandedHistory]=useState(false);
  useEffect(()=>{
    const initial=window.setTimeout(()=>{
      try{
        const raw=localStorage.getItem("alpha-pulse-plan-v1");
        if(raw){
          const parsed=JSON.parse(raw) as TradePlan;
          if(parsed.symbol===symbol)setSnapshot(parsed);
        }
      }catch{/* invalid stored snapshot is ignored */}
    },0);
    return ()=>window.clearTimeout(initial);
  },[symbol]);

  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(`/api/analysis/${encodeURIComponent(symbol)}`,{cache:"no-store"});
      const data=await response.json() as AnalysisResponse;
      if(!response.ok||!data.success)throw Error(data.error||"Помилка поточного аналізу.");
      setCurrent(data.plan??null);
      setFreshness(data.verified&&data.plan?"verified":"not-found");
      setDetailError("");
      // The visible AI report is matched to the underlying levels/conditions,
      // so periodic quote refreshes do not interrupt reading its explanation.
    }catch(error){
      setFreshness("unavailable");
      setDetailError(error instanceof Error?error.message:"Не вдалося перевірити ринкові дані.");
    }
  },[symbol]);
  useEffect(()=>{
    const initial=window.setTimeout(()=>void refresh(),0);
    const interval=window.setInterval(()=>void refresh(),30_000);
    return ()=>{window.clearTimeout(initial);window.clearInterval(interval);};
  },[refresh]);
  useEffect(()=>{
    if(!current||freshness!=="verified")return;
    const key="alpha-pulse-scenario-history-"+symbol;
    try{
      const stored=JSON.parse(localStorage.getItem(key)||"[]") as Array<{time:number;signature:string;label:string}>;
      const previous=Array.isArray(stored)?stored.filter(x=>Number.isFinite(x.time)&&typeof x.signature==="string"&&typeof x.label==="string").slice(-29):[];
      const signature=planSignature(current);
      if(previous.at(-1)?.signature!==signature){
        const label=current.status==="ACTIVE"&&current.qualityGate?.passed?"Пройшов фільтр якості":"Очікує перевірки";
        previous.push({time:Date.now(),signature,label});
        localStorage.setItem(key,JSON.stringify(previous.slice(-30)));
      }
      setHistory(previous.slice(-30).reverse());
    }catch{setHistory([]);}
  },[symbol,current,freshness]);
  useEffect(()=>{
    let mounted=true;
    const load=async()=>{
      try{
        const response=await fetch("/api/account",{cache:"no-store"});
        const data=await response.json() as {success?:boolean;balance?:number;availableBalance?:number|null;activeCount?:number;error?:string};
        if(!response.ok||!data.success||!Number.isFinite(data.balance)||(typeof data.availableBalance!=="number"||!Number.isFinite(data.availableBalance))||!(data.balance!>0)||!(data.availableBalance!>0)||!Number.isInteger(data.activeCount))
          throw Error(data.error||"Немає підтверджених даних Demo-рахунку.");
        if(mounted){setAccount({balance:data.balance!,availableBalance:data.availableBalance!,activeCount:data.activeCount!});setAccountError("");}
      }catch(e){if(mounted){setAccount(null);setAccountError(e instanceof Error?e.message:"Demo API недоступний");}}
    };
    void load();
    const timer=window.setInterval(()=>void load(),30_000);
    return ()=>{mounted=false;window.clearInterval(timer);};
  },[]);
  const plan=current??snapshot;
  const verified=freshness==="verified"&&!!current;
  const ready=verified&&plan?.status==="ACTIVE"&&plan.qualityGate?.passed===true&&
    plan.structure?.confirmedEntry===true&&plan.structure?.confirmedTarget===true&&
    plan.limitEntry24h?.status==="HISTORICALLY_REACHABLE"&&
    plan.limitEntry24h?.sampleWindows>=60&&plan.riskReward>=2;
  const aiMatchesCurrent=!!plan&&!!aiSignature&&planSignature(plan)===aiSignature;
  const sizing=plan&&account?calculatePosition({
    balance:account.balance,activeCount:account.activeCount,settings:defaultRiskSettings,
    entryPrice:plan.entryPrice,stopLoss:plan.stopLoss,takeProfit:plan.takeProfit2,availableBalance:account.availableBalance
  }):null;
  const money=(n:number)=>n.toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2});
  async function placeDemo(){
    if(!current||!ready||!sizing?.canOpen||placing)return;
    setPlacing(true);setOrderMessage("");
    try{
      const response=await fetch("/api/trade",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({planId:current.id,symbol:current.symbol,
          side:current.direction==="LONG"?"Buy":"Sell",qty:Number(sizing.quantity.toFixed(8)),
          entryPrice:current.entryPrice,stopLoss:current.stopLoss,takeProfit:current.takeProfit2})});
      const data=await response.json() as {success?:boolean;error?:string;data?:{orderId?:string}};
      if(!response.ok||!data.success)throw Error(data.error||"Bybit Demo відхилив заявку.");
      setOrderMessage("Demo Limit-заявку прийнято. Order ID: "+(data.data?.orderId??"див. Активні заявки"));
      void refresh();
    }catch(e){setOrderMessage(e instanceof Error?e.message:"Помилка Demo-заявки");}
    finally{setPlacing(false);}
  }
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
      // The report belongs to the newly reverified plan returned in the same
      // response, not to a potentially stale browser snapshot.
      if(!data.plan||!data.verified){
        setAiStatus({state:"fallback",code:"NO_CURRENT_PLAN",message:"Зараз немає підтвердженого поточного плану для AI-аналізу."});
      }else{
        setCurrent(data.plan);
        setFreshness("verified");
        setAi(data.aiExplanation??null);
        setAiSignature(planSignature(data.plan));
        setAiStatus(data.aiStatus??null);
      }
    }catch(error){
      setAiStatus({state:"fallback",code:"REQUEST_FAILED",message:error instanceof Error?error.message:"AI тимчасово недоступний."});
    }finally{setAiLoading(false);}
  }
  return <main className="min-h-screen bg-slate-950 px-3 py-3 text-slate-100 md:px-5">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
      <div>
        <Link href="/" className="text-xs font-semibold text-emerald-300">← Усі можливості</Link>
        <h1 className="mt-1 text-2xl font-bold"><a href={bybit(symbol)} target="_blank" rel="noopener noreferrer" title="Відкрити пару на основній платформі Bybit для перегляду" className="hover:text-cyan-300">{symbol} ↗</a> <span className="text-base font-normal text-slate-400">· {current?.direction??snapshot?.direction??"аналіз"}</span></h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-emerald-300">● Автооновлення 30 с</span><button type="button" onClick={()=>void refresh()} className="rounded-lg border border-slate-700 px-3 py-2 hover:border-cyan-500">↻ Оновити</button>
        
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
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]"><section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-2">
        <div className="flex items-center justify-between px-2 pb-2"><h2 className="text-sm font-semibold">Графік</h2><span className="text-xs text-slate-400">Живі свічки Bybit · Entry / SL / TP</span></div>
        <TradingChart plan={plan}/>
      </section>
      <aside className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 lg:sticky lg:top-3">
        <h2 className="text-lg font-semibold">Виконати угоду</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs"><div className="rounded-lg bg-emerald-500 px-2 py-3 font-semibold text-slate-950">Bybit Demo · API</div><button type="button" disabled className="cursor-not-allowed rounded-lg border border-slate-700 px-2 py-3 text-slate-500">Реальний рахунок · не підключено</button></div>
        <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/20 p-3"><p className="text-sm font-semibold text-amber-200">{ready?"Кандидат до ручної перевірки":"Очікуємо підтвердження"}</p><p className="mt-1 text-xs text-slate-300">{ready?"Перед заявкою потрібна серверна перевірка.":plan.qualityGate?.reasons[0]??plan.nextStep}</p><p className="mt-2 text-xs text-slate-400">Оцінка {plan.score}/100 · Готовність {plan.readiness?.met??0}/{plan.readiness?.total??8} · R:R 1:{plan.riskReward.toFixed(2)}</p></div>
        <p className="mt-3 text-sm text-slate-300">Тип заявки <strong className="float-right">Limit (GTC)</strong></p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><p className="text-slate-400">Entry</p><p className="mt-1 rounded border border-slate-700 p-2 text-cyan-200">{number(plan.entryPrice)}</p></div><div><p className="text-slate-400">Stop Loss</p><p className="mt-1 rounded border border-slate-700 p-2 text-rose-300">{number(plan.stopLoss)}</p></div><div><p className="text-slate-400">Take Profit</p><p className="mt-1 rounded border border-slate-700 p-2 text-emerald-300">{number(plan.takeProfit2)}</p></div></div>
        <div className="mt-3">
          <p className="mb-1 text-xs text-slate-400">Кількість ({symbol.replace(/USDT$/,"")}) · номінал USDT</p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm">
            <strong>{sizing?.quantity.toLocaleString("uk-UA",{maximumFractionDigits:8})??"—"}</strong>
            <strong className="text-cyan-300">{sizing?"≈ "+money(sizing.notional)+" USDT":"— USDT"}</strong>
          </div>
          <p className="mt-2 text-xs text-slate-400">Ризик: <span className="text-rose-300">{sizing?money(sizing.actualRisk)+" USDT":"—"}</span> · Потенційний TP: <span className="text-emerald-300">{sizing?money(sizing.potentialProfit)+" USDT":"—"}</span></p>
          {accountError&&<p className="mt-2 text-xs text-amber-200">Demo API: {accountError}</p>}
        </div>
        <button type="button" onClick={()=>void placeDemo()} disabled={!ready||!sizing?.canOpen||placing}
          className="mt-4 w-full rounded-lg bg-emerald-500 px-3 py-3 text-center text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">
          {placing?"Передаємо Demo Limit…":ready?"Створити Demo Limit-угоду":"Demo Limit · очікує підтвердження"}
        </button>
        {orderMessage&&<p role="status" className="mt-2 rounded border border-slate-700 p-2 text-xs">{orderMessage}</p>}
        <Link href={`/trade/${symbol}`} onClick={()=>localStorage.setItem("alpha-pulse-plan-v1",JSON.stringify(plan))} className="mt-2 block text-center text-xs text-cyan-300 hover:underline">Детальні параметри та історичні тести →</Link>
        <p className="mt-2 text-xs text-slate-500">Заявка тільки на Demo після натискання. Сервер незалежно перевіряє ціну, крок кількості, маржу та ризик. Реальний рахунок заблокований.</p>
      </aside>
      </div>
      <div className="mt-3 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-base font-semibold">✦ AI-аналіз · коротко</h2>
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
            {ai&&!aiMatchesCurrent&&<p className="mt-3 text-xs text-amber-200">Після AI-аналізу змінилися рівні або умови плану. Запроси новий аналіз.</p>}
            {ai&&aiMatchesCurrent&&<div className="mt-3 space-y-4 rounded-lg border border-slate-700 bg-slate-950/70 p-3 leading-relaxed">
              <div><h3 className="font-semibold text-slate-100">Стан ринку</h3><p className="mt-1 text-slate-300">{ai.marketContext}</p></div>
              <div><h3 className="font-semibold text-cyan-200">Чому саме цей рівень Entry</h3><p className="mt-1 text-slate-300">{ai.entryLogic}</p></div>
              <div><h3 className="font-semibold text-slate-100">Умови підтвердження</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">{ai.confirmationConditions.map((c,i)=><li key={i}>{c}</li>)}</ul>
              </div>
              <div><h3 className="font-semibold text-amber-200">Коли ідея перестає діяти</h3><p className="mt-1 text-slate-300">{ai.invalidation}</p></div>
              <div><h3 className="font-semibold text-rose-200">Ризики</h3><p className="mt-1 text-slate-300">{ai.riskAnalysis}</p></div>
              <div><h3 className="font-semibold text-slate-100">Пояснення для новачка</h3><p className="mt-1 text-slate-300">{ai.beginnerExplanation}</p></div>
              <div><h3 className="font-semibold text-cyan-200">Наступна дія</h3><p className="mt-1 text-slate-300">{ai.nextAction}</p></div>
            </div>}
          </details>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="font-semibold">Параметри угоди</h2>
          <dl className="mt-3 space-y-2 text-xs text-slate-300">
            <div className="flex justify-between gap-2"><dt>Поточна ціна</dt><dd>{number(plan.currentPrice)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Зона входу</dt><dd>{number(plan.entryLow)}–{number(plan.entryHigh)}</dd></div>
            <div className="flex justify-between gap-2"><dt>R:R</dt><dd>1:{plan.riskReward.toFixed(2)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Відстань до Entry</dt><dd>{plan.limitEntry24h?.distanceAtr?.toFixed(2)??"—"} ATR</dd></div>
            <div className="flex justify-between gap-2"><dt>Stop Loss</dt><dd>{plan.qualityGate?.stopAtr?.toFixed(2)??"—"} ATR</dd></div>
            <div className="flex justify-between gap-2"><dt>Ризик Demo</dt><dd>{sizing?money(sizing.actualRisk)+" USDT":"—"}</dd></div>
          </dl>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-base font-semibold">Умови входу · {plan.readiness?.met??"—"}/{plan.readiness?.total??8}</h2>
          <p className="mt-1 text-xs text-slate-400">Технічні критерії {conditions.filter(c=>c.ok).length}/{conditions.length}</p>

          <div className="mt-3 space-y-2">
            {conditions.map(c=><div key={c.label} className="flex items-start gap-2 border-b border-slate-800/50 pb-1 text-xs">
              <span className={c.ok?"text-emerald-300":"text-amber-300"}>{c.ok?"✓":"○"}</span><span>{c.label}</span>
            </div>)}
          </div>
          <p className="mt-3 text-xs text-cyan-200"><strong>Наступна дія:</strong> {plan.nextStep}</p>
          <details className="mt-4 border-t border-slate-800 pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Всі технічні факти та незавершені умови</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
              {plan.reasons.map((r,i)=><li key={i}>{r}</li>)}
              {plan.qualityGate?.reasons.map((r,i)=><li key={`q-${i}`} className="text-amber-200">{r}</li>)}
            </ul>
          </details>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><h2 className="font-semibold">Історія сценарію</h2><p className="mt-2 text-xs text-slate-400">Локальна історія змін стану і рівнів, останні 30 записів</p><div className="mt-3 max-h-44 space-y-2 overflow-auto">{history.length?history.map(h=><div key={`${h.time}-${h.signature}`} className="border-b border-slate-800 pb-1 text-xs"><p className="text-amber-200">{h.label}</p><p className="text-slate-500">{when(h.time)}</p></div>):<p className="text-xs text-slate-500">Перший запис з’явиться після актуального аналізу.</p>}</div></section>
      </div>
      <p className="mt-3 text-xs text-slate-500">Demo Limit створюється лише після натискання «Створити Demo Limit-угоду» та повторної серверної перевірки. Перехід на Bybit через назву пари призначений тільки для перегляду. Реальні ордери в Alpha Pulse вимкнені.</p>
    </>}
  </main>;
}
export default function AnalysisPage(){
  return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-8 text-slate-300">Завантаження сторінки аналізу…</main>}><AnalysisView/></Suspense>;
}
