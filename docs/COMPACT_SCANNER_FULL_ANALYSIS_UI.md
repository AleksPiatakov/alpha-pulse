# Compact scanner → full-page scenario analysis (2026-11-18)

## Approved user experience
Home is a fast market overview, **not** a place for full trade instructions. Each compact, keyboard-focusable card shows the instrument, LONG/SHORT, tentative vs confirmed research status, Limit level, score/readiness/R:R, and optionally TP/SL. Clicking anywhere on the card opens a dedicated full-width **/analysis/[symbol]** page. Do not use small overlays or force a separate browser tab for internal analysis. Only the external Bybit chart opens a new tab.

## Detailed analysis page
- Separate full-width page for every instrument; distinct from the existing `/trade/[symbol]` Demo execution page.
- Above the fold: verified status, one-sentence current interpretation, Entry / Zone / TP / SL row, current quote, R:R, observation timestamp and 24h Entry search window **in Europe/Ljubljana**.
- Interactive TradingChart reuses the existing component with all its timeframe choices.
- Explicit confirmed/pending conditions for ACTIVE, quality gate, structural Entry/TP, historical 24h reachability and R:R.
- Detailed technical facts, lifecycle invalidation, actual Stop Loss semantics, GTC caveats and risk guidance are expandable, not spammed across the overview.
- A separate expandable **AI review** is intentionally **on demand**. `GET /api/analysis/[symbol]` first independently reconstructs the current Bybit Demo technical plan; `?ai=1` subsequently calls the OpenAI Responses API with those facts. The output is structured into seven educational sections: market context, entry logic, confirmations, invalidation, risk, beginner explanation, and next action. No orders or account updates.
- If `OPENAI_API_KEY` is absent, invalid, rate-limited or OpenAI is inaccessible, the UI displays a precise error; it never invents an AI analysis or silently labels static analysis as AI.
- AI information is bound to the returned reverified plan, not an arbitrary localStorage snapshot. A 60-second read-only refresh uses current market facts; old AI text is hidden if strategy/levels/quality change, but preserved if only the quote refreshes.
- Historical or unavailable plan stored in browser may still be viewed with a conspicuous **not current / not order-ready** warning. It never authorizes a Demo order.
- A trading order remains on the pre-existing manual execution route, subject to separate backend verification and risk checks. Do NOT re-add execute/submit to the analysis-only page.

## Tests and follow-up
- CI: Node unit tests, TypeScript, ESLint and Next production build.
- Check usability at 1280px and a narrow mobile viewport; 4-column pricing may wrap values to preserve full precision.
- Next: make dynamic conditional-watchlist scenarios persistent and explain what price/closed-candle change will make them eligible; avoid interpreting raw readiness flags as calibrated market forecasts.
- AI availability requires checking actual local environment configuration, not merely existence of code: a working key and reachable Responses API; no key should ever be committed.
