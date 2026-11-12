# Research Strategy Interface — experimental v1

A deterministic, **read-only** interface now exists in `lib/research-strategies.ts`, with candidate contract `StrategyCandidate` and two independent detectors. They only consume explicitly provided, previously closed 30m/1h/4h candles and validated instrument tickSize. No external API reads, clock reads or order placement are performed by the detectors.

## Trend Pullback v1
Requires 1h and 4h directional agreement, previous closed 30m candle near/touching EMA20, and last closed 30m candle resuming the trend. Its stop uses the last two bars' extreme with a 0.25 ATR buffer, and stop width must be 0.8–3 ATR. Target is an **experimental 2R placeholder**, not a confirmed order-book or daily structural target.

## Breakout + Retest v1
Requires 1h and 4h trend agreement; a closed 30m candle breaking the preceding 20-bar price extreme beyond a 0.1 ATR margin; the following closed candle retesting; and the last closed candle confirming trend direction. Its stop uses the retest/current-bar extreme plus 0.25 ATR and must be 0.8–3 ATR. Its 2R target is likewise experimental.

Both detectors generate a candidate only after price levels are rounded to Bybit tickSize, positive risk and R:R >=1.5 checks succeed. Both set `experimental:true` and `executable:false` unconditionally. A 2R proposal is NOT evidence of achievable 2R, statistically positive expectancy or probable fill.

## Connection to the application
`POST /api/research/replay` now returns `researchStrategies` when supplied a valid sealed snapshot. This is **offline research only**, and does not alter the main scanner's rankings, existing historical Strategy Lab results, or the server's Demo order permissions.

## Required before selecting or trading strategies
- Backtest each candidate on untouched data with an execution model (fees, spread, funding, slippage, ambiguous OHLC ordering, realistic Limit fills).
- Verify independent out-of-sample and forward Demo evidence; compare loss distributions and correlation.
- Connect verified candidates to the same deterministic strategy evaluation used in historical replay and the live scanner, without score inflation or a required trade count.
- Implement explicit pre-order permission and portfolio-risk checks; no automatic trade execution is authorized.

Tests: `test/research-strategies.test.mjs` covers registry, candidate fixtures, no-signal rejection, deterministic snapshot computation and mutated snapshot refusal.
