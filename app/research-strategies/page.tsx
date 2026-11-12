"use client";

import Link from "next/link";
import { useState } from "react";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"] as const;
type Result = {
  key: string;
  reference: { signals: number; filled: number; unfilled: number; censored: number; totalNetR: number;
    averageNetR: number | null; maxDrawdownR: number; assumptions: string[] };
  conservative: { signals: number; filled: number; unfilled: number; censored: number; totalNetR: number;
    averageNetR: number | null; maxDrawdownR: number; assumptions: string[] };
};
type Response = { success: boolean; error?: string; symbol?: string; partialHistory?: boolean;
  snapshotSha256?: string | null; researchStrategies?: Result[] };
const labels: Record<string,string> = {
  "trend-pullback-v1": "Trend Pullback",
  "breakout-retest-v1": "Breakout + Retest",
};
const fmt = (v:number|null|undefined) => v==null?"—":v.toFixed(3);

export default function ResearchStrategiesPage() {
  const [results,setResults] = useState<Record<string,Response>>({});
  const [busy,setBusy] = useState(false);
  const [current,setCurrent] = useState("");
  async function run() {
    if(busy)return;
    setBusy(true);setResults({});
    try {
      for(const symbol of SYMBOLS) {
        setCurrent(symbol);
        try {
          const response=await fetch(`/api/backtest?symbol=${symbol}&fixed=1&ticks=1&snapshot=auto&research=1`,
            {cache:"no-store"});
          const data=await response.json() as Response;
          setResults(old=>({...old,[symbol]:response.ok?data:{success:false,error:data.error||"Тест недоступний."}}));
        } catch {
          setResults(old=>({...old,[symbol]:{success:false,error:"Немає доступу до локального сервера."}}));
        }
      }
    } finally {setCurrent("");setBusy(false);}
  }
  const rows=SYMBOLS.flatMap(symbol => {
    const payload=results[symbol];
    if(!payload?.success||payload.partialHistory||!payload.snapshotSha256)return [];
    return (payload.researchStrategies??[]).map(r=>({symbol,...r}));
  });
  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div><Link href="/strategy-lab" className="text-sm text-emerald-400">← Strategy Lab</Link>
        <h1 className="mt-2 text-2xl font-bold">Нові торгові стратегії · історичні дослідження</h1></div>
      <button type="button" onClick={()=>void run()} disabled={busy}
        className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">
        {busy?`Перевіряю ${current}…`:"Тестувати 8 пар"}
      </button>
    </header>
    <p className="mb-5 max-w-4xl text-sm leading-relaxed text-slate-400">
      Дві незалежні дослідницькі стратегії. Фіксована історія до 12.11.2026, спільні збережені свічки Bybit
      та tickSize. Базовий і консервативний режими тестуються окремо. Жодна стратегія
      не має дозволу на автоматичну Demo-торгівлю. Цей період уже використовувався для досліджень,
      тому результати не є незалежним підтвердженням прибутковості.
    </p>
    <div className="mb-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 font-semibold">Результати за парами</h2>
      <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="border-b border-slate-700 text-xs text-slate-400">
          <tr><th className="py-2">Пара</th><th>Стратегія</th><th>Сигналів</th><th>Виконано</th>
            <th>Не виконано</th><th>Незавершені</th><th>R базовий</th><th>R консервативний</th><th>Просідання R</th></tr>
        </thead>
        <tbody>
          {rows.map(r=><tr key={r.symbol+r.key} className="border-b border-slate-800">
            <td className="py-3 font-semibold">{r.symbol}</td><td>{labels[r.key]??r.key}</td>
            <td>{r.conservative.signals}</td><td>{r.conservative.filled}</td>
            <td>{r.conservative.unfilled}</td><td>{r.conservative.censored}</td>
            <td className={r.reference.totalNetR<0?"text-rose-300":"text-emerald-300"}>{fmt(r.reference.totalNetR)}</td>
            <td className={r.conservative.totalNetR<0?"text-rose-300":"text-emerald-300"}>{fmt(r.conservative.totalNetR)}</td>
            <td>{fmt(r.conservative.maxDrawdownR)}</td>
          </tr>)}
        </tbody>
      </table>
      {!busy&&!rows.length&&<p className="py-8 text-center text-slate-400">Запусти перевірку, щоб побачити результати двох стратегій.</p>}
    </div>
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
      <h2 className="mb-2 font-semibold">Доступність даних</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SYMBOLS.map(symbol=><p key={symbol} className="rounded-lg border border-slate-800 p-3">
          <strong>{symbol}</strong><span className="block text-xs text-slate-400">
            {results[symbol]?.success
              ?results[symbol]?.partialHistory?"Часткова історія — виключено":"Історію перевірено"
              :results[symbol]?.error??"Не перевірено"}
          </span></p>)}
      </div>
    </div>
    <p className="mt-5 text-xs text-amber-200">
      Консервативний режим: проникнення на 1 tick перед Limit-входом, комісія 0,075% на сторону,
      SL 10 bps плюс несприятливий gap, TIMEOUT 5 bps. Внутрішньосвічковий порядок не відомий.
      Сумарний R — не прибуток портфеля; funding, spread та взаємна кореляція позицій не враховані.
      Параметри створені як дослідницькі гіпотези, не оптимізовані або перевірені на незалежному holdout.
    </p>
  </main>;
}
