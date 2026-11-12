# Quality-first ranking and Bybit instrument precision — stage 3

## Implemented
- `lib/plan-ranking.ts`: deterministic ranking. ACTIVE plans that pass the research-only quality gate rank above technically ACTIVE plans that fail the gate, even when a failing plan is closer to the current entry zone. REVIEW and INVALID remain below ACTIVE. Neither status guarantees profitability.
- `lib/bybit-execution-rules.ts`: validates instrument Trading status, USDT settlement, tickSize, qtyStep, minOrderQty, minNotionalValue; validates submitted Entry/SL/TP price increments, quantity increment and order minimums. Missing critical rules block Demo execution.
- `lib/market-scan.ts`: obtains metadata from the paginated Demo instrument registry, uses each instrument's tickSize for planned Entry/SL/TP and zone, and uses fresh symbol metadata for server-side pre-order recomputation. Missing metadata fails closed (no plan).
- `app/api/trade/route.ts`: independently re-requests current Bybit Demo instrument metadata and rejects invalid price/qty steps before continuing account/risk checks and before attempting order creation. Existing Demo-only guard, 1% max risk, 3 active slot cap and manual user confirmation remain unchanged.
- `test/plan-ranking-and-precision.test.mjs`: regression cases for prioritization, instrument precision and fail-closed metadata validation.

## Explicit limitations
This is not a proven strategy edge, not a live trade instruction, and not a full scanner/backtest parity certification. The scanner uses current Demo ticker data while replay uses historic public closed candles. Fees, funding, order book depth, current bid/ask spread, tick-based order queue and historical parameter changes still need audited treatment.

The latest scanner levels can differ from older decimal-rounded levels: clients must refresh after pulling this change. Demo order requests are independently revalidated against current metadata and the current plan. A Bybit instrument unsupported by valid metadata is skipped, not guessed.

## Next stages
Time-consistent observation snapshots and shared market data adapters; full signal-to-execution audit trail; independent Trend Pullback and Breakout/Retest engines; cost-aware performance/risk ranking backed by untouched out-of-sample data.
