# Alpha Pulse — priority scanning and candidate-history audit (2026-11-20)

## Scope implemented

- Strict TOP-10 selection policy is unchanged: ACTIVE, quality gate, structural
  Entry/TP, historical 24h reachability and R:R >= 2.
- Priority rechecks: at most 8 additional deep analyses per full-sweep batch.
  Candidates: ACTIVE 8/8 with score >=90 or near-ready 7/8 with score >=85.
  Minimum recheck age 60 seconds; records older than 45 minutes excluded.
- Priority checks never move the pinned all-market sweep cursor or authorize orders.
- The worker and scan API now expose real measured batch duration
  (`batchDurationMs`) and number of additional priority analyses.
- The main dashboard shows the two metrics and a *research-only* subset of
  near-ready 7/8 candidates from the currently retained plans.
- Local JSONL scenario-transition history: `.alpha-pulse-history/events.jsonl`.
  Contains no credentials. Records READY, NEAR_READY, WATCHING, WITHDRAWN,
  UNVERIFIED transitions and substantial price-level changes; 20 MB rotation.
  Local file storage is not cross-device/cloud storage. Errors do not block scans.
- Read-only `/api/scenario-history?limit=40` supports an expandable panel.
- CI added to run focused regression tests, TypeScript and Next production build.

## Safety and interpretation

- 7/8 is **never a confirmed trade**; no automatic order placement.
- Production risk caps and quality thresholds have not been loosened.
- "Full sweep covered" is not "all pairs fresh": 4-minute confirmation freshness
  is deliberately maintained for trade eligibility.
- Additional deep checks consume Bybit requests and can increase batch latency.
  Do not raise scan concurrency or reduce rate limits without empirical timings.
- Market-size, scan latency and ready counts in screenshots are observations,
  not an estimate of profitable setups or an evidence-based daily signal target.

## Validation steps on the user's Mac

1. Stop/restart Next.js after `git pull --ff-only origin main`.
2. Run focused tests: `node --experimental-strip-types --test test/priority-recheck.test.mjs test/near-entry-recheck.test.mjs test/scan-freshness.test.mjs test/scenario-event-journal.test.mjs`.
3. Run `npx tsc --noEmit` and `npm run build`; fix any failures before relying on changes.
4. In a second terminal run `npm run scan:worker`.
5. Measure actual `batchDurationMs`, `priorityRechecked`, total sweep duration,
   fresh/stale/error counts and HTTP/API rate-limit errors over several cycles.
6. Check that history remains after a server restart and that lost API access
   never turns a scenario into READY.
7. Recheck strict TOP and Demo Limit eligibility against the original gates;
   do **not** test real-money execution.

## Remaining work (not claimed complete)

- Independent short-interval ticker monitoring and backpressure-aware request
  optimization, based on measured timings.
- Durable *all-pair* aggregated rejection statistics across 24 hours.
- Historical replay of alternative thresholds against the same frozen Bybit
  market inputs, accounting for fills, stop/target paths, fees and drawdown.
  Do not adopt alternative thresholds solely because they produce more signals.
- Full running UI and Bybit integration verification on the user's machine.

No measured performance improvement or profitability is claimed until the
validation above passes.
