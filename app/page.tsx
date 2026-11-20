"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TradePlan } from "@/lib/trading";
import { comparePlanPriority } from "@/lib/plan-ranking";

type SelectionDiagnostics = {availablePlans:number; technicalActive:number; qualityPassed:number; structuralEntryAndTarget:number; historicallyReachable24h:number;eligible24h:number;hiddenByFreshness:number;activeQualityFailures:number;qualityFailures:Array<{reason:string;count:number}>;activeExamples:Array<{symbol:string;score:number;readiness:string;rr:number;distanceAtr:number|null;stopAtr:number|null;reasons:string[]}>};
type WatchedScenario = {symbol:string;direction:"LONG"|"SHORT";state:"WATCHING"|"READY_FOR_REVIEW"|"STALE"|"EXPIRED"|"NO_CURRENT_PLAN";firstSeenAt:number;lastCheckedAt:number;validUntil:number;transitions:number;entry:number;stop:number;target:number;rr:number;score:number;confirmedConditions:string[];pendingConditions:string[];note:string;hasFreshPlan:boolean;orderAuthorized:false};
type WatchStatusCounts={watching:number;ready:number;stale:number;expired:number;unavailable:number};
type RejectionCounts = Record<"candles" | "trend" | "volume" | "momentum" | "distance" | "prices" | "daily_level" | "reward_risk" | "error", number>;
type ScanResponse = { success: boolean; scanned?: number; eligible?: number; analyzed?: number; batchSize?: number; scanConcurrency?: number; selectionDiagnostics?: SelectionDiagnostics; plans?: TradePlan[]; recommended24h?: TradePlan[]; watchedScenarios?: WatchedScenario[]; watchStatusCounts?: WatchStatusCounts; recommended24hComplete?: boolean; entryHorizonHours?: number; covered?: number; category?: string; rejectionCounts?: RejectionCounts; generatedAt?: string; error?: string; universePages?: number; universeInstruments?: number; coveragePercent?: number; cycleCompleted?: boolean; freshChecked?: number; staleChecked?: number; failedChecked?: number; unchecked?: number; oldestCheckedAgeSeconds?: number|null; batchDurationMs?: number; priorityRechecked?: number };
const rejectionLabels: Array<[keyof RejectionCounts, string]> = [
  ["candles", "Недостатньо свічок"], ["trend", "Немає узгодженого тренду"],
  ["volume", "Недостатній обсяг"], ["momentum", "Слабкий імпульс"],
  ["distance", "Вхід занадто далеко"], ["daily_level", "Немає денного рівня"],
  ["reward_risk", "Недостатній R:R"], ["prices", "Некоректні рівні"],
  ["error", "Помилка отримання даних"],
];
const price = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;

// Full technical and AI analysis lives on dedicated pages.\n

