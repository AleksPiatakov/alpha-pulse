# Pending scenario lifecycle (2026-11-18) — agreed Alpha Pulse roadmap

## Intent
Keep the approved Bybit Demo architecture, existing risk policy, manual order confirmation, and separate full-page analysis. User-supplied videos about other brokers/agents are research only; no Alpaca migration or unattended execution.

Alpha Pulse should not show an entirely empty home merely because no pending Limit order passes strict 24h quality. Instead, it should show **technically computed conditional setups**, clearly distinct from ready-for-review opportunities. A setup is not a calibrated prediction, fill probability, or order instruction.

## First implemented stage
- New pure lifecycle in `lib/scenario-watchlist.ts`.
- States: `WATCHING` (explicit missing conditions), `READY_FOR_REVIEW` (passes the existing strict 24h research filter), `STALE` (not rechecked for 4 minutes), `NO_CURRENT_PLAN` (a fresh complete analysis yielded no candidate), `EXPIRED` (24h since first observation).
- On fresh review, retain the original 24h deadline for the **same direction** instead of extending it indefinitely. Reversal or a fresh independent forecast after expiry begins a new watch episode.
- Pending conditions are deterministic flags: ACTIVE, quality filter, structural Entry/TP, historical 24h excursion, minimum 1:2 R:R. These are disclosed as **missing requirements**, not invented price triggers or news-based predictions. In particular, the historical touch rate does not give a fill probability.
- Only scenarios with fresh, existing incomplete conditions enter the visible pending cards; up to 20, sorted by existing confirmations/technical score/R:R, not labeled TOP. Clicking opens `/analysis/[symbol]`. Cards show timezone-local deadline using `Europe/Ljubljana`.
- The separately verified strict TOP 10 remains unchanged. Neither WATCHING nor READY_FOR_REVIEW authorizes an order. All real Demo submissions still need their existing independent verification and explicit user action.
- A failed network request is **not** treated as market invalidation. Full scans age their previous stored scenarios; completed scans returning no valid candidate mark `NO_CURRENT_PLAN` without inventing a confirmed reversal.
- `/api/scan` includes `watchedScenarios` and `watchStatusCounts`. Optional independent scanner worker endpoint exposes only counts, and the existing `npm run scan:worker` logs them.
- Regression tests: `test/scenario-watchlist.test.mjs`, including explicit ready/manual-only state, no automatic promotion on stale data, 24h deadline, and direction reversal.

## Important limitations, not yet implemented
- Watch data is **in-memory only within the local Next.js process**, lost on server restart. Durable disk persistence, event journal and restart recovery remain next-stage tasks.
- There is no push notification or calibrated likelihood of future price reaching Entry, no objective 15m bounce confirmation yet, and no explicit price trigger engine beyond the current multi-timeframe scanner's conditions.
- The independent worker must be **started separately** using `npm run scan:worker` and requires the Next.js server running. It does not start automatically with `npm run dev`. Browser polling also advances scans. Machine sleep, process exit or network outage pauses monitoring.
- Conditions currently describe which research checks are missing, not a promise that the market will move or a safe pre-confirmation Limit order.
- Full-universe readiness still requires complete fresh coverage; this is not guaranteed by a partial scan batch.

## Next implementation priorities
1. Add durable local watch-state persistence and a bounded event journal so pending scenarios survive server restart and can be audited.
2. Add explicit event-trigger rules for proximity to confirmed structural zones, completed 15m confirmation and invalidation, using only market data already available at each decision time.
3. Add clear user notifications for status transitions, not repeated noisy messages on each poll.
4. Independently test actual 24h Entry reach and subsequent fills/fees without weakening the quality gates or claiming prediction certainty.
5. Later optimize long-running scanner scheduling and local startup, preserve manual Demo order safety.

## Local commands
```bash
cd /Users/oleksandrpiatakov/alpha-pulse
git pull --ff-only origin main
npm run dev
```
For scanning while no browser page is open, start a **second terminal** in that same folder and run `npm run scan:worker`. Both processes must remain running. The current worker is read-only and does not place orders.
