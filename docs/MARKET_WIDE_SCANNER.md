# Alpha Pulse: market-wide scanner architecture (stage 1)

## Goal
Discover and continuously revisit **every API-visible, currently Trading, USDT-settled linear Bybit contract** supported by the current Alpha Pulse strategy/order model. No arbitrary top-8/top-20 instrument cap is allowed in *discovery*. Illiquid or otherwise unsuitable contracts may be rejected only after discovery, with an auditable reason.

The scope is deliberately precise: **Bybit Demo linear USDT**. Spot, inverse contracts, USDC-settled products, options and other asset classes are *not yet supported* by the current strategy engine. They must not be represented as analyzed or order-ready. Expansion requires product-specific data feeds, risk/precision and order validation.

## Implemented in stage 1
1. `lib/bybit-universe.ts` fetches `/v5/market/instruments-info?category=linear&limit=1000` across **all cursor pages**, failing closed on errors/repeated cursors. Filters to `status=Trading`, USDT quote and settlement, and supported linear contract types.
2. The scanner caches the complete registry 10 minutes, intersects it with current tickers, then scans the resulting universe in a **stable alphabetical rotation**. One pass is 24 symbols at a time, concurrency 4, not a universe cap. The source is `api-demo.bybit.com` to preserve existing Demo scanner behavior and pre-order verification.
3. The scanner includes `universePages`, `universeInstruments`, `coveragePercent`, `cycleCompleted`, `completedSweeps`. `covered` means **attempted in the current sweep**, including failed fetches. The existing `rejectionCounts` are for the **current batch only**, not a lifetime market-wide error total.
4. Start the optional independent local poller with `npm run scan:worker` in a separate terminal while `npm run dev` runs. It calls the metadata-only endpoint `/api/scan/worker` every 30 seconds, without repeated AI explanations and **without placing orders**. The scanner's in-memory state belongs to the running Next.js process. Closing the browser does not stop scanning when this worker is running, but stopping the server or worker does.
5. The visible main dashboard shows registry and sweep coverage.

## Constraints / next work
- The first stage is **not** persistent scanning in the cloud or across a server restart. A durable local SQLite state store, snapshot journal and restart recovery remain to be built.
- Demo and public market inventories may differ. Do **not** claim all public Bybit assets are covered until a separate public-source discovery/adaptation layer is built and cross-checked with demo order availability.
- The list of **plans displayed** is intentionally limited to 100 entries. This is a presentation cap, not an analysis cap.
- A completed sweep is not a claim of successful full-depth analysis for every contract. API failures and insufficient candles remain explicit blockers.
- Existing score is a deterministic rule-based rank, **not a calibrated probability or demonstrated statistical trading edge**. No automatic order placement is introduced.
- Replay/scanner point-in-time parity, tickSize/qtyStep validation, independent Trend Pullback, Breakout/Retest, cost-aware trade-quality ranking, full-market backtests, portfolio risk, promotion gates, and Demo forward tracking remain scheduled milestones.
- The old eight-symbol historical Strategy Lab sample is **research only**, not evidence that a future full-universe selected strategy is profitable.
- No automatic reconfiguration or alteration of existing Demo credentials or orders.

## Operator commands
1. Start Next.js locally with `npm run dev`.
2. In a second terminal run `npm run scan:worker`.
3. Open `http://localhost:3000/` and monitor coverage. Close browser if desired; keep both processes running.
4. Stop worker with Ctrl+C. It cannot place an order.

## Verification
`test/bybit-universe.test.mjs` covers 1150 mock instruments, pagination, repeated cursor rejection, and stable ticker matching. Run CI tests/build before considering this stage stable.
