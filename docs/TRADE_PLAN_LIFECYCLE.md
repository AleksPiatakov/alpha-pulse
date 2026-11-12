# Trade plan lifecycle: thesis vs live exchange protection

The scanner and trade detail now present three independent concepts:
- **Setup/thesis review:** closing of a completed 1h candle beyond the plan's invalidation level may cancel or require re-evaluation of the setup **before a fill**. This is a strategy observation, not an exchange order trigger.
- **Protective Stop Loss after entry:** Demo order creation uses `stopLoss` with `slTriggerBy: "MarkPrice"`. The trigger does not wait for a 1h candle close. Real execution may differ from requested stop price because of market conditions.
- **Pending Limit lifetime:** Demo currently submits `timeInForce: "GTC"`, and a signal's 2-hour `expiresAt` does **not** cancel an already placed exchange order. Pending orders require separate management/cancellation. Do not claim automatic expiration.

This stage changes only explanations and adds tests. Order endpoints, protective trigger configuration, risk caps and manual confirmation remain unchanged.

Open problems before automatic signal-to-execution workflows:
1. Add expiry-aware, safe cancellation/reconciliation of pending orders with explicit owner approval and order status confirmations.
2. Add historical/live point-in-time parity for close-of-candle evaluation.
3. Include fundings, spread, order-book slippage and correlated position risk in candidate qualification.
4. Prove strategies on untouched market data and Demo forward logs; no model's technical score is a forecast probability.
