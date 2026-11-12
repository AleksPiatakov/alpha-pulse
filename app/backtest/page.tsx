"use client";

import Link from "next/link";
import { useState } from "react";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"] as const;
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
  fixedComparison?: boolean; comparisonCutoff?: number; tickSize?: number | null; roundingMode?: string;
  snapshotSha256?: string | null; snapshotCapturedAt?: string | null; snapshotStorage?: string;
  trades?: unknown[];
};
type VariantStats = {
  key: string; label: string; signals: number; filled: number;
  totalNetR: number; averageNetR: number | null; winRate: number | null;
  maxDrawdownR: number; periods: PeriodStats[]; trades?: unknown[];
};
type FactorResult = { key: string; label: string; signals: number; unfilled: number;
  filled: number; totalNetR: number; averageNetR: number | null; winRate: number | null;
  maxDrawdownR: number; trades: unknown[]; assumptions: string[] };
type ExperimentResult = TestResult & {
  experiments?: VariantStats[]; conservativeExperiments?: VariantStats[];
  executionAttribution?: FactorResult[];
};
type ResultMap = Partial<Record<SymbolName, TestResult>>;

const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "—" : value.toFixed(digits);
const date = (value: number | null | undefined) =>
  value == null ? "—" : new Date(value).toLocaleDateString("uk-UA");

