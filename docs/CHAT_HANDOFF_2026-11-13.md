# Alpha Pulse — handoff context for a fresh ChatGPT conversation
Updated: 2026-11-13. Source: user-approved chat project history, GitHub code edits and GitHub Actions checks.

> This document is the project's continuity brief. Read current repository source and CI before modifying anything; the document is a dated snapshot, not proof that the user's Mac has fetched the latest commit. Continue in Ukrainian. **Never claim real backtest results, profitability or a local run when they have not been observed.**

## 1. User's vision and working agreement
- Build **Alpha Pulse**: Ukrainian-language market research/trading assistant, initially for Bybit USDT-linear cryptocurrency instruments, expanding to more markets later.
- User wants **actual implementation**, not endless suggestions, mockups, hardcoded example numbers or repeated confirmation. They often say `ок` / `продовжуй` to authorize the already agreed *development work*, **not live trading or unilateral irreversible actions**.
- Primary aim: scan the complete supported and tradable Bybit universe, detect high-quality trade opportunities, show understandable analysis and exact Entry, Stop Loss, Take Profit, protect risk. Do **not** force an arbitrary number of daily signals or treat ranking score as probability of profit.
- Two modes envisioned: Training (explain reasoning) and Trading (concise plans/risks), same visual layout. Large interactive chart (candles, EMA/RSI/MACD), collapsible market watchlist, separate AI assistant/proposal window, cross-symbol scanning, alerts; select a recommendation and open a full plan. On-chart Entry/SL/TP with adjustable handles, saved pairs/timeframes after reload.
- Manual approval of Bybit **Demo** orders is essential. Do not auto-execute orders or relax guards.
- Design requirements from prior chats: dark graphite/indigo, compact headers, usable full-width chart, narrow/collapsible sidebars, legible information and no fabricated demo prices. Current scanner UI has confirmed and pending/review trading plan cards.
- User's local Mac app: `/Users/oleksandrpiatakov/alpha-pulse`. Repository: https://github.com/AleksPiatakov/alpha-pulse ; branch `main`. Local URL http://localhost:3000 after `npm run dev`.
- Updating locally: stop dev server with Ctrl+C, then:
  ```bash
  cd /Users/oleksandrpiatakov/alpha-pulse
  git pull --ff-only origin main
  npm run dev
  ```
  **GitHub edits are not automatically applied to the running local app**. Ask for screenshots/logs only when they materially aid verification. User asked to continue using direct development via GitHub rather than repeated Work handoffs.

## 2. Existing market scanner and controls
- `lib/bybit-universe.ts`: paginated Bybit USDT-linear instrument registry and metadata.
- `lib/market-scan.ts`: batched scan of tradable instruments using 30m,1h,4h,D closed candles, with separate current Demo ticker. Past screenshots showed ~764 available symbols; counts vary by Bybit state, not constants.
- `lib/technical-plan-core.ts`, `lib/trade-planning-engine.ts`: technical calculations and shared plan generation, EMA, ATR, confirmed swing levels, tick rounding, risk/reward.
- `lib/intraday-quality.ts`: exploratory quality filter; preliminary min score=90, readiness=8, RR>=2, distance <=0.75 ATR, stop range 0.8–3 ATR. **These are hypotheses, not empirically validated profit guarantees.**
- `lib/plan-ranking.ts`: quality-passed ACTIVE plans ranked above merely technical ACTIVE plans, then REVIEW.
- `lib/bybit-execution-rules.ts`: read exchange metadata tickSize, qtyStep, minOrderQty, minNotionalValue, fail closed on invalid values. Order endpoint separately rechecks precision.
- `app/api/trade/route.ts`: Bybit Demo order flow with manual confirmation, fresh plan checks, risk caps and maximum active position constraints. Do not change without focused tests. Historically capped risk per trade 1%, up to 3 positions.
- `lib/trade-plan-lifecycle.ts`: distinguish 1h close invalidating *thesis* from actual Bybit stop triggered on MarkPrice, and GTC pending limit orders (do not automatically expire when a signal expires).
- `lib/demo-order-review.ts` + `app/orders/page.tsx`: read-only age warnings for pending Demo orders over 2 hours; manual cancellation preserved.
- `lib/market-observation-clock.ts`: one captured observation time, same closed-bar rule for scanner and historical replay, 30/60/240/D.
- `lib/closed-market-features.ts`: common closed 1h features: 24h close-to-close momentum, 24h turnover and relative 1h volume.
- `lib/market-input-snapshot.ts`: validated SHA256-sealed ticker+instrument+closed bars; `lib/snapshot-parity.ts` independently compares current ticker vs closed 30m price evaluation.
- `GET /api/research/snapshot?symbol=BTCUSDT` returns read-only sealed inputs, plan and parity; `POST /api/research/replay` accepts a previously saved sealed JSON for read-only offline research replay. **Not a historical trade-outcome backtest.**
- `lib/mtf-backtest.ts`, `app/api/backtest/route.ts`, `lib/backtest-snapshot.ts`: existing fixed historical Strategy Lab; 8 reference pairs BTC ETH SOL BNB XRP ADA DOGE AVAX. Past legacy MTF variants produced mostly negative conservative net R, so do not describe as proven edge.

