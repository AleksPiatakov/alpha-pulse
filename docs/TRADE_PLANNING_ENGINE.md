# Shared Trade Planning Engine — stage 2

Implemented: `lib/trade-planning-engine.ts` provides a pure, deterministic calculation of structural entry, ATR-based stop, structural/daily target, post-rounding R:R, and comparative quality/readiness diagnostics. No network requests, time reads or order placement.

Consumers:
- `lib/market-scan.ts` calculates levels and the research-only quality gate through the new shared planner; it can retain a labeled EMA/ATR fallback when the pivot is missing (such plans cannot be ACTIVE under the structured readiness check).
- `lib/mtf-backtest.ts` now calculates the same levels and gate through the planner on historic closed bars; it still requires confirmed entry and target levels to simulate an order.
- `app/api/trade/route.ts` continues to recalculate the exact current plan by calling `verifyCurrentTechnicalPlan`, which invokes the shared scanner planner, before checking client levels, balance and exposure. No order policy or Demo order permissions changed.

Regression tests: `test/trade-planning-engine.test.mjs`, existing technical core tests and full GitHub CI.

Crucial parity limitations:
1. The live scanner evaluates current Bybit Demo ticker lastPrice, ticker 24h change and turnover, whereas historical replay uses only fully closed public-market candles. **They do not currently produce equal signals on the same historical timestamps.**
2. Historical replay can round to instrument tickSize. The live scanner currently uses decimal price rounding, not exact Bybit priceFilter.tickSize; the order endpoint relies on subsequent Bybit validation. This mismatch needs fixing before claiming order-exact parity.
3. The replay's modeled OHLC limit fills, assumed fees and slippage cannot prove actual Demo execution.
4. The research gate is a hypothesis, not estimated success probability. No strategy has demonstrated independent post-cost profitability.
5. No new strategies, universal product-category support, durable scanner history, real portfolio correlation model or autonomous live orders are introduced in this stage.

Next steps: point-in-time, versioned market observation snapshots; unified tick/quantity precision and cost metadata; identical strategy evaluation clock; explicit pre-order risk approval; independent Trend Pullback and Breakout+Retest candidate engines; new untouched validation periods.
