# Scanner acceleration — full-universe first-pass order (2026-11-18)

## Why the old scan looked empty
The scanner previously analyzed 24 instruments per request with concurrency 4 and default 30s browser polling. A universe of hundreds to 1000+ symbols required many minutes per sweep. It also waited up to 20s for optional AI prose for the first six proposals, slowing each UI refresh. Separately, the strict 24h Limit quality gate may legitimately produce **zero eligible entries** even when many symbols have been inspected.

## Implemented changes
- Coarse-first: one Bybit ticker list for **all eligible contracts** determines priority by observed 24h USDT turnover. `lib/market-scan-scheduler.ts` pins the ordering for each complete sweep; the low-turnover tail is never deleted, guaranteeing eventual coverage if the server keeps running.
- Deep scan per batch increased from 24 to **64 symbols**, bounded **8** symbol workers, each fetching closed 30m, 1h, 4h, 1D candles. No two phases that discard unsupported candidates.
- On-server batch cache reduced to 8s and UI polling to 10s; in-progress requests coalesce. The optional local `npm run scan:worker` still works separately; it is not required while the browser is open.
- A bounded `ClosedCandleCache` prevents fetching the same fully closed timeframe input again before the close boundary changes. Keys contain instrument, timeframe, and completed-bar cutoff; cache has a short 30-minute TTL and an 1800-item memory cap. Incomplete history and failed requests are **not cached**.
- By default `/api/scan` returns technical results immediately without waiting on AI text; callers may explicitly use `?explain=1` for optional richer explanation. The main UI's expandable technical explanations remain available.
- The 24h shortlist is chosen from **all retained plans**, not only the 100 plans visible for exploratory browsing.
- UI shows coverage, deep-scan batch and concurrency, PLUS a filter-stage breakdown: retained plans, ACTIVE, quality-passed, structural entry/TP, and 24h qualifying proposals. This explains no-recommendation outcomes rather than inventing TOPs.
- Full-universe `TOP` status requires all eligible symbols visited **recently** and no rejected network fetch in the sweep. Otherwise proposals are labeled `Кандидат`, never a definitive best-of-market rank.
- Existing Bybit **Demo manual Limit** order API, max 1% risk and position constraints remain unchanged.

## Limitations and next checks
- This is a faster all-market scan, but actual speed depends on Bybit rate limits, network latency and Mac resources; no timed local benchmark was available through GitHub.
- Actual market-wide Top 10 may still be empty because strict structural Entry, structural TP, quality score, alignment and reachability rules have not been calibrated on independent data. **Do not weaken these to fabricate results.**
- Main scanner only runs repeatedly while UI polls or optional worker operates. More robust long-lived background service is a later task.
- Monitor `/api/scan` coverage and failure counts; if errors increase with 8-way concurrency, implement Bybit 429-aware adaptive worker backoff before increasing request throughput further.
- Future: add low-cost all-market 24h filters, then use deep analysis for candidates without starving long-tail markets; independent out-of-sample validation of actual Limit fills and TP/SL outcomes.
