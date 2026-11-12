import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewPendingOrder, PENDING_REVIEW_AFTER_MS } from "../lib/demo-order-review.ts";

const now = Date.UTC(2026, 10, 12, 17, 0, 0);
test("two-hour pending order flags manual review but never cancels", () => {
  const result = reviewPendingOrder({
    orderId: "demo-1", symbol: "BTCUSDT", orderStatus: "New",
    createdTime: String(now - PENDING_REVIEW_AFTER_MS),
    timeInForce: "GTC",
  }, now);
  assert.equal(result.status, "review");
  assert.equal(result.ageMinutes, 120);
  assert.match(result.reason, /не скасовується автоматично/);
});
test("fresh pending order is not claimed to be a safe signal", () => {
  const result = reviewPendingOrder({
    orderId: "demo-2", symbol: "ETHUSDT", orderStatus: "PartiallyFilled",
    createdTime: String(now - 10 * 60_000),
  }, now);
  assert.equal(result.status, "recent");
  assert.match(result.reason, /не гарантує/);
});
test("missing, malformed or future exchange time fails to unknown", () => {
  for (const createdTime of [undefined, "abc", String(now + 120_000)]) {
    assert.equal(reviewPendingOrder({
      orderId: "x", symbol: "BTCUSDT", orderStatus: "Untriggered", createdTime,
    }, now).status, "unknown");
  }
});
test("filled and cancelled orders are not marked pending", () => {
  for(const orderStatus of ["Filled", "Cancelled", "Rejected"]) {
    assert.equal(reviewPendingOrder({orderId:"x",symbol:"BTCUSDT",orderStatus,createdTime:String(now-99999999)},now).status,"not-pending");
  }
});
