"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TradePlan } from "@/lib/trading";
import { comparePlanPriority, isAtEntryZone } from "@/lib/plan-ranking";

type RejectionCounts = Record<"candles" | "trend" | "volume" | "momentum" | "distance" | "prices" | "daily_level" | "reward_risk" | "error", number>;
type ScanResponse = { success: boolean; scanned?: number; eligible?: number; analyzed?: number; plans?: TradePlan[]; recommended24h?: TradePlan[]; recommended24hComplete?: boolean; entryHorizonHours?: number; covered?: number; category?: string; rejectionCounts?: RejectionCounts; generatedAt?: string; error?: string; universePages?: number; universeInstruments?: number; coveragePercent?: number; cycleCompleted?: boolean };
const rejectionLabels: Array<[keyof RejectionCounts, string]> = [
  ["candles", "Недостатньо свічок"], ["trend", "Немає узгодженого тренду"],
  ["volume", "Недостатній обсяг"], ["momentum", "Слабкий імпульс"],
  ["distance", "Вхід занадто далеко"], ["daily_level", "Немає денного рівня"],
  ["reward_risk", "Недостатній R:R"], ["prices", "Некоректні рівні"],
  ["error", "Помилка отримання даних"],
];
const price = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
const isInEntryZone = isAtEntryZone;

// Display only real research shortlist members as Top 1..10, never REVIEW or
// merely in-zone cards. Source data is produced by the strict server-side gate.
const bybitChartUrl = (symbol: string) =>
  /^[A-Z0-9]{3,24}USDT$/.test(symbol) ? `https://www.bybit.com/trade/usdt/${symbol}` : null;


