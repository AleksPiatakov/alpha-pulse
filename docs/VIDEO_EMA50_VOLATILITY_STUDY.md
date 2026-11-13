# EMA 50 Multi-Timeframe — experiment from supplied video (research only)

## Hypothesis and exact video-derived settings
This is a NEW independent strategy, not a replacement for existing MTF, Trend Pullback or Breakout+Retest.
- EMA 50 on 4h and 1h; both trends must agree. Current close must be on the trend side of EMA.
- EMA slope comparison with 10 bars back; below absolute 0.3% treated as flat (no trade).
- The 1h price bar must have touched EMA50 with 0.2% price tolerance within the previous 16 **closed** 1h bars.
- On 15m the last **closed** candle must cross EMA50 in the trend direction from the opposite side.
- Market-entry research approximation is NEXT 15m candle's open, not today's last price or an assumed perfect close fill.
- Base video setup: SL 2.5%, TP 7.5% (3R); controlled alternative TP 5% (2R), same SL and all signals.
- All percentages remain fixed; do not optimize them against the same historical dataset.

## Two cohorts
Cohort A contains BTCUSDT, ETHUSDT, SOLUSDT (user-selected reference group; their actual volatilities are MEASURED, not presumed top-of-market).
Cohort B is the THREE LOWEST realized annualized hourly-return volatilities from the eight successfully loaded candidates:
XRPUSDT, ADAUSDT, LTCUSDT, TRXUSDT, XLMUSDT, LINKUSDT, BCHUSDT, ETCUSDT.
A missing/unavailable instrument is excluded. Popularity is not a volatility measurement. Cohort B is selected on the same sample as the results, and is therefore **exploratory** rather than an independent comparison.

## Sampling and execution
- Bybit public linear OHLCV, server-pinned cutoff: 2026-11-12 00:00 UTC. Initial window 120 days; full window 365 days selectable. Do not report results if <90% complete coverage or stale/missing head/tail.
- All bars must be aligned and closed by decision time. Missing/corrupt data fails closed.
- Local history snapshots under `.alpha-pulse-ema50-snapshots/` use SHA-256 and immutable first-writer persistence.
- Signals exclude overlapping positions, exit on first TP/SL, maximum 24h holding. Same-bar TP+SL conservatively resolved as SL.
- Reference cost: 0.055% per side, no additional slippage.
- Conservative cost: 0.075% per side, 5 bps adverse entry, stop adverse gap plus 10 bps, timeout 5 bps.
- Unfinished final-history positions are censored, not assigned imaginary TP/SL.
- Reports include signal count, trade count, win rate, net sum R, mean R, max drawdown R, complete trade journal, volatility, data hash.
- These are independent **per symbol**, not a concurrent capital-constrained portfolio model; net R is not equity return.

## How to run locally
Start the local app and go to `http://localhost:3000/ema50-study`. Choose 120 or 365 days, then click `Запустити порівняння`. First run downloads public market history and may be slow; later runs use immutable stored data. Individual failures are shown, not replaced with fabricated values.

Standalone read-only study: `node --experimental-strip-types scripts/ema50-market-study.mjs`. Results with all journals are written to `ema50-study-output/ema50-study-120d.json`. To run 365 days: `EMA50_DAYS=365 node --experimental-strip-types scripts/ema50-market-study.mjs`.

A GitHub Actions workflow also tries the 120-day study, but GitHub-hosted runners may have access restrictions to Bybit. If the public endpoint fails there, **no market performance result is established**. This is separate from successful unit/build CI.

## Critical limitations
Video's reported +18.31% on 27 trades cannot be adopted as Alpha Pulse's backtest result; different markets, history dates, order sizing and execution assumptions apply. Choosing 3R after seeing historical losses is a source of selection bias. Period selection, market-selection and parameter selection must be evaluated on untouched forward periods before considering any Demo execution. No live or Demo trading permissions were changed.
