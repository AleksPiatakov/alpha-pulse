"use client";
import Link from "next/link";
import {useState} from "react";

const CORE=["BTCUSDT","ETHUSDT","SOLUSDT"] as const;
const LOW_CANDIDATES=["XRPUSDT","ADAUSDT","LTCUSDT","TRXUSDT","XLMUSDT","LINKUSDT","BCHUSDT","ETCUSDT"] as const;
type Run={
 model:"video-3r"|"comparison-2r";costMode:"reference"|"conservative";
 signals:number;trades:number;censored:number;winRate:number|null;
 totalNetR:number;averageNetR:number|null;maxDrawdownR:number;
};
type Response={success:boolean;symbol?:string;error?:string;days?:number;
 volatilityAnnualizedPct?:number|null;snapshotSha256?:string;models?:Run[]};
const fmt=(v:number|null|undefined,d=2)=>v==null?"—":v.toFixed(d);
export default function Ema50StudyPage(){
 const [days,setDays]=useState<120|365>(120);
 const [results,setResults]=useState<Record<string,Response>>({});
 const [running,setRunning]=useState(false);
 const [current,setCurrent]=useState("");
 async function run(){
   if(running)return;
   setRunning(true);setResults({});
   try{
     for(const symbol of [...CORE,...LOW_CANDIDATES]){
       setCurrent(symbol);
       try{
         const r=await fetch(`/api/research/ema50?symbol=${symbol}&days=${days}`,{cache:"no-store"});
         const json=await r.json() as Response;
         setResults(old=>({...old,[symbol]:r.ok?json:{success:false,error:json.error||"Історія недоступна"}}));
       }catch{
         setResults(old=>({...old,[symbol]:{success:false,error:"Сервер або Bybit недоступний"}}));
       }
     }
   }finally{setRunning(false);setCurrent("");}
 }
 const valid=LOW_CANDIDATES.filter(symbol=>
   results[symbol]?.success&&Number.isFinite(results[symbol].volatilityAnnualizedPct));
 const low=[...valid].sort((a,b)=>
   (results[a].volatilityAnnualizedPct??Infinity)-(results[b].volatilityAnnualizedPct??Infinity)).slice(0,3);
 const high=CORE.filter(symbol=>results[symbol]?.success);
 const rows=(symbols:readonly string[])=>symbols.flatMap(symbol=>{
   const r=results[symbol];if(!r?.success)return [];
   return (["video-3r","comparison-2r"] as const).map(model=>{
     const normal=r.models?.find(x=>x.model===model&&x.costMode==="reference");
     const stress=r.models?.find(x=>x.model===model&&x.costMode==="conservative");
     return {symbol,model,normal,stress,volatility:r.volatilityAnnualizedPct};
   });
 });
 function table(symbols:readonly string[]){
   return <div className="overflow-x-auto">
     <table className="w-full min-w-[940px] text-left text-sm">
       <thead className="border-b border-slate-700 text-xs text-slate-400">
         <tr><th className="py-3">Пара</th><th>Волатильність, % річних</th><th>Take Profit</th>
           <th>Сигнали</th><th>Угоди</th><th>Win %</th><th>База, R</th>
           <th>Стрес, R</th><th>Просідання, R</th><th>Незавершені</th></tr>
       </thead>
       <tbody>{rows(symbols).map(r=><tr key={r.symbol+r.model} className="border-b border-slate-800">
         <td className="py-3 font-semibold">{r.symbol}</td>
         <td>{fmt(r.volatility)}</td>
         <td>{r.model==="video-3r"?"7,5% (3R)":"5% (2R)"}</td>
         <td>{r.stress?.signals??"—"}</td><td>{r.stress?.trades??"—"}</td>
         <td>{fmt(r.stress?.winRate)}</td>
         <td className={(r.normal?.totalNetR??0)<0?"text-rose-300":"text-emerald-300"}>{fmt(r.normal?.totalNetR,3)}</td>
         <td className={(r.stress?.totalNetR??0)<0?"text-rose-300":"text-emerald-300"}>{fmt(r.stress?.totalNetR,3)}</td>
         <td>{fmt(r.stress?.maxDrawdownR,3)}</td><td>{r.stress?.censored??"—"}</td>
       </tr>)}</tbody>
     </table>
     {!rows(symbols).length&&<p className="py-5 text-sm text-slate-400">Дані ще не отримані.</p>}
   </div>;
 }
 return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8">
   <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
     <div><Link href="/strategy-lab" className="text-sm text-emerald-400">← Strategy Lab</Link>
       <h1 className="mt-2 text-2xl font-bold">EMA 50 · тест стратегії з відео</h1>
       <p className="mt-2 max-w-3xl text-sm text-slate-400">
         4h/1h EMA50 із нахилом, відкат до годинної EMA та закриття 15m у напрямку тренду.
         Stop 2,5%; перевіряємо Take 7,5% (авторський) проти 5% (контрольний).
       </p></div>
     <div className="flex flex-wrap items-center gap-2">
       <select value={days} disabled={running} onChange={e=>setDays(Number(e.target.value) as 120|365)}
         aria-label="Тривалість історії" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
         <option value={120}>120 днів</option><option value={365}>365 днів</option>
       </select>
       <button type="button" onClick={()=>void run()} disabled={running}
         className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">
         {running?`Перевіряю ${current}…`:"Запустити порівняння"}
       </button>
     </div>
   </header>
   <p className="mb-5 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-200">
     BTC, ETH і SOL — задана група для порівняння, а не доведений поточний топ волатильності.
     Три менш волатильні пари визначаються після завантаження історії за фактичною річною
     волатильністю годинних доходностей серед восьми кандидатів. Ранжування за цим самим
     періодом є дослідницьким; незалежною перевіркою воно не вважається.
   </p>
   <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
     <h2 className="mb-3 text-lg font-semibold">Група A · BTC / ETH / SOL</h2>{table(high)}
   </section>
   <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
     <h2 className="mb-1 text-lg font-semibold">Група B · три найменш волатильні з перевірених кандидатів</h2>
     <p className="mb-3 text-xs text-slate-400">
       Кандидати: {LOW_CANDIDATES.join(", ")}. Якщо деякі пари недоступні — вони не потрапляють у вибірку.
     </p>{table(low)}
   </section>
   <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
     <h2 className="mb-3 font-semibold">Стан історичних даних</h2>
     <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
       {[...CORE,...LOW_CANDIDATES].map(symbol=><div key={symbol} className="rounded-lg border border-slate-800 p-3 text-sm">
         <strong>{symbol}</strong><p className="mt-1 text-xs text-slate-400">
           {results[symbol]?.success?`Готово · σ ${fmt(results[symbol].volatilityAnnualizedPct)}% · SHA ${results[symbol].snapshotSha256?.slice(0,12)}…`:
             results[symbol]?.error??"Очікує перевірки"}
         </p>
       </div>)}
     </div>
   </section>
   <p className="mt-5 max-w-4xl text-xs leading-relaxed text-slate-400">
     Фіксований кінець історії — 12.11.2026, 00:00 UTC. Знімки зберігаються локально
     і не замінюються при повторних тестах. Вхід моделюється на open наступної 15m свічки.
     Консервативний режим: комісія 0,075% на сторону, 5 bps несприятливого входу,
     10 bps прослизання SL, 5 bps для TIMEOUT, пріоритет стопа при невідомому
     внутрішньосвічковому порядку. Funding, реальний bid/ask, ліквідність та кореляція
     не враховані. Сума R не є дохідністю портфеля. Жодних автоматичних ордерів.
   </p>
 </main>;
}
