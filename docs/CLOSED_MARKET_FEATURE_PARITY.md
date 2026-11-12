# Closed-hour market feature parity — stage 5

The scanner and MTF replay previously used **different data inputs for the same quality labels**: the live scanner read 24h change and turnover from the live Demo ticker; replay computed them from hourly historical bars. This allowed otherwise similar setups to receive different momentum/liquidity ratings.

## Implemented
- `lib/closed-market-features.ts` computes the 24h close-to-close price change (last fully closed 1h close vs 24 closed hourly periods ago), sum of turnover over the most recent 24 fully closed hourly bars, and last closed 1h volume relative to the mean of the preceding 30 closed 1h bars.
- Both `lib/market-scan.ts` and `lib/mtf-backtest.ts` now call this same pure helper and reject malformed/insufficient data.
- Live scan rejects invalid/missing Bybit candle turnover rather than silently replacing it with the ticker. Plans include `featureSource: "closed-1h-candles"` to disclose the source.
- `test/closed-market-features.test.mjs` compares scanner-adapted string data to numeric replay values and checks missing/invalid data rejection.
- Order policy and existing open orders are unchanged.

## Important scope boundary
This aligns three **quality features**, not the entire strategy. Live discovery still uses the latest Demo ticker lastPrice for candidate direction fallback, structural pivot reference and distance-to-entry, while replay uses the most recent *closed 30m candle close*. This can still produce different setups, which must not be marketed as full parity. The Demo and historical data feeds may also differ. Historical results from previous exports should **not** be compared as if these were the same version/rules.

Next: explicit snapshot capture including ticker+closed bars+instrument filters with a source/version hash, deterministic evaluation of scanner and replay on **the exact same snapshot**, followed by independent Trend Pullback / Breakout+Retest modules and untouched evaluation periods. Do not auto-execute or promise profitability.
