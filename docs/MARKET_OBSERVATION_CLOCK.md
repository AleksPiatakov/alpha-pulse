# Market Observation Clock — stage 4

## Goal
Make the **candle availability instant** explicit and reproducible. The timestamp from Bybit V5 klines is the **bar OPEN** time. A strategy must only use a candle when its close time is <= the decision cutoff, never the still-forming bar.

## Implemented
- `lib/market-observation-clock.ts` owns four UTC timeframe durations (30m, 1h, 4h, D), completed-bar decision cutoffs, filtering and observation metadata.
- The live scanner captures **one** `observedAt` timestamp when a scan batch begins; that same instant is passed into all four candle requests for every instrument in that batch. A separately refreshed symbol gets a fresh single instant.
- Each scanner plan stores `observation`: `observedAt`, `last30mClose`, `last1hClose`, `last4hClose`, `lastDailyClose`.
- Historical replay calls the same `closedBarAt` predicate at each historical decision instant rather than independently recomputing the candle-close condition.
- Deterministic tests cover exact close boundaries and incomplete 30m/1h/4h/D candles.

## What this does NOT yet prove
Scanner candles come from the Bybit Demo endpoint and are evaluated using the latest ticker (`lastPrice`, `price24hPcnt`, `turnover24h`). Historical replay typically uses public historical OHLC/turnover available at the earlier decision time. The two data sources and quality inputs still differ, so **equal candle-close rules do not imply equal signals or profit**. Snapshots, same-source replay, and indicator parity on identical recorded inputs are the next mandatory steps before calling the strategies equivalent.

The live scanner also caches plans and has a separate four-minute technical confirmation freshness threshold. Observation metadata identifies the underlying candle decision time; it does not mean a cached plan is always current.

No API keys, order routes, existing Demo positions or manual confirmation rules were changed. A trading signal is not automatically an approved order.
