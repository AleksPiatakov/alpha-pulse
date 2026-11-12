import assert from "node:assert/strict";
import { test } from "node:test";
import { selectEligibleInstruments, fetchLinearUniverse, matchUniverseTickers } from "../lib/bybit-universe.ts";
const instrument = (symbol, extra = {}) => ({
  symbol, status: "Trading", quoteCoin: "USDT", settleCoin: "USDT",
  contractType: "LinearPerpetual", priceFilter: { tickSize: "0.01" },
  ...extra,
});
test("includes all trading USDT linear instruments without volume-based discovery truncation", () => {
  const raw = Array.from({length: 1150}, (_, i) => instrument(`PAIR${i}USDT`));
  const result = selectEligibleInstruments([...raw, instrument("HALTUSDT", {status:"Settling"}),
    instrument("USDCUSDT", {quoteCoin:"USDC"}), instrument("SPOTUSDT",{contractType:"Spot"})]);
  assert.equal(result.eligibleSymbols.size, 1150);
  assert.equal(result.rejectedNonTrading, 1);
  assert.equal(result.rejectedUnsupported, 2);
});
test("reads every instruments-info cursor page and passes cursor through unchanged", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(new URL(url));
    const cursor = new URL(url).searchParams.get("cursor");
    return { ok: true, json: async () => ({retCode:0,result:{
      list: cursor ? [instrument("ETHUSDT")] : [instrument("BTCUSDT")],
      nextPageCursor: cursor ? "" : "cursor+with/slash=",
    }}) };
  };
  const result = await fetchLinearUniverse("https://api-demo.bybit.com", fakeFetch);
  assert.equal(result.pages, 2);
  assert.deepEqual([...result.eligibleSymbols].sort(), ["BTCUSDT","ETHUSDT"]);
  assert.equal(calls[0].searchParams.get("limit"), "1000");
  assert.equal(calls[1].searchParams.get("cursor"), "cursor+with/slash=");
});
test("repeated cursor fails instead of reporting a partial universe as complete", async () => {
  const fakeFetch = async () => ({ok:true,json:async()=>({retCode:0,result:{
    list:[instrument("BTCUSDT")], nextPageCursor:"loop",
  }})});
  await assert.rejects(fetchLinearUniverse("https://api-demo.bybit.com", fakeFetch), /cursor/);
});
test("market ticker matching skips missing, malformed, and non-tradable quotes", () => {
  const records = [
    { symbol:"BTCUSDT",lastPrice:"70000",price24hPcnt:"0",turnover24h:"1000"},
    { symbol:"ETHUSDT",lastPrice:"2000",price24hPcnt:"0",turnover24h:"2000"},
    { symbol:"DOGEUSDT",lastPrice:"0",price24hPcnt:"0",turnover24h:"9000"},
  ];
  assert.deepEqual(matchUniverseTickers(records,new Set(["BTCUSDT","ETHUSDT","DOGEUSDT"]))
    .map((x)=>x.symbol),["BTCUSDT","ETHUSDT"]);
});
