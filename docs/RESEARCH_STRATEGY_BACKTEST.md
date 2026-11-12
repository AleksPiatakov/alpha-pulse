# Independent research strategy historical replay — experimental stage

## Implemented
- `lib/research-strategy-backtest.ts` runs Trend Pullback v1 and Breakout + Retest v1 independently on the SAME 30m, 1h and 4h saved historical candle arrays.
- Strategy context only contains fully closed bars at each decision timestamp. Candidate generation uses the existing `lib/research-strategies.ts` detector definitions and current supplied tickSize.
- Limit order modeled for up to six future 30m candles; one research order/position per strategy and symbol at a time. Holding up to 48 bars (24h) from fill.
- Reference model: OHLC touch, nominal Entry, 0.055% fees per side.
- Conservative model: Limit price must be exceeded by one tick, 0.075% fees per side, stop adverse gap +10 bps, timeout +5 bps; if TP and SL both touched in a candle, SL wins.
- Near-end signals/trades lacking sufficient future bars are **censored**, not forcibly converted into fictional TP/SL/TIMEOUT.
- Summary provides signals, filled, unfilled, censored, net and average R, wins, max drawdown in R, and complete per-trade journal.
- `/api/backtest?symbol=BTCUSDT&fixed=1&ticks=1&snapshot=auto&research=1` returns both strategies and both cost scenarios from the previously supported local immutable data snapshots.
- `/research-strategies` provides a separate user-facing comparison page, linked from `/strategy-lab`; the legacy MTF ranking remains unchanged.
- `test/research-strategy-backtest.test.mjs` checks no-trade markets, input safety, deterministic results and cost model output.

## Not established
This does not prove expected profitability, independent validation or intrabar execution precision. Tick size reflects metadata available at capture rather than each historical date. Bid/ask spread, funding, liquidity/market impact, margin and portfolio correlation are not included. The fixed 2026-11-12 comparison history has already been examined for earlier hypotheses. No Demo or live order permissions have been enabled. No time-window selection or optimization is implied by this stage.

## Next required milestones
1. Run the actual eight-pair study from the local app, export and inspect trades, sample size, loss distributions, and conservative net R; do not invent results without source data.
2. Add untouched forward/holdout dates and a portfolio-level correlation-aware replay.
3. Introduce spread, funding and queue-aware fill assumptions, plus fill-vs-signal timing audits.
4. Only after independent positive evidence should any model be eligible for user-approved Demo plans.
