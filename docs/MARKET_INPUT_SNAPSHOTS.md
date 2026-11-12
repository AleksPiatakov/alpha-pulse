# Market input snapshots — deterministic parity foundation (stage 6)

## Scope
GET `/api/research/snapshot?symbol=BTCUSDT` is an **explicit on-demand, read-only research endpoint**. It returns a Bybit Demo snapshot, SHA-256 integrity checksum and independently evaluated technical plan. It never sends orders, account data, credentials or personal data.

A `schema=alpha-pulse-market-input-v1` snapshot captures:
- One server-captured `observedAt` timestamp used consistently across all frames
- Bybit Demo latest ticker price and 24h ticker context (separate from close-of-bar values)
- Exact available contract metadata including tickSize and lotSizeFilter
- Latest available **closed** 30m, 1h, 4h and daily OHLCV/turnover candle arrays, in chronological order
- Source `bybit-demo` and symbol identity

The snapshot validator refuses mismatched symbols, incomplete histories, malformed or still-forming bars, and invalid tickSize/status. The seal hashes the exact JSON snapshot payload with SHA-256. A test changes one value and verifies that validation detects it.

The scanner can compute a plan directly from a captured snapshot (without refetching), and the endpoint computes it twice to detect nondeterministic result drift. A null plan is a valid result when no setup is supported by those inputs.

## Important limitations
- Research snapshots are returned to the requester; this release does **not** write them to persistent local history automatically. Store a downloaded snapshot securely if you need to compare future program versions.
- SHA-256 detects accidental or deliberate mutation but does NOT prove that a third party's market data was accurate, or that a local snapshot cannot have been substituted.
- This is parity of **the scanner evaluated twice on identical inputs**. The historical replay has NOT yet been adapted to replay live snapshots; do not claim full cross-engine parity.
- A ticker quote and closed candle are different price concepts. The scanner's current price is a live market quote while a historical replay normally uses last closed 30m close.
- Historic public Bybit and Demo quote feeds may differ; old Strategy Lab exports are not automatically equivalent to the new snapshot format.
- No new strategy or statistical evidence of positive expectation is introduced. Demo order validation/risk and manual confirmation remain unchanged.

## Next steps
Build a fully pure scanner signal evaluator that consumes `MarketInputSnapshot` and reuse it in point-in-time replay fixtures; automate mismatch reports with explicit source/clock/precision differences before adding independent Trend Pullback and Breakout/Retest engines.
