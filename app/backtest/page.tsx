"use client";

import Link from "next/link";
import { useState } from "react";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] as const;
type SymbolName = typeof SYMBOLS[number];
type PeriodStats = {
  label: string; from: number; to: number; trades: number; wins: number;
  winRate: number | null; totalNetR: number; averageNetR: number | null; maxDrawdownR: number;
};
type TestResult = {
  success: boolean; symbol?: string; signals?: number; unfilled?: number; filled?: number;
  wins?: number; winRate?: number | null; totalNetR?: number; averageNetR?: number | null;
  maxDrawdownR?: number; from?: number | null; to?: number | null;
  periods?: PeriodStats[]; diagnostics?: Array<{ label: string; trades: number; wins: number; winRate: number | null; averageNetR: number | null; totalNetR: number; maxDrawdownR: number }>;
  warnings?: string[]; partialHistory?: boolean; error?: string;
};
type VariantStats = {
  key: string; label: string; signals: number; filled: number;
  totalNetR: number; averageNetR: number | null; winRate: number | null;
  maxDrawdownR: number; periods: PeriodStats[];
};
type ExperimentResult = { success: boolean; experiments?: VariantStats[];
  partialHistory?: boolean; error?: string; warnings?: string[] };
type ResultMap = Partial<Record<SymbolName, TestResult>>;

const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "—" : value.toFixed(digits);
const date = (value: number | null | undefined) =>
  value == null ? "—" : new Date(value).toLocaleDateString("uk-UA");

