# Strategy Lab — quality-first intraday research workflow (v0.2)

## Scope and safeguards
This is a **research-only** addition at `/strategy-lab`. The existing scanner, risk management and Bybit Demo order paths are not modified. No new strategy can be promoted to active execution from this UI.

## Current candidates
- **A — MTF baseline:** existing EMA / ATR / swing logic.
- **A1 — Near entry:** existing MTF with distance <= 1 ATR.
- **A2 — Moderate trend:** existing MTF with trend strength < 1 ATR.
- **A3 — Lower volume:** existing MTF with relative volume < 1.2.
- **B — Intraday Quality (research):** MTF setup with minimum score 90/100, full 8/8 conditions, R:R >= 2, entry distance <= 0.75 ATR(30m), stop width 0.8–3 ATR(30m). Limit validity max 3 hours and position maximum holding time 24 hours (not a calendar-day close).

A1–A3 and B are **filters / execution-horizon variants**, not new independent algorithms. They are treated as exploratory baselines only. No claim of enhanced profitability should be made.

## Shared controls
- Eight linear USDT Bybit pairs, 30m/1h/4h/1D.
- Fixed cutoff 2026-11-12T00:00:00Z.
- Local immutable candle snapshots and tick-size metadata, checked against SHA-256.
- Reference and conservative execution on the *same* candles for each candidate.
- No incomplete or failed runs are saved in the journal.
- The journal stores small summaries in browser localStorage (up to 15); full exports contain trade journals and hashes.
- `Net R` across symbols is descriptive only, never portfolio performance. The code does not model correlated simultaneous positions.

## Metrics
No daily trade quota or target exists. The objective is quality of the entry, structurally justified stop/target and post-cost expectation, not frequency. Intraday stop/entry/target thresholds are exploratory hypotheses selected after reviewing this history, never proven profitable. Median trade holding hours is displayed when timestamps are available.

Number of fills, aggregate net R, average R, realized profit factor and stop-hit fraction, first/second-half net R, and fraction of pairs with positive backtests. None independently establishes predictive edge or statistical significance. No approval from a threshold can occur without independent data, walk-forward validation, full risk aggregation and forward Demo results.

## Next development milestones
1. Add **fully separate** candidate strategies with documented price-entry / stop / exit rules, and versioned parameter sets.
2. Build time-based research/validation/holdout partitions and walk-forward folds that explicitly prevent tuning on holdout data.
3. Add portfolio-level exposure, correlated positions, fees/funding and robust fill uncertainty.
4. Log forward paper signals, execution and mismatches between scanner and replay before allowing any demo-trading promotion.

## Procedure
Open `/strategy-lab` and click **Порівняти кандидатів**. The app loads each symbol in sequence using the frozen snapshot backtest API. Review rows and export the study. Test and compare future candidates on precisely the same snapshot; do not call the reused historical period a new holdout. Historical performance is not a promise of future results.

## Future independent algorithm
The quality-first B candidate is **not** the promised independent Trend Pullback strategy. A separate Trend Pullback engine needs explicit pullback, confirmation and state-independent exit rules before it can be evaluated. B is an intermediate safeguard exercise; never claim it improves predictive performance before a new independent period. All new strategies must remain isolated from live scanner and Demo orders until verified.
