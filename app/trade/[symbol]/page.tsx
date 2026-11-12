"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TradePlan } from "@/lib/trading";
import { calculatePosition, defaultRiskSettings, normalizeRiskSettings, RISK_SETTINGS_KEY, type RiskSettings } from "@/lib/risk-settings";
import { TradingChart } from "@/app/components/TradingChart";

type AccountSnapshot = { balance: number; activeCount: number; source: string };
type ScanResponse = { success?: boolean; plans?: TradePlan[]; error?: string };
const price = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
const money = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
function storedSettings() { try { return normalizeRiskSettings(JSON.parse(localStorage.getItem(RISK_SETTINGS_KEY) || "null")); } catch { return defaultRiskSettings; } }

function TradePageContent() {
  const params = useParams();
  const router = useRouter();
  const symbol = String(params.symbol ?? "").toUpperCase();
  const [plan, setPlan] = useState<TradePlan | null>(null);
  const [ready, setReady] = useState(false);
  const [analysisState, setAnalysisState] = useState<"current" | "not-recommended" | "unavailable">("current");
  const [settings] = useState<RiskSettings>(storedSettings);
  const [account, setAccount] = useState<AccountSnapshot>();
  const [accountError, setAccountError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem("alpha-pulse-plan-v1");
        const storedPlan = raw ? JSON.parse(raw) as TradePlan : null;
        setPlan(storedPlan?.symbol === symbol ? storedPlan : null);
      } catch { setPlan(null); }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(initial);
  }, [symbol]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        const data = await response.json() as { success?: boolean; balance?: number; activeCount?: number; source?: string; error?: string };
        if (!response.ok || !data.success) throw new Error(data.error || "Demo-баланс недоступний.");
        if (active) { setAccount({ balance: data.balance ?? 0, activeCount: data.activeCount ?? 0, source: data.source ?? "bybit-demo" }); setAccountError(undefined); }
      } catch (caught) { if (active) setAccountError(caught instanceof Error ? caught.message : "Demo-баланс недоступний."); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const reassess = async () => {
      try {
        const response = await fetch("/api/scan", { cache: "no-store" });
        const data = await response.json() as ScanResponse;
        if (!response.ok || !data.success) throw new Error(data.error || "Не вдалося переоцінити план.");
        const freshPlan = data.plans?.find((candidate) => candidate.symbol === symbol);
        if (!active) return;
        if (!freshPlan) { setAnalysisState("not-recommended"); return; }
        setPlan(freshPlan); localStorage.setItem("alpha-pulse-plan-v1", JSON.stringify(freshPlan)); setAnalysisState("current");
      } catch { if (active) setAnalysisState("unavailable"); }
    };
    void reassess();
    const interval = window.setInterval(() => void reassess(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [symbol]);

  const balance = account?.balance && account.balance > 0 ? account.balance : settings.fallbackBalance;
  const sizing = useMemo(() => !plan ? undefined : calculatePosition({ balance, activeCount: account?.activeCount ?? 0, settings, entryPrice: plan.entryPrice, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit2 }), [account?.activeCount, balance, plan, settings]);

  async function placeOrder() {
    if (!plan || !sizing?.canOpen || analysisState !== "current") return;
    setBusy(true); setMessage(undefined);
    try {
      const response = await fetch("/api/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id, symbol: plan.symbol, side: plan.direction === "LONG" ? "Buy" : "Sell", qty: Number(sizing.quantity.toFixed(8)), entryPrice: plan.entryPrice, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit2 }) });
      const data = await response.json() as { success?: boolean; error?: string; data?: { orderId: string } };
      if (!response.ok || !data.success) throw new Error(data.error || "Не вдалося поставити заявку.");
      setMessage(`Demo Limit-заявку поставлено. Bybit order ID: ${data.data?.orderId ?? "отримано"}`);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Невідома помилка."); }
    finally { setBusy(false); }
  }

  if (!ready) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100">Завантаження торгового плану…</main>;
  if (!plan) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><button className="text-emerald-400" onClick={() => router.push("/")}>← До сканера</button><p className="mt-8 rounded-lg border border-amber-800 bg-amber-950/40 p-4">План не знайдено або він застарів. Поверніться до сканера й відкрийте актуальний setup.</p></main>;

  const isLong = plan.direction === "LONG";
  const statusText = analysisState === "current" ? "Автоаналіз · 30 с" : analysisState === "not-recommended" ? "План неактуальний" : "Автоаналіз недоступний";
  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-7">
    <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2"><button className="text-sm font-semibold text-emerald-400" onClick={() => router.push("/")}>← Сканер</button><h1 className="text-xl font-black">{plan.symbol} <span className={isLong ? "text-emerald-400" : "text-rose-400"}>· {plan.direction}</span></h1><span className="text-xs text-slate-500">score {plan.score}/100 · до {new Date(plan.expiresAt).toLocaleTimeString()}</span><Link href="/orders" className="ml-auto rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold hover:border-cyan-400">Активні заявки</Link><Link href="/settings" className=" rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold hover:border-cyan-400">Ризик і позиції</Link></header>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section><TradingChart plan={plan} /></section>
      <aside className="xl:sticky xl:top-5">
        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
          <div className="border-b border-slate-800 px-5 py-4"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">План і заявка</h2><span className={`rounded px-2 py-1 text-[10px] font-bold ${analysisState === "current" ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-200"}`}>{statusText}</span></div></div>
          <div className="space-y-5 p-5">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm"><Value label="Limit-вхід" value={price(plan.entryPrice)} color="text-cyan-300" /><Value label="Зона" value={`${price(plan.entryLow)}–${price(plan.entryHigh)}`} /><Value label="Stop-loss" value={price(plan.stopLoss)} color="text-rose-300" /><Value label="Take-profit" value={price(plan.takeProfit2)} color="text-emerald-300" /><Value label="Risk / Reward" value={`1:${plan.riskReward}`} /><Value label="Поточна ціна" value={price(plan.currentPrice)} /></dl>
            <p className={`rounded-lg px-3 py-2 text-xs ${analysisState === "current" ? "bg-emerald-950/40 text-emerald-100" : "bg-amber-950/40 text-amber-100"}`}>{analysisState === "current" ? "Рівні та розрахунок оновлюються автоматично." : analysisState === "not-recommended" ? "Пара випала з актуального відбору. Постановку заблоковано." : "Неможливо підтвердити актуальність плану. Постановку заблоковано."}</p>
            <div className="grid grid-cols-2 gap-3 border-y border-slate-800 py-4 text-sm"><Stat label="Ризик" value={money(sizing?.allowedRisk ?? 0)} accent="text-rose-300" /><Stat label="Обсяг" value={(sizing?.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 5 })} /><Stat label="Номінал" value={money(sizing?.notional ?? 0)} accent="text-cyan-300" /><Stat label="Вільні слоти" value={`${sizing?.slotsRemaining ?? 0}/${settings.maxPositions}`} /></div>
            <details className="group rounded-lg bg-slate-950/70 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-300">Логіка та умова скасування</summary><div className="mt-3 space-y-3"><div className="flex flex-wrap gap-1.5">{plan.reasons.map((reason) => <span key={reason} className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300">{reason}</span>)}</div><p className="text-xs leading-relaxed text-amber-100">Скасувати: {plan.invalidation}</p></div></details>
            {accountError && <p className="text-xs text-amber-200">Bybit: {accountError}</p>}
            {!sizing?.canOpen && <p className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-100">Досягнуто ліміту позицій або сумарного ризику.</p>}
            <p className="text-xs leading-relaxed text-slate-500">GTC Limit на {price(plan.entryPrice)} · не виконується по Market.</p>
            <button disabled={busy || !sizing?.canOpen || analysisState !== "current"} onClick={() => void placeOrder()} className={`w-full rounded-lg px-4 py-3 font-bold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-50 ${isLong ? "bg-emerald-500 hover:bg-emerald-400" : "bg-rose-500 hover:bg-rose-400"}`}>{busy ? "Постановка…" : `Поставити ${plan.direction} Demo Limit`}</button>
            {message && <p className="rounded-lg border border-slate-700 p-3 text-sm">{message}</p>}
          </div>
        </section>
      </aside>
    </div>
  </main>;
}

function Value({ label, value, color = "text-slate-100" }: { label: string; value: string; color?: string }) { return <div><dt className="text-[11px] text-slate-500">{label}</dt><dd className={`mt-1 break-words font-semibold ${color}`}>{value}</dd></div>; }
function Stat({ label, value, accent = "text-slate-100" }: { label: string; value: string; accent?: string }) { return <div><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 break-words font-bold ${accent}`}>{value}</p></div>; }
export default function TradePage() { return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-8 text-slate-100">Завантаження торгового плану…</main>}><TradePageContent /></Suspense>; }
