import assert from "node:assert/strict";
import { test } from "node:test";
import { sealMarketInputSnapshot } from "../lib/market-input-snapshot.ts";
import { compareFrozenMarketPlan, evaluateSnapshotReference } from "../lib/snapshot-parity.ts";

const size = {"30":1800000,"60":3600000,"240":14400000,D:86400000};
const at = Date.UTC(2026, 10, 12, 16, 0);
function fixture(lastPrice = "135") {
  const candles = Object.fromEntries(Object.entries(size).map(([name, interval]) => {
    const cutoff = Math.floor(at / interval) * interval;
    return [name,Array.from({length:90}, (_,i) => {
      const start = cutoff - (90-i)*interval;
      const close = 100 + i*0.4;
      return [String(start),String(close-0.1),String(close+0.8),
        String(close-0.8),String(close),"100","1000000"];
    })];
  }));
  return sealMarketInputSnapshot({
    schema:"alpha-pulse-market-input-v1",source:"bybit-demo",observedAt:at,
    symbol:"BTCUSDT",
    ticker:{symbol:"BTCUSDT",lastPrice,price24hPcnt:"0.03",turnover24h:"900000000"},
    instrument:{symbol:"BTCUSDT",status:"Trading",quoteCoin:"USDT",settleCoin:"USDT",
      priceFilter:{tickSize:"0.1"},lotSizeFilter:{qtyStep:"0.01",minOrderQty:"0.1"}},
    candles,
  });
}
test("independent snapshot comparison is deterministic and requires no network", () => {
  const sealed = fixture();
  const a = compareFrozenMarketPlan(sealed, null);
  const b = compareFrozenMarketPlan(structuredClone(sealed), null);
  assert.deepEqual(a,b);
  assert.equal(a.schema,"alpha-pulse-parity-v1");
  assert.equal(a.sha256,sealed.sha256);
  assert.equal(a.scannerMatches, a.tickerReference === null);
});
test("ticker vs 30m close reference are explicitly separated", () => {
  const sealed=fixture("145");
  const quote=evaluateSnapshotReference(sealed,"ticker-reference");
  const closed=evaluateSnapshotReference(sealed,"closed-30m-reference");
  assert.ok(quote);
  assert.ok(closed);
  assert.equal(quote.priceReference,145);
  assert.equal(closed.priceReference,135.6);
  assert.ok(compareFrozenMarketPlan(sealed,null).closeModeDifferences.includes("priceReference"));
});
test("tampered market input is rejected before evaluation", () => {
  const sealed=fixture();
  sealed.snapshot.ticker.lastPrice="175";
  assert.throws(()=>evaluateSnapshotReference(sealed,"ticker-reference"),/контрольна сума/);
});
test("mismatched source plan is reported rather than treated as parity", () => {
  const result=compareFrozenMarketPlan(fixture(), {
    direction:"SHORT",entryPrice:1,stopLoss:2,takeProfit2:0.5,
    score:100,status:"ACTIVE",readiness:{met:8},qualityGate:{passed:true},
  });
  assert.equal(result.scannerMatches,false);
  assert.ok(result.mismatches.length>0);
});
