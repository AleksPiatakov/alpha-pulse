/**
 * Read-only oversight of Bybit Demo orders. Age is measured from the exchange
 * createdTime, not from a guessed local signal expiration time.
 * No automatic cancellations, no implicit order authorization.
 */
export type OpenOrder = {
  orderId: string;
  symbol: string;
  orderStatus: string;
  orderType?: string;
  timeInForce?: string;
  createdTime?: string | number;
  updatedTime?: string | number;
};
export const PENDING_ORDER_STATUSES = new Set(["New", "PartiallyFilled", "Untriggered"]);
export const PENDING_REVIEW_AFTER_MS = 2 * 60 * 60 * 1000;
export type OrderReview = { status: "review" | "recent" | "unknown" | "not-pending";
  ageMinutes: number | null; reason: string; };
export function reviewPendingOrder(order: OpenOrder, now: number): OrderReview {
  if (!PENDING_ORDER_STATUSES.has(order.orderStatus))
    return {status: "not-pending", ageMinutes: null, reason: "Заявка не має відкритого статусу."};
  const timestamp = Number(order.createdTime);
  if (order.createdTime == null || order.createdTime === "" ||
      !Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(now) ||
      timestamp > now + 60_000 || timestamp < 1_000_000_000_000) {
    return {status: "unknown", ageMinutes: null,
      reason: "Немає достовірного часу створення Bybit. Перевір вручну."};
  }
  const ageMinutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (now - timestamp >= PENDING_REVIEW_AFTER_MS)
    return {status: "review", ageMinutes,
      reason: "Заявка існує понад 2 години. Перевір актуальність сценарію й стан виконання; не скасовується автоматично."};
  return {status: "recent", ageMinutes,
    reason: "Заявка ще молода. Це не гарантує актуальність торгової ідеї."};
}