## 3. Independent research strategies already added
- `lib/research-strategies.ts`: experimental, non-executable `StrategyCandidate` contract and two detectors:
  - Trend Pullback v1: aligned 1h/4h trend, pullback to 30m EMA20, completed 30m recovery; ATR-based stop and hypothetical 2R TP.
  - Breakout + Retest v1: closed 30m break of preceding 20-bar level, retest and confirmation; ATR stop and hypothetical 2R TP.
- `lib/research-strategy-backtest.ts`: independent 30m replay, two execution models, commission/slippage, 6-bar pending, 48-bar maximum holding, censorship for data ending before outcomes.
- `app/research-strategies/page.tsx`: UI for eight pairs and two strategies, accessed from Strategy Lab; `GET /api/backtest?...&research=1` includes both experimental studies. No Demo orders enabled.
- Code verified by GitHub CI at https://github.com/AleksPiatakov/alpha-pulse/actions/runs/43277096509 . This is **code verification**, not empirical confirmation of strategy performance.

## 4. NEW user-supplied third strategy: EMA 50 from a video
The user shared a video transcript and five screenshots and asked to test it specifically on BTC, ETH, SOL and also a cohort of genuinely lower-volatility/lesser-known USDT pairs. Do not assume BTC/ETH/SOL are objectively most volatile today; these are user-selected major reference symbols. Use **measured return volatility**, not name recognition or turnover alone, for cohorting.

Video trading rules (the actual basis):
- EMA 50 on 4h (and 1h), current price on the appropriate side and EMA slope aligned; avoid near-flat slope.
- Video settings shown: EMA length 50, compare slope vs 10 candles earlier, flat threshold 0.3%, require 1h EMA touch within last 16 candles, tolerance 0.2%.
- 15m candle must fully **close** across 15m EMA50 in the trend direction for entry confirmation; use only completed candles. Strategy as implemented places hypothetical next-15m-bar open entry to avoid look-ahead.
- Fixed stop **2.5%**, take **7.5% (3R)**, compare with **5% (2R)** without optimizing. Video claims +18.31% result with 27 trades / 33.33% wins / 12.34% drawdown on some displayed example; **these are video claims, not Alpha Pulse test results**.
- Video **does not specify a 24-hour time stop**. A previous code version incorrectly added one; it was corrected on 2026-11-13. Latest model holds until SL/TP; an outcome beyond available history is **censored**, not assigned profit/loss. Same-bar SL+TP => SL-first conservative model.
- `lib/video-ema50-strategy.ts`: independent pure EMA series, slope, 1h touch, 15m close crossing, measured annualized historical hourly return volatility.
- `lib/video-ema50-backtest.ts`: pure research-only walk-forward, next open execution; reference commission 0.055% per side; conservative commission 0.075% per side + 5 bps adverse entry, stop gap +10 bps. Full per-trade journal, total/mean net R, win %, max drawdown R. No orders.
- `lib/video-ema50-history.ts`: public Bybit linear history fetch 15m,1h,4h, exactly 120 or 365 days, pinned end **2026-11-12T00:00:00Z**; checks history coverage/integrity; immutable SHA-256 local data under `.alpha-pulse-ema50-snapshots/`. If incomplete or unavailable, **fail instead of inventing results**.
- `GET /api/research/ema50?symbol=BTCUSDT&days=120` runs the four variants for one symbol.
- `app/ema50-study/page.tsx`: user-facing EMA50 test UI at http://localhost:3000/ema50-study ; navigate via Strategy Lab. Choose 120 or 365 days, click `Запустити порівняння`.
- Group A: BTCUSDT, ETHUSDT, SOLUSDT.
- Candidate Group B: XRPUSDT, ADAUSDT, LTCUSDT, TRXUSDT, XLMUSDT, LINKUSDT, BCHUSDT, ETCUSDT. Pick three with **lowest measured annualized vol** among successfully loaded candidates. This is an exploratory cohort selected on the same sample (selection bias); not truly untouched validation.
- CLI: `node --experimental-strip-types scripts/ema50-market-study.mjs`, optional `EMA50_DAYS=365`; outputs complete JSON to `ema50-study-output/ema50-study-120d.json` or `...365d.json`. This is read-only, public market data, no credentials.
- `.github/workflows/ema50-market-study.yml` runs a 120d GitHub-hosted study and publishes report artifact. **The attempt FAILED**: https://github.com/AleksPiatakov/alpha-pulse/actions/runs/43402858185 . Every symbol was excluded because GitHub runners received invalid (non-JSON) responses from public Bybit endpoint, likely environment/geographic access. Therefore there are currently **NO verified EMA50 real-market performance numbers**. The local Mac may have access; need run there and inspect report. Do not claim study succeeded.
- Tests: `test/video-ema50-study.test.mjs`; code and Next.js build verified in GitHub Actions. Last check for latest documentation+code: https://github.com/AleksPiatakov/alpha-pulse/actions/runs/43403450315 (success).
- **Last repository commit at handoff**: `745975954b` (main, 2026-11-13), corrected EMA50 no-time-stop documentation. Verify latest revision in GitHub before further work. Reference docs: `docs/VIDEO_EMA50_VOLATILITY_STUDY.md`.

