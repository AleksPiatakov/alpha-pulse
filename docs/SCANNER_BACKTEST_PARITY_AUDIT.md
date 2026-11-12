# Alpha Pulse — scanner vs historical replay parity audit

Date: 2026-11-12
Scope: `lib/market-scan.ts`, `lib/mtf-backtest.ts`, `lib/scenario-quality.ts`, `app/api/backtest/route.ts`, `lib/trading.ts`.
Status: **NOT EQUIVALENT**. This is a source-code audit, not independent reproduction against archived Bybit candles.

## Shared rules confirmed

- Both calculate EMA20/EMA50 trend on 30m, 1h and 4h.
- Both use 14 true ranges from 15 closed bars for ATR.
- Both use a five-bar swing candidate (two completed bars on either side).
- Both place an entry at nearest valid 30m/1h/4h/1D support/resistance, for fully confirmed scenarios.
- Both set Stop at max(1.25× 1h ATR, 2× 30m ATR) and cap the 2.4R target at a confirmed daily pivot, buffered by 0.05R.
- Both call `evaluateScenarioQuality` for the eight readiness checks. The replay only trades `ACTIVE`; the scanner also surfaces `REVIEW`.

## Implementation progress (2026-11-12)

**Stage 1 complete — shared deterministic calculation core:** `lib/technical-plan-core.ts` is imported by both `lib/market-scan.ts` and `lib/mtf-backtest.ts`. It now owns EMA20/50, ATR, trend selection, confirmed swing levels, nearest level across timeframes, ATR-based stop, buffered daily target and reward/risk. The scanner and replay convert their respective candle representations to the common `PriceBar` shape. Regression fixtures in `test/technical-plan-core.test.mjs` cover technical calculations and pivot confirmation.

**Parity is still partial.** The unified price-bar mathematics does not unify observed ticker price, 24h statistics, Demo/public feed, decimal rounding or timing. Historical performance must still be described as a close-only proxy, not an exact live-scanner audit. No production trading rules or Demo order permissions were changed.

## Material differences

| Severity | Difference | Live scanner | Historical replay | Impact |
|---|---|---|---|---|
| High | Market-data host | `api-demo.bybit.com` | `api.bybit.com` | Different sources can disagree on availability/quote timing or candles. Verify equivalence using recorded snapshots before claiming parity. |
| High | Price at decision | `ticker.lastPrice` (current tick) | Last closed 30m candle close | Different entry distance, pivot eligibility, scenario direction fallback and readiness. |
| High | 24h momentum | Bybit `ticker.price24hPcnt` | 30m close divided by a 1h close 24 bars earlier | Not the same measurement, including different end timestamps. |
| High | 24h turnover | Bybit `ticker.turnover24h` | Sum of 24 completed 1h bar turnovers | Threshold at 20m USDT can flip at a boundary; replay excludes partial hour. |
| Medium | Round-to-price | `roundPrice` for entry, stop and target and then recompute R:R | Uses raw floating-point entry, stop and target in quality and execution | Different R:R pass/fail and trade outcomes. Neither uses instrument tickSize yet. |
| Medium | Structural fallback | When no pivot, scanner uses EMA/ATR fallback but it is normally REVIEW because structured condition fails | Drops candidate altogether | Equivalent for confirmed-only trades but different coverage of review candidates. |
| Medium | Readiness evaluation cadence | Each rotating pair checked live, then cached and downgraded after 4 min | Every closed 30m bar with a simulated pending Limit window | Not an exact reconstruction of live alert/order scheduling. |
| Medium | Execution model | Real Demo exchange validation and execution | OHLC touch = fill; assumed 6h pending, 48h position; SL first on ambiguity; flat fee | Backtest estimates, not fill-exact; no funding, slippage, queue or instrument-specific trading rules. |
| Medium | Candle selection | Last 200 closed candles, from demo | Up to 200 closed bars before each decision, from public | Similar window, but rolling historical and current scanner may still differ at API snapshots. |
| High | Auditability | Live timestamped snapshots not persisted | Replay API returns only last 30 trade records per symbol | Cannot independently reconcile every historical transaction against full backtest output. |

## Verification / remediation order

1. **Persist safe market snapshots** (symbol, evaluation timestamp, closed candle timestamps, lastPrice and ticker 24h fields, indicator inputs, rounded levels, quality checks, deterministic diagnostic hash). Never persist or expose API secrets.
2. **Extract one pure planner function** taking an explicit observation clock and an explicit source-price/ticker snapshot, returning a stable plan or rejection reasons. Reuse in scanner, replay and server pre-order verification.
3. **Define the tested strategy** explicitly: either close-only 30m decisions or tick-level live decisions. If scanner remains tick-based, historical OHLC cannot reproduce it exactly; label the replay a close-only proxy.
4. **Use instrument tickSize and quantity step** from Bybit instruments metadata, not `roundPrice` decimals. Include real rounding in both paths and retest R:R after rounding.
5. **Add parity fixtures** from recorded point-in-time, closed-candle-only data. Assert the same direction, pivot, entry, stop, TP, score, readiness and rejected reasons for both execution paths at the same clock.
6. **Audit trade replay**: gap-through-limit handling, OHLC ambiguity, time boundaries, last incomplete trade, fees, slippage/funding sensitivity, missing candles, and data coverage; expose all trades for a full audit export.
7. **Only after parity** run the eight-symbol experiment again and establish a new *future* holdout. The already examined July–November 2026 history cannot be relabeled independent.

## Current interpretation

The exported historical results are useful **experimental diagnostics for the close-only replay model**, but should not be advertised as verified profit/loss results of the live scanner. Do not automatically transfer the 4h-trend filter into the live order strategy yet.

No trading thresholds, production scanner logic or Demo order permissions were changed by this audit.