export default function MarketScanner() {
  const router = useRouter();
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [recommended24h,setRecommended24h] = useState<TradePlan[]>([]);
  const [watchedScenarios,setWatchedScenarios]=useState<WatchedScenario[]>([]);
  const [watchStatusCounts,setWatchStatusCounts]=useState<WatchStatusCounts>({watching:0,ready:0,stale:0,expired:0,unavailable:0});
  const [recommendationsComplete,setRecommendationsComplete] = useState(false);
  const [counts, setCounts] = useState({ scanned: 0, eligible: 0, analyzed: 0, covered: 0, batchSize: 0, scanConcurrency: 0 });
  const [freshness, setFreshness] = useState({fresh:0,stale:0,failed:0,unchecked:0,oldest:null as number|null});
  const [scanTiming,setScanTiming] = useState({durationMs:0,priority:0});
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [marketCoverage, setMarketCoverage] = useState({ pages: 0, instruments: 0, percent: 0, complete: false });
  const [rejectionCounts, setRejectionCounts] = useState<RejectionCounts>();
  const [selectionDiagnostics,setSelectionDiagnostics] = useState<SelectionDiagnostics>();
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
      setWatchedScenarios(data.watchedScenarios ?? []);
      setWatchStatusCounts(data.watchStatusCounts ?? {watching:0,ready:0,stale:0,expired:0,unavailable:0});
      setRecommendationsComplete(data.recommended24hComplete === true);
      setCounts({ scanned: data.scanned ?? 0, eligible: data.eligible ?? 0, analyzed: data.analyzed ?? 0, covered: data.covered ?? 0, batchSize: data.batchSize ?? 0, scanConcurrency: data.scanConcurrency ?? 0 });
      setFreshness({fresh:data.freshChecked ?? 0,stale:data.staleChecked ?? 0,failed:data.failedChecked ?? 0,unchecked:data.unchecked ?? 0,oldest:data.oldestCheckedAgeSeconds ?? null});
      setScanTiming({durationMs:data.batchDurationMs??0,priority:data.priorityRechecked??0});
      setUpdatedAt(data.generatedAt); setRejectionCounts(data.rejectionCounts);setSelectionDiagnostics(data.selectionDiagnostics); setError(undefined);
      setMarketCoverage({ pages: data.universePages ?? 0, instruments: data.universeInstruments ?? 0,
        percent: data.coveragePercent ?? 0, complete: data.cycleCompleted ?? false });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Помилка сканування."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);

  // The strict, separately checked server shortlist is the ONLY "Top" group.
  // Other market analyses are observable but never presented as approved entries.
  const topSymbols = new Set(recommended24h.map(p=>p.symbol));
  const unconfirmedPlans = plans.filter(p=>!topSymbols.has(p.symbol))
    .sort(comparePlanPriority);
  const featuredCount = recommended24h.length;
  // Research-only shortlist, not an approved order queue. Drawn from current
  // cached plans; a 7/8 score never bypasses the strict TOP gate.
  const nearReady = plans.filter(p=>p.status==="REVIEW"&&
    p.readiness?.met===7&&p.readiness?.total===8&&p.score>=85&&
    !topSymbols.has(p.symbol)).sort(comparePlanPriority).slice(0,10);
  const groups = showWaiting ? [{
    key: "observing", title: "Досліджені пари · не готові до входу",
    items: unconfirmedPlans,
  }] : [];

  const openPlan = (plan: TradePlan) => {
    localStorage.setItem("alpha-pulse-plan-v1", JSON.stringify(plan));
    router.push(`/analysis/${plan.symbol}`);
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
          <span>Партія <strong className="font-semibold text-slate-200">{counts.analyzed}</strong> · потоків {counts.scanConcurrency}</span>
          <span title="Фактична тривалість останнього пакета; пріоритетні перевірки не замінюють обхід">Час пакета <strong className="text-slate-200">{(scanTiming.durationMs/1000).toFixed(1)} с</strong> · пріоритетних {scanTiming.priority}</span>
          <span title="Успішна перевірка в межах 4 хвилин; охоплення обходу не дорівнює свіжості">Свіжі <strong className="font-semibold text-emerald-300">{freshness.fresh}</strong> · застарілі {freshness.stale} · помилки {freshness.failed} · не перевірені {freshness.unchecked}</span>
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
        {selectionDiagnostics && <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>Аналізів у пам’яті: <strong className="text-slate-200">{selectionDiagnostics.availablePlans}</strong></span>
          <span>Технічно ACTIVE: <strong className="text-slate-200">{selectionDiagnostics.technicalActive}</strong></span>
          <span>Фільтр якості: <strong className="text-slate-200">{selectionDiagnostics.qualityPassed}</strong></span>
          <span>Підтверджені Entry/TP: <strong className="text-slate-200">{selectionDiagnostics.structuralEntryAndTarget}</strong></span>
          <span>24h Limit: <strong className="text-cyan-200">{selectionDiagnostics.eligible24h}</strong></span>
        </div>}
        {selectionDiagnostics && selectionDiagnostics.activeQualityFailures > 0 && <details className="mb-3 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300">
          <summary className="cursor-pointer font-medium text-amber-200">
            Чому {selectionDiagnostics.activeQualityFailures} ACTIVE-сценаріїв не пройшли фільтр якості
          </summary>
          <p className="mt-2 text-slate-400">Це причини з фактичного аналізу збережених планів. Одна пара може порушувати кілька правил. Це не статистика всього ринку.</p>
          <div className="mt-2 space-y-1">
            {selectionDiagnostics.qualityFailures.map(item=><p key={item.reason}>{item.reason} — <strong>{item.count}</strong></p>)}
          </div>
          <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
            <p className="font-medium text-slate-200">Числові показники відхилених ACTIVE-сценаріїв</p>
            {selectionDiagnostics.activeExamples.map(item=><div key={item.symbol} className="rounded-md bg-slate-950/60 px-3 py-2">
              <p className="font-semibold text-slate-100">{item.symbol}</p>
              <p className="mt-1 text-slate-400">Оцінка {item.score}/100 (мін. 90) · Готовність {item.readiness} (потрібно 8/8) · R:R 1:{item.rr.toFixed(2)} (мін. 1:2) · Відстань {item.distanceAtr==null?"—":item.distanceAtr.toFixed(2)+" ATR"} (макс. 0,75 ATR) · Stop {item.stopAtr==null?"—":item.stopAtr.toFixed(2)+" ATR"}</p>
              <p className="mt-1 text-amber-200">{item.reasons.join("; ")}</p>
            </div>)}
          </div>
        </details>}
        {recommended24h.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {recommended24h.map((plan,index)=><button key={plan.id} type="button" onClick={()=>openPlan(plan)}
            className="rounded-lg border border-emerald-900/80 bg-slate-950/60 p-3 text-left transition hover:border-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm text-slate-100">{recommendationsComplete?`TOP ${index+1}`:`Кандидат ${index+1}`} · {plan.symbol}</strong>
              <span className={plan.direction==="LONG"?"text-xs text-emerald-300":"text-xs text-rose-300"}>{plan.direction}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
              <span>Limit <strong className="text-cyan-200">{price(plan.entryPrice)}</strong></span>
              <span>TP <strong className="text-emerald-300">{price(plan.takeProfit2)}</strong></span>
              <span>SL <strong className="text-rose-300">{price(plan.stopLoss)}</strong></span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span>Оцінка {plan.score}/100 · R:R 1:{plan.riskReward.toFixed(2)}</span>
              <span className="text-cyan-300">Повний аналіз ↗</span>
            </div>
          </button>)}
        </div> : <p className="text-sm text-slate-400">Поки немає кандидатів, що пройшли всі попередні умови. Це не означає, що ринок уже повністю перевірено.</p>}
      </section>
      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-amber-200">Майже готові · пріоритетна перевірка</h3>
          <span className="text-xs text-slate-400">7/8 · оцінка від 85 · максимум 10 із поточних збережених планів</span>
        </div>
        {nearReady.length?
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {nearReady.map(p=><button type="button" key={p.id} onClick={()=>openPlan(p)}
              className="rounded-lg border border-amber-900/50 bg-slate-950/50 p-3 text-left hover:border-amber-500">
              <div className="flex items-center justify-between gap-2"><strong className="text-sm">{p.symbol}</strong><span className={p.direction==="LONG"?"text-xs text-emerald-300":"text-xs text-rose-300"}>{p.direction}</span></div>
              <p className="mt-1 text-xs text-slate-300">Оцінка {p.score}/100 · готовність {p.readiness.met}/8 · R:R 1:{p.riskReward.toFixed(2)}</p>
              <p className="mt-2 line-clamp-2 text-xs text-amber-200">{p.readiness.missing[0]??"Очікується підтвердження"}</p>
              <p className="mt-2 text-[11px] text-slate-500">Тільки спостереження · Demo-заявка потребує 8/8 та всіх інших умов</p>
            </button>)}
          </div>:
          <p className="mt-2 text-xs text-slate-400">Серед поточних збережених планів немає сценаріїв 7/8 з оцінкою від 85. Сканування триває.</p>}
      </section>
      <p className="mb-3 text-xs text-amber-200">«Підтверджено» означає технічну готовність MTF, не доказ прибутковості. Дослідний фільтр якості показано окремо. До завершення обходу це не рейтинг усього ринку.</p>
      <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-100">Перспективні сценарії · очікуємо підтвердження</h3>
          <span className="text-xs text-slate-400">Спостереження {watchStatusCounts.watching} · Застарілі {watchStatusCounts.stale} · Перевірка недоступна {watchStatusCounts.unavailable}</span>
        </div>
        <p className="mb-3 text-xs text-slate-400">Це технічно розраховані ідеї, а не готові заявки. Після нових завершених свічок чи змін ціни правила перевіряються знову. Горизонт 24 години від першого аналізу; це не термін GTC-заявки.</p>
        {watchedScenarios.length===0?<p className="text-sm text-slate-400">Наразі немає свіжих сценаріїв очікування. Сканування триває; неповні дані не замінюються прогнозами.</p>:
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {watchedScenarios.map(s=><Link href={`/analysis/${s.symbol}`} key={s.symbol}
              className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 transition hover:border-cyan-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              <div className="flex items-center justify-between gap-2"><strong className="text-sm">{s.symbol}</strong>
                <span className={s.direction==="LONG"?"text-xs text-emerald-300":"text-xs text-rose-300"}>{s.direction}</span></div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
                <span>Limit <strong className="text-cyan-200">{price(s.entry)}</strong></span>
                <span>R:R 1:{s.rr.toFixed(2)}</span>
                <span>{s.confirmedConditions.length}/{s.confirmedConditions.length+s.pendingConditions.length} умов</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-amber-200">Очікуємо: {s.pendingConditions.slice(0,2).join("; ")}</p>
              <p className="mt-2 text-[11px] text-slate-400">До {new Intl.DateTimeFormat("uk-UA",{timeZone:"Europe/Ljubljana",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(s.validUntil)} · Любляна</p>
              <p className="mt-1 text-[11px] text-cyan-300">Відкрити повний аналіз ↗</p>
            </Link>)}
          </div>}
      </section>
      {featuredCount === 0 && <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-6 text-sm text-slate-300">
        <p className="font-semibold text-slate-100">Поки немає сценаріїв, що пройшли суворий 24h Limit-відбір.</p>
        <p className="mt-1 text-slate-400">Непідтверджені результати доступні в розділі «Спостереження». Ринок продовжує скануватися; суворі пороги не знижуються заради заповнення TOP.</p>
        {rejectionCounts && <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-400">Чому пари не пройшли відбір</summary>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {rejectionLabels.filter(([key]) => rejectionCounts[key] > 0).map(([key, label]) =>
              <span key={key}>{label}: <strong className="text-slate-200">{rejectionCounts[key]}</strong></span>)}
          </div>
        </details>}
      </section>}
      {groups.filter(group=>group.items.length>0).map(group=><section key={group.key} className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">{group.title}</h3>
          <span className="text-xs text-slate-500">{group.items.length}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {group.items.map(plan=><button type="button" key={plan.id} onClick={()=>openPlan(plan)}
            className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-left transition hover:border-cyan-600 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm text-slate-100">{plan.symbol}</strong>
              <span className={plan.direction==="LONG"?"text-xs text-emerald-300":"text-xs text-rose-300"}>{plan.direction}</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-300">Спостереження · не готово до заявки</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="text-slate-300">Limit <strong className="text-cyan-200">{price(plan.entryPrice)}</strong></span>
              <span className="text-slate-400">R:R 1:{plan.riskReward.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex justify-between gap-2 text-[11px] text-slate-400">
              <span>Оцінка {plan.score}/100 · Умови {plan.readiness?.met??0}/{plan.readiness?.total??8}</span>
              <span className="text-cyan-300">Деталі ↗</span>
            </div>
          </button>)}
        </div>
      </section>)}
    </section>}
  </main>;
}

