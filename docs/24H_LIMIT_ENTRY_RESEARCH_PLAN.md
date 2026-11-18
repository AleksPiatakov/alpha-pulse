# Intraday 24-hour Limit-entry research shortlist — stage 1 (2026-11-18)

## User-approved goal
Find up to **ten** carefully researched, potential **pending Limit** entries within **24 hours from the time of analysis**, scanning as much of the currently tradable Bybit USDT-linear universe as possible. The horizon is for potentially reaching **Entry**, NOT a mandatory position close after 24h. No requirement to produce ten candidates if fewer pass. No automatic orders.

## Implemented in this stage
- `lib/limit-entry-24h.ts`: independent pure point-in-time diagnostic. It computes current distance to the Limit Entry in 30m ATR units, then compares it to each prior complete 48-bar (24h) forward excursion on historical closed 30m candles. Historical normalization uses the ATR **known at the start of each old window**, preventing future/current ATR from being backfilled into past volatility regimes.
- Strong safety outcomes: malformed candles, insufficient history (<60 overlapping 24h windows), wrong-side entry and no observed historical excursion all fail closed. Both LONG and SHORT directional pullbacks are handled.
- Output `historicalTouchRate` is the descriptive fraction of **overlapping windows**, not a calibrated fill probability. With about 200 30m bars, sample windows overlap heavily, the market can change regime, and the model cannot predict path, limit order queue, spread or gap execution. NEVER label the percentage as likelihood or certainty. Some windows may contain correlated outcomes.
- `lib/trading.ts` plan fields `structure.confirmedEntry/confirmedTarget` and `limitEntry24h`. Existing plan expiration stays **two hours**, distinct from 24h entry-reach horizon; current Demo GTC limit orders do not auto-cancel at 24h.
- `lib/24h-recommendations.ts`: strict research shortlist requires ACTIVE status, passed technical quality gate, validated 24h history, correct pending entry side, structural confirmed Entry **and** structural confirmed target, and RR >= 2. Sort by technical score and RR, up to 10, no filler.
- `lib/market-scan.ts` maintains the existing full rotating market scan, while adding `recommended24h` and the sweep coverage caveat. Batches of 24 instruments with bounded concurrency are not yet full simultaneous analysis; data may stale between batch visits.
- `app/api/scan/route.ts` exports the research shortlist alongside existing plans; `app/page.tsx` renders a separate shortlist with clearly marked provisional status and descriptive historical touches.
- Automated tests: `test/limit-entry-24h.test.mjs`, `test/24h-recommendations.test.mjs`.
- Existing Demo manual Limit order endpoint and account risk guards are **unchanged**. Shortlist selection is **not** new order authorization.

## What is NOT done
- This is **NOT** yet a fully validated day-ahead prediction model, not a market-wide comparable Top 10 while universe sweep is incomplete, not a demonstrated profitable strategy, not an AI prediction, not a promise that any pending order will fill.
- No calibrated probability of reaching Entry; no order-book or queue/slippage model.
- No two-stage high-throughput scan, no parallel historical scenario replay across all pairs, no independent out-of-sample evidence of superior fills.
- No automatic 24h exchange GTC cancellation. If automatic cancellation is ever proposed, it requires explicit product/permission decisions and testing; research horizon must not be silently conflated with order TTL.
- No validated Value Area/Volume Profile gate yet. Treat CHoCH, flip zones and volume profile as hypotheses and only add when independent historical improvement in Entry quality is demonstrated.

## Immediate priorities
1. Make **full-universe sweep coverage and data timestamps** visible and prevent false market-wide ranking claims. Add fast inexpensive coarse screening for all eligible pairs, then costly deep analysis for promising candidates; preserve refresh for user-selected symbol.
2. Validate 24h Limit reach diagnostic on properly separated held-out dates and independent instruments. Replace heuristic normalized excursion fraction with time-aware, calibrated reachability assessment, confidence interval and liquidity-aware fill simulation.
3. Compare planned versus historical fills, fees, timing, spread and subsequent TP/SL results, not just whether a price traded through Entry.
4. Retain strict manual Demo execution and max 1% per position risk / 3% across open positions; strengthen independent server order checks only with dedicated tests. Never auto-place orders.
5. Continue the distinct EMA50, CHoCH, Flip Zone and Volume Profile research experiments **only if** they improve objective out-of-sample entry/exit quality.

## How to verify
Run from local checkout: `git pull --ff-only origin main`; `npm run dev`; open `http://localhost:3000`. Check the separate `Limit-входи · горизонт 24 години` section. `recommended24hComplete` now requires the full eligible universe to have been visited within the four-minute confirmation freshness window. With the current 24-instrument rotating batch, this may often remain false until a high-throughput screening stage is implemented. Do not claim the provisional shortlist is a market-wide comparison.
