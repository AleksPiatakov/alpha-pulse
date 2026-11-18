/**
 * Fair coarse-first order for a complete Bybit USDT-linear sweep.
 * The daily ticker turnover is used ONLY to determine analysis priority:
 * no instrument is silently discarded and no trading plan passes on ticker data alone.
 */
export type CoarseTicker = {symbol:string;turnover24h:string;lastPrice:string};
export function orderMarketScan(tickers:readonly CoarseTicker[]):string[] {
  return [...tickers].sort((a,b)=>{
    const ta=Number(a.turnover24h),tb=Number(b.turnover24h);
    const av=Number.isFinite(ta)&&ta>0?ta:0;
    const bv=Number.isFinite(tb)&&tb>0?tb:0;
    return bv-av||a.symbol.localeCompare(b.symbol);
  }).map(t=>t.symbol);
}
/**
 * Keep the full-cycle order pinned as fresh tickers arrive.
 * New listings join only the next sweep; delistings are ignored safely.
 */
export function selectSweepBatch(order:readonly string[], cursor:number, batchSize:number):{
 symbols:string[];nextCursor:number;finished:boolean
}{
 if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(batchSize)||batchSize<1)
  throw Error("Invalid market sweep arguments");
 if(!order.length)return {symbols:[],nextCursor:0,finished:true};
 const from=Math.min(cursor,order.length);
 const symbols=order.slice(from,from+batchSize);
 const nextCursor=from+symbols.length;
 return {symbols,nextCursor:nextCursor>=order.length?0:nextCursor,finished:nextCursor>=order.length};
}