## 5. Critical technical issues / next actions
1. **Run actual 120-day EMA50 study on local Mac (or another genuinely Bybit-accessible environment)**. GUI /ema50-study or CLI above. Do not assert success before reading the real export. If direct Bybit public API is blocked locally too, diagnose HTTP status and response type, use official supported historical market data only, don't fabricate values or bypass platform restrictions.
2. Historical source coverage: 365d of 15m candles requires many pages; validate all pages, missing intervals, clock alignment, immutable snapshots and failure handling. 120-day sample is development, not untouched out-of-sample; assess one later period separately.
3. Check EMA50 video detector against visual/chronological bar fixtures: ambiguous semantics of 1h EMA touch window and signal ordering; 1h/4h slope should use only closed history. Ensure stop/take are anchored consistently to actual modeled execution, including spread/slippage and risk denominator.
4. **Important candidate issue to verify**: `evaluateVideoEma50` currently requires 1h and 4h agreement plus 15m *cross*, and uses a percentage threshold relative to each EMA for slope. Video's exact source script was not supplied; implementation is an explicit interpretation, not identical script reproduction. Report any deviations.
5. Compare both 3R and 2R cost modes and sample counts; censor unfinished trades, never count them as winners. Report risk by group, loss distribution, volatility, and unmeasured spread/funding.
6. **Do not enable live/Demo auto-execution or rank EMA50 as validated** until independent out-of-sample/forward demo evidence. Continue UI polish and scanned proposals only on evidence.
7. Potential risk in local CI vs GitHub-hosted study: regular tests/build success says nothing about Bybit access or live backtest validity.

## 6. Reporting discipline
- Speak Ukrainian clearly; user appreciates practical outcomes, concise status and concrete commands, not repeated promises.
- Cite actual GitHub commits and workflow links, mark automated code checks vs runtime tests distinctly.
- When user says `ок` or `продовжуй`, continue the already agreed development stage. Use GitHub connector to read existing code before writes; test/recheck CI.
- Do not confuse an informative screenshot or video blogger's claimed PnL with verified algorithm performance; markets/periods/contracts differ.
- User may open a **new chat** because this one is sluggish. Read this file first, ask only for information not already in this project brief, and resume with EMA50 study results or diagnostics.

## 7. Useful links
- Repo: https://github.com/AleksPiatakov/alpha-pulse
- This handoff document: `docs/CHAT_HANDOFF_2026-11-13.md`
- EMA50 docs: `docs/VIDEO_EMA50_VOLATILITY_STUDY.md`
- Local EMA50: http://localhost:3000/ema50-study
- Local Strategy Lab: http://localhost:3000/strategy-lab
- GitHub code verification: https://github.com/AleksPiatakov/alpha-pulse/actions/runs/43403450315
- GitHub EMA50 data collection failed: https://github.com/AleksPiatakov/alpha-pulse/actions/runs/43402858185
