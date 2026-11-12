"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TradePlan } from "@/lib/trading";

type ScanResponse = { success: boolean; scanned?: number; eligible?: number; analyzed?: number; plans?: TradePlan[]; generatedAt?: string; error?: string };
const price = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
const rankStyles = [
  { label: "★ Top 1 · пріоритет", border: "border-emerald-400/80 shadow-emerald-500/10", badge: "bg-emerald-400 text-slate-950", accent: "text-emerald-300" },
  { label: "Top 2", border: "border-cyan-400/60", badge: "bg-cyan-400 text-slate-950", accent: "text-cyan-300" },
  { label: "Top 3", border: "border-violet-400/60", badge: "bg-violet-400 text-slate-950", accent: "text-violet-300" },
];

export default function MarketScanner() {
  const router = useRouter();
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [counts, setCounts] = useState({ scanned: 0, eligible: 0, analyzed: 0 });
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/scan", { cache: "no-store" });
      const data = await response.json() as ScanResponse;
      if (!response.ok || !data.success) throw new Error(data.error || "Не вдалося оновити аналіз.");
      setPlans(data.plans ?? []);
      setCounts({ scanned: data.scanned ?? 0, eligible: data.eligible ?? 0, analyzed: data.analyzed ?? 0 });
      setUpdatedAt(data.generatedAt); setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Помилка сканування."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);

  const openPlan = (plan: TradePlan) => {
    localStorage.setItem("alpha-pulse-plan-v1", JSON.stringify(plan));
    router.push(`/trade/${plan.symbol}`);
  };

  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8">
    <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-extrabold text-emerald-400">ALPHA PULSE</h1></div></div>
      <div className="flex items-center gap-3"><Link href="/orders" className="rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold hover:border-cyan-400">Активні заявки</Link><Link href="/settings" className="rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold hover:border-cyan-400">Ризик і позиції</Link><button onClick={() => void refresh()} className="rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold hover:border-emerald-400">↻ Оновити</button></div>
    </header>

    {error && <p className="mb-5 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {loading ? <p className="py-20 text-center text-slate-400">Будується шість торгових setup-планів…</p> : <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <h2 className="text-xl font-bold">Рейтинг торгових планів</h2>
        <div aria-label="Статистика сканера" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 sm:gap-x-4">
          <span>Bybit <strong className="font-semibold text-slate-200">{counts.scanned}</strong></span>
          <span>Ліквідних <strong className="font-semibold text-slate-200">{counts.eligible}</strong></span>
          <span>Аналіз <strong className="font-semibold text-slate-200">{counts.analyzed}</strong></span>
          <span>Плани <strong className="font-semibold text-emerald-300">{plans.length}/6</strong></span>
          <span>Оновлено <strong className="font-semibold tabular-nums text-slate-200">{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}</strong></span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan, index) => {
          const rank = rankStyles[index];
          const isLong = plan.direction === "LONG";
          return <article key={plan.id} className={`rounded-xl border bg-slate-900 p-4 shadow-lg ${rank?.border ?? "border-slate-700"}`}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wide ${rank?.badge ?? "bg-slate-700 text-slate-200"}`}>{rank?.label ?? `Top ${index + 1}`}</span>
                <h3 className="text-lg font-black">{plan.symbol}</h3>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${isLong ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}`}>{plan.direction}</span>
            </div>
            <div className="mb-3 flex items-end justify-between border-b border-slate-800 pb-3">
              <p className={`text-sm font-bold ${rank?.accent ?? "text-slate-300"}`}>Score {plan.score}/100</p>
              <p className="text-xs text-slate-400">Ціна зараз: <b className="text-slate-200">{price(plan.currentPrice)}</b></p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs text-slate-500">Limit-вхід</dt><dd className="font-bold text-cyan-300">{price(plan.entryPrice)}</dd></div>
              <div><dt className="text-xs text-slate-500">Зона</dt><dd>{price(plan.entryLow)}–{price(plan.entryHigh)}</dd></div>
              <div><dt className="text-xs text-slate-500">Stop-loss</dt><dd className="text-rose-300">{price(plan.stopLoss)}</dd></div>
              <div><dt className="text-xs text-slate-500">Take-profit</dt><dd className="text-emerald-300">{price(plan.takeProfit2)}</dd></div>
            </dl>
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Пояснення сценарію</p>{plan.explanationSource === "ai" ? <span className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">AI</span> : <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">ТЕХНІЧНЕ</span>}</div><p className="mt-1 text-xs leading-relaxed text-slate-200">{plan.summary}</p><p className="mt-2 border-l-2 border-amber-400/70 pl-2 text-[11px] leading-relaxed text-amber-100">Ризик: {plan.caution}</p><p className="mt-2 text-[11px] text-cyan-200">Дія: {plan.nextStep}</p></div>
            <details className="mt-3 rounded-lg bg-slate-950/60 px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-slate-400">Деталі технічного аналізу</summary><div className="mt-3 flex flex-wrap gap-1.5">{plan.reasons.map((reason) => <span key={reason} className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300">{reason}</span>)}</div></details>
            <p className="mt-3 text-xs text-amber-200">Інвалідація: {plan.invalidation}</p>
            <button onClick={() => openPlan(plan)} className={`mt-4 w-full rounded-lg px-4 py-2 text-sm font-bold ${index === 0 ? "bg-emerald-400 text-slate-950 hover:bg-emerald-300" : "bg-slate-800 text-slate-100 hover:bg-slate-700"}`}>{index === 0 ? "Переглянути Top-1 план →" : "Відкрити план"}</button>
          </article>;
        })}
      </div>
    </section>}
  </main>;
}