export default function BacktestComparisonPage() {
  const [results, setResults] = useState<ResultMap>({});
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<SymbolName | null>(null);
  const [experimentResults, setExperimentResults] = useState<Partial<Record<SymbolName, ExperimentResult>>>({});
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [experimentCurrent, setExperimentCurrent] = useState<SymbolName | null>(null);

  async function runExperiment() {
    if (busy || experimentBusy) return;
    setExperimentBusy(true);
    setExperimentResults({});
    try {
      for (const symbol of SYMBOLS) {
        setExperimentCurrent(symbol);
        try {
          const response = await fetch(`/api/backtest?symbol=${symbol}&experiment=1`, { cache: "no-store" });
          const data = await response.json() as ExperimentResult;
          setExperimentResults((old) => ({ ...old, [symbol]:
            response.ok && data.success ? data : { success: false, error: data.error || "Експеримент недоступний." } }));
        } catch {
          setExperimentResults((old) => ({ ...old, [symbol]: { success: false, error: "Немає зв'язку з сервером." } }));
        }
      }
    } finally {
      setExperimentBusy(false);
      setExperimentCurrent(null);
    }
  }

  async function runComparison() {
    if (busy) return;
    setBusy(true);
    setResults({});
    try {
      // Sequential requests avoid a burst of Bybit pages and keep each failure isolated.
      for (const symbol of SYMBOLS) {
        setCurrent(symbol);
        try {
          const response = await fetch(`/api/backtest?symbol=${symbol}`, { cache: "no-store" });
          const data = await response.json() as TestResult;
          setResults((old) => ({ ...old, [symbol]:
            response.ok && data.success ? data : { success: false, error: data.error || "Тест недоступний." } }));
        } catch {
          setResults((old) => ({ ...old, [symbol]: { success: false, error: "Немає зв'язку з локальним сервером." } }));
        }
      }
    } finally {
      setCurrent(null);
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-semibold text-emerald-400 hover:text-emerald-300">← Сканер</Link>
          <h1 className="text-xl font-bold">Порівняння історичних тестів</h1>
        </div>
        <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || experimentBusy} onClick={() => void runComparison()}
          className="rounded-lg border border-emerald-500/60 bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">
          {busy ? `Перевіряється ${current ?? ""}…` : "Перевірити 4 пари Bybit"}
        </button>
        <button type="button" disabled={busy || experimentBusy} onClick={() => void runExperiment()}
          className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 disabled:opacity-60">
          {experimentBusy ? `Експеримент ${experimentCurrent ?? ""}…` : "Порівняти 3 гіпотези"}
        </button>
        </div>
      </header>
      <p className="mb-5 text-xs text-slate-400">
        BTC, ETH, SOL і BNB · 30m / 1h / 4h / 1D · однакові правила · тільки Bybit.
        Результати — історична модель, не прогноз прибутку. Кожна пара перевіряється окремо.
        Гіпотези — окремі повні симуляції; друга половина історії вже раніше переглядалася, тому не є незалежним holdout.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/70">
        <table className="w-full min-w-[790px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs text-slate-400">
            <tr><th className="p-3">Пара</th><th>Сигналів</th><th>Входів</th><th>Прибуткових</th>
              <th>Win rate</th><th>Середнє R</th><th>Сума R</th><th>Макс. просідання R</th><th>Період</th></tr>
          </thead>
          <tbody>
            {SYMBOLS.map((symbol) => {
              const result = results[symbol];
              return <tr key={symbol} className="border-b border-slate-800/70 last:border-0">
                <td className="p-3 font-semibold">{symbol}</td>
                {!result ? <td colSpan={8} className="py-3 text-slate-500">
                  {busy && current === symbol ? "Отримання історії…" : "Ще не перевірено"}
                </td> : !result.success ? <td colSpan={8} className="py-3 text-amber-300">{result.error}</td> : <>
                  <td>{result.signals}</td><td>{result.filled}</td><td>{result.wins}</td>
                  <td>{number(result.winRate, 1)}%</td>
                  <td className={(result.averageNetR ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{number(result.averageNetR, 3)}</td>
                  <td>{number(result.totalNetR, 2)}</td>
                  <td className="text-rose-300">{number(result.maxDrawdownR, 2)}</td>
                  <td className="text-xs text-slate-400">{date(result.from)} – {date(result.to)}</td>
                </>}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {SYMBOLS.map((symbol) => {
        const result = results[symbol];
        if (!result?.success) return null;
        return <section key={symbol} className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-2 flex items-center gap-3">
            <h2 className="font-semibold">{symbol}</h2>
            <span className="text-xs text-slate-400">Без входу: {result.unfilled}</span>
            {result.partialHistory && <span className="text-xs text-amber-300">Неповна історія</span>}
          </div>
          <div className="grid gap-3 text-xs md:grid-cols-2">
            {result.periods?.map((period) => <div key={period.label} className="rounded-lg border border-slate-800 p-3">
              <p className="mb-2 font-semibold">{period.label} · {date(period.from)} – {date(period.to)}</p>
              <p className="text-slate-300">Угод: {period.trades} · Прибуткових: {period.wins} · Win rate: {number(period.winRate, 1)}%</p>
              <p className="mt-1 text-slate-400">Середнє: {number(period.averageNetR, 3)} R · Сума: {number(period.totalNetR)} R · Просідання: {number(period.maxDrawdownR)} R</p>
            </div>)}
          </div>
          {!!result.diagnostics?.length && <details className="mt-3 rounded-lg border border-slate-800 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-200">Діагностика причин результатів · напрямок, обсяг, відстань, тренд</summary>
            <p className="my-2 text-slate-400">Групи сформовано з уже виконаних історичних угод. Це опис даних, а не підтверджені правила для майбутніх входів.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left">
              <thead className="text-slate-500"><tr><th className="py-2">Група</th><th>Угод</th><th>Win rate</th><th>Середнє R</th><th>Сума R</th><th>Просідання R</th></tr></thead>
              <tbody>{result.diagnostics.map((item) => <tr key={item.label} className="border-t border-slate-800">
                <td className="py-2">{item.label}</td><td>{item.trades}</td><td>{number(item.winRate, 1)}%</td>
                <td className={(item.averageNetR ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{number(item.averageNetR, 3)}</td>
                <td>{number(item.totalNetR)}</td><td>{number(item.maxDrawdownR)}</td>
              </tr>)}</tbody>
            </table></div>
          </details>}
          {!!result.warnings?.length && <p className="mt-3 text-xs text-amber-300">{result.warnings.join(" ")}</p>}
        </section>;
      })}
      {SYMBOLS.map((symbol) => {
        const value = experimentResults[symbol];
        if (!value && experimentCurrent !== symbol) return null;
        return <section key={symbol} className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="mb-2 font-semibold">{symbol} · Порівняння гіпотез</h2>
          {!value ? <p className="text-sm text-slate-400">Перерахунок усіх варіантів…</p>
            : !value.success ? <p className="text-sm text-amber-300">{value.error}</p> : <>
              <p className="mb-3 text-xs text-amber-200">Ретроспективний експеримент, не підтвердження прибутковості. Пороги вибрано після перегляду цієї історії.</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs">
                <thead className="text-slate-400"><tr>
                  <th className="pb-2">Варіант</th><th>Угод</th><th>Середнє R</th><th>Сума R</th><th>Просідання</th>
                  <th>Перша половина R</th><th>Друга половина R</th>
                </tr></thead>
                <tbody>{value.experiments?.map((item) => <tr key={item.key} className="border-t border-slate-800">
                  <td className="py-2 font-semibold">{item.label}</td>
                  <td>{item.filled}</td>
                  <td className={(item.averageNetR ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{number(item.averageNetR, 3)}</td>
                  <td>{number(item.totalNetR, 2)}</td>
                  <td>{number(item.maxDrawdownR, 2)}</td>
                  <td>{number(item.periods[0]?.totalNetR, 2)}</td>
                  <td>{number(item.periods[1]?.totalNetR, 2)}</td>
                </tr>)}</tbody>
              </table></div>
              {!!value.warnings?.length && <p className="mt-2 text-xs text-amber-300">{value.warnings.join(" ")}</p>}
            </>}
        </section>;
      })}
      <p className="mt-5 text-xs text-slate-500">Максимальне просідання в R — накопичений спад при постійному ризику на угоду, не відсоток від балансу. Модель враховує задані комісії, але не funding, спред і фактичну чергу виконання Limit.</p>
    </div>
  </main>;
}
