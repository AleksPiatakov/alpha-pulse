# Frozen-snapshot research parity — stage 7

The experimental `/api/research/snapshot?symbol=BTCUSDT` endpoint now includes `parity`, an independent re-evaluation of the exact sealed data. Two reference modes are compared:
- `ticker-reference`: Bybit Demo quote price, structurally identical candidate requirements to live scanner. The independent implementation must agree on direction, Entry, SL, TP, technical score, readiness, status and research-quality gate. The capture fails closed if differences arise.
- `closed-30m-reference`: same recorded closed 30m/1h/4h/D bars and instrument metadata, but current-price reference becomes the most recent completed 30m close. Field-level differences are explicitly reported instead of being treated as identical.

The new **POST** endpoint `/api/research/replay` accepts a previously downloaded sealed JSON object `{snapshot,sha256}`. It validates the hash and market data, then evaluates **offline without any external market API requests**, returning ticker and candle-reference candidates plus any differences. It never saves data automatically and cannot send orders. Maximum input is 1 MB.

This is a research **candidate replay**, NOT historical trade outcome replay or a profit simulation. The existing `mtf-backtest` historical strategy engine has stricter signal eligibility and can still differ on the same bars, including structural target requirements. A full strategy-execution parity test requires extracting both implementations onto a shared strategy candidate interface, then testing fills/costs independently.

Trade and risk permissions have not changed. No autonomous Demo or live orders. No statistical profitability or strategy edge is claimed.

## How to inspect
1. GET `http://localhost:3000/api/research/snapshot?symbol=BTCUSDT`.
2. Save response JSON. For POST replay use only its `snapshot` and `sha256` fields.
3. Send saved object as JSON body to `http://localhost:3000/api/research/replay`.
4. Examine `closeModeDifferences` and compare `tickerReference` to `closeReference`.

Next: persist snapshots with explicit user opt-in, introduce a common strategy candidate contract for Trend Pullback and Breakout + Retest, and validate strictly on unseen data.
