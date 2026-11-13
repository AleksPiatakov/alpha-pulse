"use client";

import Link from "next/link";
import { useState } from "react";
import { assessLabRuns, LAB_CANDIDATES, type LabRun } from "@/lib/strategy-lab";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"] as const;
type SymbolName = typeof SYMBOLS[number];
type Result = {
  success: boolean; symbol?: string; error?: string; partialHistory?: boolean;
  fixedComparison?: boolean; snapshotSha256?: string | null;
  experiments?: LabRun[]; conservativeExperiments?: LabRun[];
};
type ResearchRecord = {
  id: string; createdAt: string; cutoff: string; status: "research-only";
  snapshotHashes: Record<string, string>;
  comparisons: Array<{ key: string; normalR: number; stressR: number; trades: number }>;
};
const STORAGE_KEY = "alpha-pulse-strategy-lab-v1";
const cutoff = "2026-11-12T00:00:00.000Z";
const fmt = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export default function StrategyLabPage() {
  const [result, setResult] = useState<Partial<Record<SymbolName, Result>>>({});
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<SymbolName | null>(null);
  const [history, setHistory] = useState<ResearchRecord[]>([]);
  const [loadedHistory, setLoadedHistory] = useState(false);

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const value: unknown = raw ? JSON.parse(raw) : [];
      setHistory(Array.isArray(value) ? (value as ResearchRecord[]).slice(0, 15) : []);
      setLoadedHistory(true);
    } catch {
      setHistory([]);
      setLoadedHistory(true);
    }
  }
  function storeHistory(items: ResearchRecord[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 15)));
    setHistory(items.slice(0, 15));
  }
  async function runStudy() {
    if (running) return;
    setRunning(true);
    setResult({});
    const output: Partial<Record<SymbolName, Result>> = {};
    try {
      for (const symbol of SYMBOLS) {
        setCurrent(symbol);
        try {
          const response = await fetch(`/api/backtest?symbol=${symbol}&experiment=1&fixed=1&ticks=1&snapshot=auto`, { cache: "no-store" });
          const payload = await response.json() as Result;
          output[symbol] = response.ok ? payload : { success: false, error: payload.error ?? "Сервер повернув помилку." };
        } catch {
          output[symbol] = { success: false, error: "Немає з'єднання з локальним сервером." };
        }
        setResult({ ...output });
      }
      // Fail closed: partial/missing histories must never enter the experiment registry.
      if (SYMBOLS.every((symbol) => output[symbol]?.success &&
        output[symbol]?.fixedComparison && !output[symbol]?.partialHistory &&
        output[symbol]?.snapshotSha256 &&
        output[symbol]?.experiments?.length === LAB_CANDIDATES.length &&
        output[symbol]?.conservativeExperiments?.length === LAB_CANDIDATES.length)) {
        const record: ResearchRecord = {
          id: `lab-${Date.now()}`, createdAt: new Date().toISOString(),
          cutoff, status: "research-only",
          snapshotHashes: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, output[symbol]!.snapshotSha256! ])),
          comparisons: LAB_CANDIDATES.map((candidate) => {
            const normal = SYMBOLS.map((symbol) => output[symbol]!.experiments!.find((run) => run.key === candidate.key)!);
            const stress = SYMBOLS.map((symbol) => output[symbol]!.conservativeExperiments!.find((run) => run.key === candidate.key)!);
            return { key: candidate.key,
              normalR: Number(normal.reduce((sum, run) => sum + run.totalNetR, 0).toFixed(3)),
              stressR: Number(stress.reduce((sum, run) => sum + run.totalNetR, 0).toFixed(3)),
              trades: normal.reduce((sum, run) => sum + run.filled, 0) };
          }),
        };
        try {
          const previous: ResearchRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
          storeHistory([record, ...(Array.isArray(previous) ? previous : [])]);
        } catch {
          // Export remains possible even when browser local storage is unavailable.
        }
      }
    } finally {
      setCurrent(null);
      setRunning(false);
    }
  }
  function exportStudy() {
    if (!SYMBOLS.every((symbol) => result[symbol]?.success)) return;
    const payload = {
      kind: "alpha-pulse-strategy-lab", version: 1,
      generatedAt: new Date().toISOString(), cutoff,
      researchOnly: true, holdoutIndependent: false,
      candidates: LAB_CANDIDATES, symbols: SYMBOLS,
      data: result, note: "R summed across symbols is descriptive, not a portfolio PnL. No strategy approved for real or demo execution.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "alpha-pulse-strategy-lab.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const complete = SYMBOLS.every((symbol) => result[symbol]?.success &&
    result[symbol]?.fixedComparison && result[symbol]?.snapshotSha256 && !result[symbol]?.partialHistory);
  const rows = LAB_CANDIDATES.map((candidate) => {
    const normal = SYMBOLS.map((symbol) => result[symbol]?.experiments?.find((x) => x.key === candidate.key)).filter((x): x is LabRun => !!x);
    const stress = SYMBOLS.map((symbol) => result[symbol]?.conservativeExperiments?.find((x) => x.key === candidate.key)).filter((x): x is LabRun => !!x);
    return {
      ...candidate,
      normal: normal.length === SYMBOLS.length ? assessLabRuns(normal) : null,
      stress: stress.length === SYMBOLS.length ? assessLabRuns(stress) : null,
    };
  });
  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-emerald-400 hover:text-emerald-300">← Сканер</Link>
          <h1 className="text-2xl font-bold">Strategy Lab</h1>
          <span className="rounded-md border border-amber-800 bg-amber-950/50 px-2 py-1 text-xs text-amber-200">Дослідження · без автоторгівлі</span>
        </div>
        <div className="flex gap-2">
          <Link href="/backtest" className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-slate-400">Детальні тести</Link>
          <Link href="/research-strategies" className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-200 hover:border-cyan-400">Нові стратегії · тестування</Link>
          <Link href="/ema50-study" className="rounded-lg border border-violet-700 px-3 py-2 text-sm text-violet-200 hover:border-violet-400">EMA 50 · тест із відео</Link>
          <button type="button" onClick={exportStudy} disabled={!complete}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm disabled:opacity-40">Експорт дослідження</button>
          <button type="button" disabled={running} onClick={() => void runStudy()}
            className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
            {running ? `Аналіз ${current ?? ""}…` : "Порівняти кандидатів"}
          </button>
        </div>
      </header>
      <p className="mb-4 max-w-4xl text-sm text-slate-400">
        Спільні збережені свічки Bybit, фіксований кінець {cutoff}, два режими витрат.
        Ціль — якість Entry / Stop Loss / Take Profit, а не кількість угод за день. A1–A3 і B — дослідні варіанти на основі MTF, а не незалежні підтверджені алгоритми.
        Результати цієї історії вже відомі, тому вони не є фінальною перевіркою прибутковості.
      </p>
      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {LAB_CANDIDATES.map((candidate) => <section key={candidate.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="font-semibold">{candidate.label}</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{candidate.description}</p>
          <p className="mt-3 text-[11px] uppercase tracking-wide text-amber-300">{candidate.state === "baseline" ? "Еталон" : "Гіпотеза"}</p>
        </section>)}
      </div>
      <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="mb-1 text-lg font-semibold">Порівняння стратегій</h2>
        <p className="mb-4 text-xs text-slate-400">Сума R по парах — не прибуток портфеля. Друга половина використана для діагностики, не є незалежним holdout.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-slate-700 text-xs text-slate-400">
              <tr><th className="py-3">Кандидат</th><th>Угод</th><th>Базовий R</th><th>Стрес R</th>
                <th>Середній R</th><th>Profit Factor</th><th>Stop %</th><th>Медіана утримання, год</th><th>Перша / друга половина R</th><th>Прибуткові пари</th></tr>
            </thead>
            <tbody>{rows.map((row) => <tr key={row.key} className="border-b border-slate-800">
              <td className="py-3 pr-3 font-semibold">{row.label}</td>
              <td>{row.normal?.trades ?? "—"}</td>
              <td className={(row.normal?.totalNetR ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{fmt(row.normal?.totalNetR)}</td>
              <td className={(row.stress?.totalNetR ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{fmt(row.stress?.totalNetR)}</td>
              <td>{fmt(row.normal?.meanR, 3)}</td>
              <td>{fmt(row.normal?.profitFactor)}</td>
              <td>{fmt(row.normal?.stopRate, 1)}</td>
              <td>{fmt(row.normal?.medianHoldHours, 1)}</td>
              <td>{fmt(row.normal?.firstHalfR)} / {fmt(row.normal?.secondHalfR)}</td>
              <td>{row.normal ? `${row.normal.profitableSymbols}/${row.normal.testedSymbols}` : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {complete && <p className="mt-3 text-xs text-amber-200">Жоден кандидат не схвалено для Demo чи реальної торгівлі: незалежний майбутній період і перевірка портфельного ризику ще потрібні. Кількість угод не є цільовим KPI.</p>}
        <p className="mt-2 text-xs text-slate-400">B · Intraday Quality: попередній фільтр якості (score ≥ 90, R:R ≥ 2, відстань ≤ 0,75 ATR, стоп 0,8–3 ATR). Ордер живе до 3 год, утримання до 24 год; це максимальні тривалості моделі, а не гарантія закриття в межах календарного дня.</p>
      </section>
      <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="mb-2 text-lg font-semibold">Дані й перевірка повноти</h2>
        <div className="grid gap-2 text-xs md:grid-cols-4">
          {SYMBOLS.map((symbol) => <div key={symbol} className="rounded-lg border border-slate-800 p-3">
            <p className="font-semibold">{symbol}</p>
            <p className="mt-1 text-slate-400">{result[symbol] ? result[symbol]?.success ? result[symbol]?.partialHistory ? "Часткова історія" : "Фіксований знімок" : result[symbol]?.error : "Ще не перевірено"}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{result[symbol]?.snapshotSha256?.slice(0, 16) ?? "—"}</p>
          </div>)}
        </div>
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Журнал досліджень</h2>
          {!loadedHistory && <button type="button" onClick={loadHistory} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Показати локальну історію</button>}
        </div>
        <p className="my-2 text-xs text-slate-400">Автоматично зберігається до 15 завершених досліджень у цьому браузері; у GitHub та Bybit нічого не надсилається. Для надійного архіву використовуй експорт.</p>
        {loadedHistory && (history.length
          ? <ul className="space-y-2">{history.map((record) => <li key={record.id} className="rounded-lg border border-slate-800 p-3 text-xs">
              {new Date(record.createdAt).toLocaleString("uk-UA")} · {record.status} · {Object.keys(record.snapshotHashes).length} знімків
            </li>)}</ul>
          : <p className="text-xs text-slate-500">Поки що збережених досліджень немає.</p>)}
      </section>
    </div>
  </main>;
}
