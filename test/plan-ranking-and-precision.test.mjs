import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePlanPriority } from "../lib/plan-ranking.ts";
import { parseExecutionRules, isOnStep, validateOrderPrecision } from "../lib/bybit-execution-rules.ts";
const plan = (symbol, active, quality, zone, score=90) => ({
  symbol, status: active ? "ACTIVE" : "REVIEW", qualityGate: { passed: quality }, score,
  riskReward: 2, currentPrice: 100, entryLow: zone ? 99 : 90, entryHigh: zone ? 101 : 91,
});
test("quality-passed technical setup ranks ahead of in-zone but failed setup", () => {
  const sorted = [
    plan("FAILEDU", true, false, true, 99),
    plan("WAITINGU", false, false, true, 100),
    plan("PASSU", true, true, false, 90),
  ].sort(comparePlanPriority);
  assert.deepEqual(sorted.map(p => p.symbol), ["PASSU", "FAILEDU", "WAITINGU"]);
});
test("metadata parsing requires trustworthy step and lot filters", () => {
  const meta = {symbol:"TESTUSDT",status:"Trading",quoteCoin:"USDT",settleCoin:"USDT",
    priceFilter:{tickSize:"0.0001"},lotSizeFilter:{qtyStep:"0.01",minOrderQty:"0.1",minNotionalValue:"5"}};
  const r = parseExecutionRules(meta);
  assert.deepEqual(r, {tickSize:0.0001,qtyStep:0.01,minOrderQty:0.1,minNotionalValue:5});
  assert.equal(parseExecutionRules({...meta,lotSizeFilter:undefined}), null);
  assert.equal(parseExecutionRules({...meta,status:"Settling"}), null);
});
test("Bybit price/quantity precision and minimum are checked without float false positives", () => {
  const rules = {tickSize:0.0001,qtyStep:0.01,minOrderQty:0.1,minNotionalValue:5};
  assert.equal(isOnStep(0.1234,0.0001),true);
  assert.deepEqual(validateOrderPrecision({entry:10.1234,stop:9.2345,target:12.3456,quantity:0.5},rules),[]);
  const errors = validateOrderPrecision({entry:10.12345,stop:9.2345,target:12.3456,quantity:0.105},rules);
  assert.ok(errors.some(e=>e.includes("tickSize")));
  assert.ok(errors.some(e=>e.includes("qtyStep")));
  assert.ok(errors.some(e=>e.includes("Номінал")));
});
