/**
 * Bybit V5 linear market universe.
 * Dynamic, paginated instrument registry; never silently truncate at 500/1000.
 * Research/scanner discovery only — order endpoints retain their own validation.
 */
export type InstrumentMeta = {
  symbol: string; status: string; contractType?: string;
  quoteCoin?: string; settleCoin?: string;
  priceFilter?: { tickSize?: string };
  lotSizeFilter?: { qtyStep?: string; minOrderQty?: string; minNotionalValue?: string };
};
export type TickerInfo = { symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string };
export type UniverseResult = {
  instruments: InstrumentMeta[]; pages: number; eligibleSymbols: Set<string>;
  rejectedNonTrading: number; rejectedUnsupported: number;
};
export function selectEligibleInstruments(items: InstrumentMeta[]): UniverseResult {
  const bySymbol = new Map<string, InstrumentMeta>();
  let rejectedNonTrading = 0, rejectedUnsupported = 0;
  for (const item of items) {
    if (item.status !== "Trading") { rejectedNonTrading++; continue; }
    // Current execution/replay supports linear USDT contracts only.
    if (!/^[A-Z0-9]{3,24}USDT$/.test(item.symbol) ||
      item.quoteCoin !== "USDT" || item.settleCoin !== "USDT" ||
      (item.contractType && item.contractType !== "LinearPerpetual" && item.contractType !== "LinearFutures")) {
      rejectedUnsupported++; continue;
    }
    bySymbol.set(item.symbol, item);
  }
  return { instruments: [...bySymbol.values()], pages: 0,
    eligibleSymbols: new Set(bySymbol.keys()), rejectedNonTrading, rejectedUnsupported };
}
export async function fetchLinearUniverse(
  baseUrl: string, fetcher: typeof fetch = fetch,
): Promise<UniverseResult> {
  const items: InstrumentMeta[] = [];
  let cursor = "";
  const visitedCursors = new Set<string>();
  let pages = 0;
  // Fail closed on loops / malformed pagination rather than treating partial results as full.
  for (;;) {
    if (pages >= 100) throw new Error("Bybit: надто багато сторінок реєстру інструментів.");
    const url = new URL("/v5/market/instruments-info", baseUrl);
    url.searchParams.set("category", "linear");
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetcher(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Bybit instruments HTTP ${response.status}`);
    const data = await response.json() as { retCode?: number; retMsg?: string;
      result?: { list?: InstrumentMeta[]; nextPageCursor?: string } };
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      throw new Error(`Bybit instruments: ${data.retMsg ?? "неповна відповідь"}`);
    }
    pages++;
    items.push(...data.result.list);
    const next = data.result.nextPageCursor ?? "";
    if (!next) break;
    if (visitedCursors.has(next) || next === cursor) throw new Error("Bybit: повторний cursor у пагінації.");
    visitedCursors.add(next);
    cursor = next;
  }
  const selected = selectEligibleInstruments(items);
  return { ...selected, pages };
}
export function matchUniverseTickers(tickers: TickerInfo[], eligible: Set<string>) {
  const symbols = new Map<string, TickerInfo>();
  for (const t of tickers) {
    if (eligible.has(t.symbol) && Number.isFinite(Number(t.lastPrice)) && Number(t.lastPrice) > 0)
      symbols.set(t.symbol, t);
  }
  return [...symbols.values()].sort((a, b) =>
    Number(b.turnover24h) - Number(a.turnover24h) || a.symbol.localeCompare(b.symbol));
}
