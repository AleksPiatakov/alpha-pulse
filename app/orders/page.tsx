"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { reviewPendingOrder, PENDING_ORDER_STATUSES } from "@/lib/demo-order-review";

type Order = {
  orderId: string;
  symbol: string;
  side: "Buy" | "Sell";
  price: string;
  qty: string;
  orderStatus: string;
  stopLoss?: string;
  takeProfit?: string;
  createdTime?: string;
  timeInForce?: string;
  orderType?: string;
};


export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [observedAt, setObservedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/trade", { cache: "no-store" });
      const data = await response.json() as { success?: boolean; list?: Order[]; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "Не вдалося отримати заявки.");
      setOrders((data.list ?? []).filter((order) => PENDING_ORDER_STATUSES.has(order.orderStatus)));
      setObservedAt(Date.now());
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Помилка завантаження.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  const cancel = async (order: Order) => {
    if (!window.confirm(`Скасувати Demo-заявку ${order.symbol}?`)) return;
    const response = await fetch("/api/trade", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: order.symbol, orderId: order.orderId }) });
    if (!response.ok) setError("Не вдалося скасувати заявку.");
    await load();
  };

  const reviewCount = orders.filter((order) => reviewPendingOrder(order, observedAt).status === "review").length;
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100 md:p-8"><header className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold tracking-[.18em] text-amber-300">DEMO · КОНТРОЛЬ ЗАЯВОК</p><h1 className="mt-1 text-2xl font-black">Активні заявки</h1></div><Link href="/" className="rounded-lg border border-slate-700 px-3 py-2 text-sm">← Сканер</Link></header><p className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200">Заявки GTC не закінчуються разом із сигналом. Позначка «Перевірити» означає лише вік заявки понад 2 години за часом Bybit, а не автоматичну команду скасування. {reviewCount > 0 ? `Потребують уваги: ${reviewCount}.` : ""}</p>{error && <p className="mb-4 rounded bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}<section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900"><div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-sm"><span>{loading ? "Завантаження…" : `${orders.length} активних Demo-заявок`}</span><button onClick={() => void load()} className="text-cyan-300">Оновити</button></div>{!loading && orders.length === 0 ? <p className="p-8 text-center text-slate-400">Активних Demo-заявок немає.</p> : <div className="divide-y divide-slate-800">{orders.map((order) => <article key={order.orderId} className="flex flex-wrap items-center gap-4 p-4 text-sm"><b>{order.symbol}</b><span className={order.side === "Buy" ? "text-emerald-300" : "text-rose-300"}>{order.side === "Buy" ? "LONG" : "SHORT"}</span><span>Limit {order.price}</span><span>Qty {order.qty}</span><span className="text-slate-400">SL {order.stopLoss || "—"} · TP {order.takeProfit || "—"}</span>
            <div className="min-w-[180px] text-xs">
              <span className={reviewPendingOrder(order, observedAt).status === "review" ? "font-semibold text-amber-300" : "text-slate-400"}>
                {reviewPendingOrder(order, observedAt).status === "review" ? "Перевірити заявку" :
                 reviewPendingOrder(order, observedAt).status === "unknown" ? "Час створення невідомий" : "Нещодавня заявка"}
              </span>
              <p className="mt-1 text-slate-400">Статус: {order.orderStatus} · {order.timeInForce ?? "TIF невідомий"}
                {reviewPendingOrder(order, observedAt).ageMinutes !== null ? ` · ${reviewPendingOrder(order, observedAt).ageMinutes} хв` : ""}
              </p>
              <p className="mt-1 text-slate-500">{reviewPendingOrder(order, observedAt).reason}</p>
            </div><button onClick={() => void cancel(order)} className="ml-auto rounded border border-rose-800 px-3 py-1 text-rose-300">Скасувати</button></article>)}</div>}</section></main>;
}
