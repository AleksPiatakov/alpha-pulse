"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { defaultRiskSettings, normalizeRiskSettings, RISK_SETTINGS_KEY, type RiskSettings } from "@/lib/risk-settings";

type AccountSnapshot = { balance: number; activeCount: number; source: string };
const money = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
function storedSettings() { try { return normalizeRiskSettings(JSON.parse(localStorage.getItem(RISK_SETTINGS_KEY) || "null")); } catch { return defaultRiskSettings; } }

export default function SettingsPage() {
  const [settings, setSettings] = useState<RiskSettings>(storedSettings);
  const [account, setAccount] = useState<AccountSnapshot>();
  const [accountError, setAccountError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const loadBalance = useCallback(async () => {
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      const data = await response.json() as { success?: boolean; balance?: number; activeCount?: number; source?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "Баланс недоступний.");
      setAccount({ balance: data.balance ?? 0, activeCount: data.activeCount ?? 0, source: data.source ?? "bybit-demo" }); setAccountError(undefined);
    } catch (caught) { setAccountError(caught instanceof Error ? caught.message : "Баланс недоступний."); }
  }, []);
  useEffect(() => { const initial = window.setTimeout(() => void loadBalance(), 0); return () => window.clearTimeout(initial); }, [loadBalance]);
  const update = (key: keyof RiskSettings, value: string) => { setSaved(false); setSettings((current) => ({ ...current, [key]: Number(value) })); };
  const save = () => { const normalized = normalizeRiskSettings(settings); setSettings(normalized); localStorage.setItem(RISK_SETTINGS_KEY, JSON.stringify(normalized)); setSaved(true); };
  const shownBalance = account?.balance && account.balance > 0 ? account.balance : settings.fallbackBalance;
  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-8"><div className="mx-auto max-w-4xl"><header className="mb-6 flex items-center justify-between gap-4"><div><p className="text-xs font-bold tracking-[.18em] text-amber-300">DEMO · РИЗИК-МЕНЕДЖМЕНТ</p><h1 className="mt-1 text-3xl font-black">Налаштування позиції</h1><p className="mt-2 text-sm text-slate-400">Єдині ліміти для всіх торгових планів.</p></div><Link href="/" className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:border-emerald-400">← До сканера</Link></header><section className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="rounded-2xl border border-slate-700 bg-slate-900 p-5"><h2 className="text-xl font-bold">Ліміти ризику</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Ризик на одну угоду, %" value={settings.riskPercent} step="0.1" onChange={(value) => update("riskPercent", value)} /><Field label="Макс. одночасних позицій" value={settings.maxPositions} step="1" onChange={(value) => update("maxPositions", value)} /><Field label="Макс. сумарний ризик, %" value={settings.maxTotalRiskPercent} step="0.1" onChange={(value) => update("maxTotalRiskPercent", value)} /><Field label="Резервний баланс, USDT" value={settings.fallbackBalance} step="1" onChange={(value) => update("fallbackBalance", value)} /></div><p className="mt-5 rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-sm text-amber-100">Розмір позиції визначається відстанню від Limit-входу до stop-loss. Сумарний ліміт резервує ризик для вже активних Demo-позицій.</p><button onClick={save} className="mt-5 rounded-lg bg-emerald-400 px-5 py-3 font-bold text-slate-950">Зберегти налаштування</button>{saved && <span className="ml-3 text-sm text-emerald-300">Збережено</span>}</div><aside className="h-fit rounded-2xl border border-cyan-900 bg-slate-900 p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">Demo Bybit</h2><p className="mt-1 text-xs text-slate-400">Баланс та зайняті слоти</p></div><button onClick={() => void loadBalance()} className="text-xs font-bold text-cyan-300 hover:text-cyan-100">Оновити</button></div><p className="mt-5 text-3xl font-black text-cyan-300">{money(shownBalance)}</p><p className="mt-1 text-xs text-slate-500">{account?.balance ? "Підтягнуто з Bybit Demo" : "Використано резервний баланс"}</p><dl className="mt-5 space-y-3 rounded-lg bg-slate-950 p-4 text-sm"><div className="flex justify-between"><dt className="text-slate-400">Ризик на план</dt><dd>{money(shownBalance * settings.riskPercent / 100)}</dd></div><div className="flex justify-between"><dt className="text-slate-400">Зайнято слотів</dt><dd>{account?.activeCount ?? "—"} / {settings.maxPositions}</dd></div><div className="flex justify-between"><dt className="text-slate-400">Сумарний ліміт</dt><dd>{money(shownBalance * settings.maxTotalRiskPercent / 100)}</dd></div></dl>{accountError && <p className="mt-4 text-xs text-amber-200">Bybit Demo недоступний: {accountError}</p>}</aside></section></div></main>;
}

function Field({ label, value, step, onChange }: { label: string; value: number; step: string; onChange: (value: string) => void }) { return <label className="block text-sm text-slate-300">{label}<input type="number" min="0" step={step} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-lg text-white" /></label>; }