export default function MarketScanner() {
  const router = useRouter();
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [recommended24h,setRecommended24h] = useState<TradePlan[]>([]);
  const [recommendationsComplete,setRecommendationsComplete] = useState(false);
  const [counts, setCounts] = useState({ scanned: 0, eligible: 0, analyzed: 0, covered: 0 });
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [marketCoverage, setMarketCoverage] = useState({ pages: 0, instruments: 0, percent: 0, complete: false });
  const [rejectionCounts, setRejectionCounts] = useState<RejectionCounts>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [showWaiting, setShowWaiting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/scan", { cache: "no-store" });
      const data = await response.json() as ScanResponse;
      if (!response.ok || !data.success) throw new Error(data.error || "Не вдалося оновити аналіз.");
      setPlans(data.plans ?? []);
      setRecommended24h(data.recommended24h ?? []);
      setRecommendationsComplete(data.recommended24hComplete === true);
      setCounts({ scanned: data.scanned ?? 0, eligible: data.eligible ?? 0, analyzed: data.analyzed ?? 0, covered: data.covered ?? 0 });
      setUpdatedAt(data.generatedAt); setRejectionCounts(data.rejectionCounts); setError(undefined);
      setMarketCoverage({ pages: data.universePages ?? 0, instruments: data.universeInstruments ?? 0,
        percent: data.coveragePercent ?? 0, complete: data.cycleCompleted ?? false });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Помилка сканування."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);

  // The strict, separately checked server shortlist is the ONLY "Top" group.
  // Other market analyses are observable but never presented as approved entries.
  const topSymbols = new Set(recommended24h.map(p=>p.symbol));
  const unconfirmedPlans = plans.filter(p=>!topSymbols.has(p.symbol))
    .sort(comparePlanPriority);
  const featuredCount = recommended24h.length;
  const groups = showWaiting ? [{
    key: "observing", title: "Досліджені пари · не готові до входу",
    items: unconfirmedPlans,
  }] : [];

  const openPlan = (plan: TradePlan) => {
    localStorage.setItem("alpha-pulse-plan-v1", JSON.stringify(plan));
    router.push(`/trade/${plan.symbol}`);
  };

  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8">
    <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-extrabold text-emerald-400">ALPHA PULSE</h1></div></div>
      <div className="flex flex-wrap items-center gap-2"><Link href="/strategy-lab" className="rounded-lg border border-emerald-700 bg-emerald-950/50 px-3 py-2 text-sm font-semibold text-emerald-200 hover:border-emerald-400">Strategy Lab</Link><Link href="/backtest" className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold hover:border-cyan-400">Історичні тести</Link><Link href="/orders" className="rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold hover:border-cyan-400">Активні заявки</Link><Link href="/settings" className="rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold hover:border-cyan-400">Ризик і позиції</Link><button onClick={() => void refresh()} className="rounded-lg border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold hover:border-emerald-400">↻ Оновити</button></div>
    </header>

    {error && <p className="mb-5 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {loading ? <p className="py-20 text-center text-slate-400">Сканування інструментів Bybit…</p> : <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <h2 className="text-xl font-bold">Рейтинг торгових планів</h2>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {unconfirmedPlans.length > 0 && <button type="button"
            aria-expanded={showWaiting}
            onClick={() => setShowWaiting((open) => !open)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-slate-100">
            <span aria-hidden="true">{showWaiting ? "▾" : "▸"}</span>
            Спостереження {unconfirmedPlans.length} · {showWaiting ? "Згорнути" : "Показати"}
          </button>}
          <div aria-label="Статистика сканера" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 sm:gap-x-4">
          <span>Bybit linear <strong className="font-semibold text-slate-200">{counts.scanned}</strong></span>
          <span>Доступних <strong className="font-semibold text-slate-200">{counts.eligible}</strong></span>
          <span>Реєстр <strong className="font-semibold text-slate-200">{marketCoverage.instruments}</strong> · стор. {marketCoverage.pages}</span>
          <span>Обхід <strong className="font-semibold text-slate-200">{counts.covered}/{counts.eligible}</strong> ({marketCoverage.percent}%) {marketCoverage.complete ? "✓" : "…"}</span>
          <span>Кандидатів 24h <strong className="font-semibold text-emerald-300">{featuredCount}</strong></span>
          <span>Оновлено <strong className="font-semibold tabular-nums text-slate-200">{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}</strong></span>
          </div>
        </div>
      </div>
      <section className="mb-5 rounded-xl border border-cyan-800/60 bg-slate-900/70 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-cyan-200">Limit-входи · горизонт 24 години · до 10 кандидатів</h3>
          <span className="text-xs text-amber-200">{recommendationsComplete ? "Поточний обхід завершено; дані можуть застарівати" : "Попередній список · повний обхід ще триває"}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-slate-400">Лише технічно ACTIVE, з дослідним фільтром якості, структурною денною ціллю та історично досяжним відкладеним рівнем. Минулі торкання не є прогнозованою ймовірністю виконання заявки. Кожен план оновлюється окремо й може втратити актуальність до завершення обходу.</p>
        {recommended24h.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {recommended24h.map((plan,index)=><div key={plan.id}
            className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-left">
            <div className="flex justify-between gap-2"><span className="text-sm font-semibold">TOP {index+1} · {plan.symbol} · {plan.direction}</span>
              <span className="text-xs text-cyan-300">{plan.score}/100</span></div>
            <p className="mt-2 text-xs text-slate-300">Limit {price(plan.entryPrice)} · SL {price(plan.stopLoss)} · TP {price(plan.takeProfit2)}</p>
            <p className="mt-1 text-[11px] text-slate-400">24h історичні торкання: {plan.limitEntry24h?.historicalTouchRate == null ? "—" : (100*plan.limitEntry24h.historicalTouchRate).toFixed(1)+"%"} · {plan.limitEntry24h?.sampleWindows??0} перекривних вікон</p>
            <p className="mt-1 text-[11px] text-slate-500">Горизонт Entry: {plan.observation?.observedAt ? new Date(plan.observation.observedAt).toLocaleString("uk-UA") : "—"} → {plan.observation?.observedAt ? new Date(plan.observation.observedAt+86_400_000).toLocaleString("uk-UA") : "—"} · це не термін дії GTC-ордера</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={()=>openPlan(plan)} className="rounded-md bg-emerald-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300">Переглянути план</button>
              {bybitChartUrl(plan.symbol) && <a href={bybitChartUrl(plan.symbol)!} target="_blank" rel="noopener noreferrer" className="rounded-md border border-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-400">↗ Графік Bybit</a>}
            </div>
          </div>)}
        </div> : <p className="text-sm text-slate-400">Поки немає кандидатів, що пройшли всі попередні умови. Це не означає, що ринок уже повністю перевірено.</p>}
      </section>
      <p className="mb-3 text-xs text-amber-200">«Підтверджено» означає технічну готовність MTF, не доказ прибутковості. Дослідний фільтр якості показано окремо. До завершення обходу це не рейтинг усього ринку.</p>
      {featuredCount === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-6 text-sm text-slate-300">
        <p className="font-semibold text-slate-100">Поки немає сценаріїв, що пройшли суворий 24h Limit-відбір.</p>
        <p className="mt-1 text-slate-400">Непідтверджені результати доступні в розділі «Спостереження». Ринок продовжує скануватися.</p>
        {rejectionCounts && <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-400">Чому пари не пройшли відбір</summary>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {rejectionLabels.filter(([key]) => rejectionCounts[key] > 0).map(([key, label]) =>
              <span key={key}>{label}: <strong className="text-slate-200">{rejectionCounts[key]}</strong></span>)}
          </div>
        </details>}
      </section>}
      {groups.filter((group) => group.items.length > 0).map((group) => <section key={group.key} className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">{group.title}</h3>
          <span className="text-xs tabular-nums text-slate-500">{group.items.length}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {group.items.map((plan) => {
          const isLong = plan.direction === "LONG";
          return <article key={plan.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300">Спостереження</span><span className={`rounded px-2 py-1 text-[10px] font-semibold ${plan.status === "ACTIVE" ? "bg-emerald-950 text-emerald-200" : "bg-amber-950 text-amber-200"}`}>{plan.status === "ACTIVE" ? (isInEntryZone(plan) ? "Підтверджено · у зоні" : "Підтверджено") : (isInEntryZone(plan) ? "У зоні" : "Очікування")}</span>
                <h3 className="text-lg font-black">{plan.symbol}</h3>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${isLong ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}`}>{plan.direction}</span>
            </div>
            <p className="mb-2 text-xs text-amber-200">Аналіз виконаний; умови готової пропозиції ще не виконані. Це не рекомендація розміщувати заявку.</p>
            
            <div className="mb-3 flex items-end justify-between border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className={`text-sm font-bold text-slate-300`}>Потенціал {plan.score}/100</p><p className={`text-xs font-semibold ${plan.status === "ACTIVE" ? "text-emerald-300" : "text-amber-300"}`}>Готовність {plan.readiness?.met ?? "—"}/{plan.readiness?.total ?? 8}</p><p className="text-xs font-semibold text-emerald-300">R:R 1:{plan.riskReward.toFixed(2)}</p></div>
              <p className="text-xs text-slate-400">Ціна зараз: <b className="text-slate-200">{price(plan.currentPrice)}</b></p>
            </div>
            <dl className="grid grid-cols-4 gap-2 border-y border-slate-800 py-3 text-[11px]">
              <div className="min-w-0"><dt className="text-slate-500">Limit-вхід</dt><dd className="mt-1 break-all font-bold text-cyan-300">{price(plan.entryPrice)}</dd></div>
              <div className="min-w-0"><dt className="text-slate-500">Зона</dt><dd className="mt-1 break-all text-slate-200">{price(plan.entryLow)}–{price(plan.entryHigh)}</dd></div>
              <div className="min-w-0"><dt className="text-slate-500">Take Profit</dt><dd className="mt-1 break-all text-emerald-300">{price(plan.takeProfit2)}</dd></div>
              <div className="min-w-0"><dt className="text-slate-500">Stop Loss</dt><dd className="mt-1 break-all text-rose-300">{price(plan.stopLoss)}</dd></div>
            </dl>
            <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-300">Пояснення, причини, ризики та правила для новачка</summary>
              <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-300">
                <p><strong className="text-slate-100">Що означає сценарій:</strong> {plan.summary}</p>
                <p><strong className="text-amber-200">Чому ще не готово:</strong> {plan.qualityGate?.reasons.join("; ") || "Потрібно завершити незалежні перевірки 24h Limit-входу."}</p>
                <p><strong className="text-slate-100">Технічні факти:</strong> {plan.reasons.join("; ")}</p>
                <p><strong className="text-amber-200">Ризики:</strong> {plan.caution}</p>
                <p><strong className="text-cyan-200">Що робити:</strong> {plan.nextStep}</p>
                <p><strong className="text-amber-200">Перегляд сценарію:</strong> {plan.lifecycle?.setupReview ?? plan.invalidation}</p>
                <p><strong className="text-rose-200">Stop Loss:</strong> {plan.lifecycle?.stopProtection ?? "Уточнюйте тригер у деталях Demo-ордера."}</p>
                <p className="text-slate-400">Entry — ціна очікуваної Limit-заявки, зона — можливе відхилення ціни, Take Profit — ціль, Stop Loss — захисний рівень. Навіть збіг умов не гарантує виконання заявки чи прибутку.</p>
              </div>
            </details>
            <div className="mt-3 flex flex-wrap gap-2">
              {bybitChartUrl(plan.symbol) && <a href={bybitChartUrl(plan.symbol)!} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-cyan-700 px-3 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-400">↗ Графік Bybit</a>}
            </div>
            <button onClick={() => openPlan(plan)} className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Деталі аналізу</button>
          </article>;
        })}
        </div>
      </section>)}
    </section>}
  </main>;
}

