import { NextResponse } from "next/server";
import { bybitDemoRequest, isDemoEnvironment } from "@/lib/trading";

type WalletResponse = { result: { list: Array<{ totalEquity?: string; totalWalletBalance?: string; totalAvailableBalance?: string; coin?: Array<{ coin?: string; equity?: string; walletBalance?: string }> }> } };
type OrdersResponse = { result: { list: Array<{ symbol?: string; orderStatus?: string }> } };
type PositionsResponse = { result: { list: Array<{ symbol?: string; size?: string }> } };

const error = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });

export async function GET() {
  if (!isDemoEnvironment()) return error("Баланс доступний лише для Demo-режиму.", 403);
  try {
    const [wallet, orders, positions] = await Promise.all([
      bybitDemoRequest<WalletResponse>("/v5/account/wallet-balance?accountType=UNIFIED&coin=USDT", "GET", "accountType=UNIFIED&coin=USDT"),
      bybitDemoRequest<OrdersResponse>("/v5/order/realtime?category=linear&settleCoin=USDT&openOnly=0&limit=50", "GET", "category=linear&settleCoin=USDT&openOnly=0&limit=50"),
      bybitDemoRequest<PositionsResponse>("/v5/position/list?category=linear&settleCoin=USDT", "GET", "category=linear&settleCoin=USDT"),
    ]);
    const account = wallet.result.list[0];
    const usdt = account?.coin?.find((coin) => coin.coin === "USDT");
    const equity = Number(account?.totalEquity ?? usdt?.equity ?? account?.totalWalletBalance ?? usdt?.walletBalance ?? 0);
    const symbols = new Set<string>();
    orders.result.list.filter((order) => ["New", "PartiallyFilled", "Untriggered"].includes(order.orderStatus ?? "")).forEach((order) => { if (order.symbol) symbols.add(order.symbol); });
    positions.result.list.filter((position) => Number(position.size) > 0).forEach((position) => { if (position.symbol) symbols.add(position.symbol); });
    return NextResponse.json({ success: true, environment: "demo", balance: Number.isFinite(equity) ? equity : 0, activeCount: symbols.size, source: "bybit-demo" });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Не вдалося прочитати Demo-баланс Bybit.", 502);
  }
}