export default function BacktestComparisonPage() {
  const [results, setResults] = useState<ResultMap>({});
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<SymbolName | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const [experimentResults, setExperimentResults] = useState<Partial<Record<SymbolName, ExperimentResult>>>({});

  function toggleDetails() {
    const expanded = !allExpanded;
    document.querySelectorAll<HTMLDetailsElement>("[data-backtest-details]").forEach((detail) => {
      detail.open = expanded;
    });
    setAllExpanded(expanded);
  }

  function exportJson() {
    const completed = SYMBOLS.filter((symbol) => results[symbol]?.success);
    if (!completed.length) return;
    // Only public-market research results. No account data, credentials or API keys.
    const payload = {
      kind: "alpha-pulse-backtest",
      version: 5,
      exportedAt: new Date().toISOString(),
      symbols: [...SYMBOLS],
      timeframe: ["30m", "1h", "4h", "1D"],
      comparisonEnd: "2026-11-12T00:00:00.000Z",
      roundingMode: "bybit-tick-size",
      exportCompleteness: "full-baseline-and-variant-trade-journals",
      candleSnapshotHashes: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, results[symbol]?.snapshotSha256 ?? null])),
      snapshotStorage: "local-immutable-file",
      conservativeModel: { entryPenetrationTicks: 1, feePerSide: 0.00075, stopSlippageBps: 10, timeoutSlippageBps: 5 },
      note: "Дослідницький close-only тест з фіксованим кінцем історії та біржовим tickSize. Робочий Demo-сканер не використовує цю саму цінову модель; це не незалежне підтвердження прибутковості.",
      results: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, results[symbol] ?? null])),
      experiments: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, experimentResults[symbol]?.experiments ?? null])),
      conservativeExperiments: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, experimentResults[symbol]?.conservativeExperiments ?? null])),
      executionAttribution: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, experimentResults[symbol]?.executionAttribution ?? null])),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "alpha-pulse-backtest-results.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

    async function runFullAnalysis() {
    if (busy) return;
    setBusy(true);
    setResults({});
    setExperimentResults({});
    try {
      // One API call per symbol supplies baseline diagnostics AND all experiment variants.
      // Sequential execution protects the Bybit kline endpoint from a request burst.
      for (const symbol of SYMBOLS) {
        setCurrent(symbol);
        try {
          const response = await fetch(`/api/backtest?symbol=${symbol}&experiment=1&fixed=1&ticks=1&snapshot=auto`, { cache: "no-store" });
          const data = await response.json() as ExperimentResult;
          if (!response.ok || !data.success) {
            const failed = { success: false, error: data.error || "Тест недоступний." };
            setResults((old) => ({ ...old, [symbol]: failed }));
            setExperimentResults((old) => ({ ...old, [symbol]: failed }));
          } else {
            setResults((old) => ({ ...old, [symbol]: data }));
            setExperimentResults((old) => ({ ...old, [symbol]: data }));
          }
        } catch {
          const failed = { success: false, error: "Немає зв'язку з локальним сервером." };
          setResults((old) => ({ ...old, [symbol]: failed }));
          setExperimentResults((old) => ({ ...old, [symbol]: failed }));
        }
      }
    } finally {
      setBusy(false);
      setCurrent(null);
    }
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-semibold text-emerald-400 hover:text-emerald-300">← Сканер</Link>
          <h1 className="text-xl font-bold">Порівняння історичних тестів</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleDetails}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500">
            {allExpanded ? "Згорнути все" : "Розгорнути все"}
          </button>
          <button type="button" onClick={exportJson}
            disabled={!SYMBOLS.some((symbol) => results[symbol]?.success)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-40">
            Експорт JSON
          </button>
          <button type="button" disabled={busy} onClick={() => void runFullAnalysis()}
            className="rounded-lg border border-emerald-500/60 bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">
            {busy ? `Аналіз ${current ?? ""}…` : "Запустити повний аналіз"}
          </button>
        </div>
      </header>
      <p className="mb-5 text-xs text-slate-400">
        8 пар Bybit · 30m / 1h / 4h / 1D · кінець історії: 12.11.2026, 00:00 UTC · округлення за tickSize.
        Результати — історична модель, не прогноз прибутку. Кожна пара перевіряється окремо.
        Перший запуск зберігає свічки локально; наступні запуски використовують ті самі файли. Тепер кожен фактор стрес-тесту перевіряється окремо, а також усі фактори разом (1 tick проникнення, 0,075% комісії на бік, проскальзування Stop Loss 10 bps). Повні журнали обох моделей включено в JSON. Це дослідницька вибірка, не незалежний holdout.
      </p>
      <p className="mb-3 text-xs text-amber-200">Важливо: історичний тест використовує ціну закриття 30m, а робочий сканер — поточний тікер; 24h показники й спосіб округлення у сканері відрізняються. TickSize з Bybit застосовано лише в дослідницькому тесті, не в Demo-заявках.</p>
      <div className="mb-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <p className="mb-2 text-sm font-semibold">Стрес-тест виконання заявок (гіпотетична модель)</p>
        <table className="w-full min-w-[600px] text-left text-xs">
          <thead><tr className="text-slate-400"><th className="pb-2">Пара</th><th>Базові угоди</th><th>Базова сума R</th><th>Консервативні угоди</th><th>Консервативна сума R</th></tr></thead>
          <tbody>{SYMBOLS.map((symbol) => {
            const base = experimentResults[symbol]?.experiments?.find((item) => item.key === "baseline");
            const conservative = experimentResults[symbol]?.conservativeExperiments?.find((item) => item.key === "baseline");
            return <tr key={symbol} className="border-t border-slate-800"><td className="py-2">{symbol}</td>
              <td>{base?.filled ?? "—"}</td><td>{number(base?.totalNetR)}</td>
              <td>{conservative?.filled ?? "—"}</td>
              <td className={(conservative?.totalNetR ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{number(conservative?.totalNetR)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="mb-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <p className="mb-2 text-sm font-semibold">Вплив окремих факторів виконання</p>
        <p className="mb-3 text-xs text-slate-400">Результат кожної моделі перераховано на тих самих свічках. Різниця з базою не обовʼязково адитивна: зміна Limit-входу може змінити й наступні сигнали.</p>
        <table className="w-full min-w-[770px] text-left text-xs">
          <thead className="text-slate-400"><tr>
            <th className="pb-2">Пара</th>
            <th>Базова R</th><th>Лише комісії R</th><th>Лише прослизання R</th>
            <th>Лише Limit R</th><th>Разом R</th>
          </tr></thead>
          <tbody>{SYMBOLS.map((symbol) => {
            const cases = experimentResults[symbol]?.executionAttribution;
            const value = (key: string) => cases?.find((item) => item.key === key)?.totalNetR;
            return <tr key={symbol} className="border-t border-slate-800">
              <td className="py-2 font-semibold">{symbol}</td>
              {(["reference", "fees-only", "slippage-only", "fill-only", "conservative"] as const).map((key) => (
                <td key={key} className={(value(key) ?? 0) < 0 ? "text-rose-300" : "text-emerald-300"}>{number(value(key))}</td>
              ))}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="mb-3 text-xs text-slate-400">Для передачі результатів у ChatGPT натисни «Експорт JSON» і прикріпи отриманий файл до чату — скриншоти не потрібні. Свічки зберігаються лише локально у .alpha-pulse-backtest-snapshots/ (не завантажуються в GitHub).</p>
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
          {!!result.diagnostics?.length && <details data-backtest-details className="mt-3 rounded-lg border border-slate-800 p-3 text-xs">
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
        if (!value && current !== symbol) return null;
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
