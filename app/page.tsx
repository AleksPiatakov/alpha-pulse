"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TradePlan } from "@/lib/trading";

type RejectionCounts = Record<"candles" | "trend" | "volume" | "momentum" | "distance" | "prices" | "daily_level" | "reward_risk" | "error", number>;
type ScanResponse = { success: boolean; scanned?: number; eligible?: number; analyzed?: number; plans?: TradePlan[]; covered?: number; category?: string; rejectionCounts?: RejectionCounts; generatedAt?: string; error?: string; universePages?: number; universeInstruments?: number; coveragePercent?: number; cycleCompleted?: boolean };
const rejectionLabels: Array<[keyof RejectionCounts, string]> = [
  ["candles", "Недостатньо свічок"], ["trend", "Немає узгодженого тренду"],
  ["volume", "Недостатній обсяг"], ["momentum", "Слабкий імпульс"],
  ["distance", "Вхід занадто далеко"], ["daily_level", "Немає денного рівня"],
  ["reward_risk", "Недостатній R:R"], ["prices", "Некоректні рівні"],
  ["error", "Помилка отримання даних"],
];
const price = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
const isInEntryZone = (plan: TradePlan) =>
  Number.isFinite(plan.currentPrice) &&
  Number.isFinite(plan.entryLow) &&
  Number.isFinite(plan.entryHigh) &&
  plan.currentPrice >= Math.min(plan.entryLow, plan.entryHigh) &&
  plan.currentPrice <= Math.max(plan.entryLow, plan.entryHigh);

const rankStyles = [
  { label: "Top 1", border: "border-emerald-400/80 shadow-emerald-500/10", badge: "bg-emerald-400 text-slate-950", accent: "text-emerald-300" },
  { label: "Top 2", border: "border-cyan-400/60", badge: "bg-cyan-400 text-slate-950", accent: "text-cyan-300" },
  { label: "Top 3", border: "border-violet-400/60", badge: "bg-violet-400 text-slate-950", accent: "text-violet-300" },
];

export default function MarketScanner() {
  const router = useRouter();
  const [plans, setPlans] = useState<TradePlan[]>([]);
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

  // Confirmed and in-zone are independent attributes: never rank an unconfirmed setup above a confirmed one solely for proximity.
  const byQuality = (a: TradePlan, b: TradePlan) =>
    b.score - a.score || b.riskReward - a.riskReward || a.symbol.localeCompare(b.symbol);
  const confirmedPlans = plans.filter((plan) => plan.status === "ACTIVE")
    .sort((a, b) => Number(isInEntryZone(b)) - Number(isInEntryZone(a)) || byQuality(a, b));
  const zonePlans = plans.filter((plan) => plan.status !== "ACTIVE" && isInEntryZone(plan))
    .sort(byQuality);
  const waitingPlans = plans.filter((plan) => plan.status !== "ACTIVE" && !isInEntryZone(plan))
    .sort(byQuality);
  const featuredCount = confirmedPlans.length + zonePlans.length;
  const groups = [
    { key: "confirmed", title: "Підтверджені", items: confirmedPlans, offset: 0 },
    { key: "zone", title: "Потенційні входи · без підтвердження", items: zonePlans, offset: confirmedPlans.length },
    ...(showWaiting ? [{ key: "waiting", title: "Очікування", items: waitingPlans, offset: featuredCount }] : []),
  ];

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
          {waitingPlans.length > 0 && <button type="button"
            aria-expanded={showWaiting}
            onClick={() => setShowWaiting((open) => !open)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-slate-100">
            <span aria-hidden="true">{showWaiting ? "▾" : "▸"}</span>
            Очікування {waitingPlans.length} · {showWaiting ? "Згорнути" : "Показати"}
          </button>}
          <div aria-label="Статистика сканера" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 sm:gap-x-4">
          <span>Bybit linear <strong className="font-semibold text-slate-200">{counts.scanned}</strong></span>
          <span>Доступних <strong className="font-semibold text-slate-200">{counts.eligible}</strong></span>
          <span>Реєстр <strong className="font-semibold text-slate-200">{marketCoverage.instruments}</strong> · стор. {marketCoverage.pages}</span>
          <span>Обхід <strong className="font-semibold text-slate-200">{counts.covered}/{counts.eligible}</strong> ({marketCoverage.percent}%) {marketCoverage.complete ? "✓" : "…"}</span>
          <span>Видимих <strong className="font-semibold text-emerald-300">{featuredCount}</strong></span>
          <span>Оновлено <strong className="font-semibold tabular-nums text-slate-200">{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}</strong></span>
          </div>
        </div>
      </div>
      {featuredCount === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-6 text-sm text-slate-300">
        <p className="font-semibold text-slate-100">Поки немає підтверджених сценаріїв або ціни в зоні входу.</p>
        <p className="mt-1 text-slate-400">Інші сценарії можна переглянути нижче. Перевірка ринку продовжується під час оновлень.</p>
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
        {group.items.map((plan, index) => {
          const position = group.offset + index;
          const rank = rankStyles[position];
          const isLong = plan.direction === "LONG";
          return <article key={plan.id} className={`rounded-xl border bg-slate-900 p-4 shadow-lg ${rank?.border ?? "border-slate-700"}`}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-wide ${rank?.badge ?? "bg-slate-700 text-slate-200"}`}>{rank?.label ?? `Top ${position + 1}`}</span><span className={`rounded px-2 py-1 text-[10px] font-semibold ${plan.status === "ACTIVE" ? "bg-emerald-950 text-emerald-200" : "bg-amber-950 text-amber-200"}`}>{plan.status === "ACTIVE" ? (isInEntryZone(plan) ? "Підтверджено · у зоні" : "Підтверджено") : (isInEntryZone(plan) ? "У зоні" : "Очікування")}</span>
                <h3 className="text-lg font-black">{plan.symbol}</h3>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${isLong ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}`}>{plan.direction}</span>
            </div>
            <div className="mb-3 flex items-end justify-between border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className={`text-sm font-bold ${rank?.accent ?? "text-slate-300"}`}>Потенціал {plan.score}/100</p><p className={`text-xs font-semibold ${plan.status === "ACTIVE" ? "text-emerald-300" : "text-amber-300"}`}>Готовність {plan.readiness?.met ?? "—"}/{plan.readiness?.total ?? 8}</p><p className="text-xs font-semibold text-emerald-300">R:R 1:{plan.riskReward.toFixed(2)}</p></div>
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
            <button onClick={() => openPlan(plan)} className={`mt-4 w-full rounded-lg px-4 py-2 text-sm font-bold ${position === 0 ? "bg-emerald-400 text-slate-950 hover:bg-emerald-300" : "bg-slate-800 text-slate-100 hover:bg-slate-700"}`}>{position === 0 ? "Переглянути сценарій →" : "Відкрити план"}</button>
          </article>;
        })}
        </div>
      </section>)}
    </section>}
  </main>;
}

