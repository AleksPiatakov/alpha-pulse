import assert from "node:assert/strict";
import { test } from "node:test";
import { sealMarketInputSnapshot, verifyMarketInputSnapshot, validateMarketInputSnapshot } from "../lib/market-input-snapshot.ts";
const size={ "30":1800000, "60":3600000, "240":14400000, D:86400000 };
const observedAt=Date.UTC(2026,10,12,16,0);
function sample() {
  const candles=Object.fromEntries(Object.entries(size).map(([key,interval])=>{
    const end=Math.floor(observedAt/interval)*interval;
    return [key,Array.from({length:65},(_,i)=>{
      const open=end-(65-i)*interval;
      return [String(open),"100","102","98","101","10","1000"];
    })];
  }));
  return {schema:"alpha-pulse-market-input-v1",source:"bybit-demo",
    observedAt,symbol:"BTCUSDT",
    ticker:{symbol:"BTCUSDT",lastPrice:"101.5",price24hPcnt:"0.01",turnover24h:"123456"},
    instrument:{symbol:"BTCUSDT",status:"Trading",quoteCoin:"USDT",settleCoin:"USDT",
      priceFilter:{tickSize:"0.1"},lotSizeFilter:{qtyStep:"0.01",minOrderQty:"0.1"}},
    candles};
}
test("frozen market inputs produce a stable SHA256 seal",()=>{
 const sealed=sealMarketInputSnapshot(sample());
 assert.equal(sealed.sha256.length,64);
 assert.equal(verifyMarketInputSnapshot(sealed),true);
 assert.equal(sealMarketInputSnapshot(structuredClone(sealed.snapshot)).sha256,sealed.sha256);
});
test("changing a single observed price after sealing is detected",()=>{
 const sealed=sealMarketInputSnapshot(sample());
 sealed.snapshot.ticker.lastPrice="102.5";
 assert.equal(verifyMarketInputSnapshot(sealed),false);
});
test("forming candle fails closed even if other history is complete",()=>{
 const data=sample();
 data.candles["30"].at(-1)[0]=String(observedAt);
 assert.ok(validateMarketInputSnapshot(data).some(x=>x.includes("30")));
 assert.throws(()=>sealMarketInputSnapshot(data));
});
test("mismatched symbol, missing rows and missing tickSize fail closed",()=>{
 const a=sample();a.ticker.symbol="ETHUSDT";
 assert.ok(validateMarketInputSnapshot(a).some(x=>x.includes("Символ")));
 const b=sample();b.candles.D=[];
 assert.ok(validateMarketInputSnapshot(b).some(x=>x.includes("D")));
 const c=sample();delete c.instrument.priceFilter;
 assert.ok(validateMarketInputSnapshot(c).some(x=>x.includes("tickSize")));
});
