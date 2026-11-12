// Pure, point-in-time calculations shared by the live scanner and closed-candle replay.
// No network access, order placement, clock reads, or assumed ticker values here.
export type PriceBar = { high: number; low: number; close: number };
export type TechnicalDirection = "LONG" | "SHORT";

export function emaValues(values: number[], period: number): number {
  if (values.length < period || period <= 0) return NaN;
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (const close of values.slice(period)) value += alpha * (close - value);
  return value;
}

export function emaBars(bars: PriceBar[], period: number): number {
  return emaValues(bars.map((b) => b.close), period);
}

export function trendBars(bars: PriceBar[]): TechnicalDirection | null {
  if (bars.length < 50) return null;
  const price = bars.at(-1)!.close;
  const fast = emaBars(bars, 20), slow = emaBars(bars, 50);
  if (price > fast && fast > slow) return "LONG";
  if (price < fast && fast < slow) return "SHORT";
  return null;
}

export function atrBars(bars: PriceBar[]): number {
  const recent = bars.slice(-15);
  if (recent.length !== 15) return NaN;
  const ranges = recent.slice(1).map((bar, i) =>
    Math.max(bar.high - bar.low, Math.abs(bar.high - recent[i].close),
      Math.abs(bar.low - recent[i].close)));
  return ranges.reduce((sum, n) => sum + n, 0) / 14;
}

// Pivots require two fully completed bars on either side of the candidate.
export function confirmedSwingLevels(
  bars: PriceBar[], direction: TechnicalDirection, price: number,
  kind: "support" | "target" = "support",
): number[] {
  const levels: number[] = [];
  const useLow = kind === "support" ? direction === "LONG" : direction === "SHORT";
  for (let i = 2; i < bars.length - 2; i++) {
    const level = useLow ? bars[i].low : bars[i].high;
    const neighbors = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]]
      .map((b) => useLow ? b.low : b.high);
    if (neighbors.every((n) => useLow ? level < n : level > n) &&
      (kind === "support" ? (direction === "LONG" ? level < price : level > price) :
        (direction === "LONG" ? level > price : level < price))) {
      levels.push(level);
    }
  }
  return levels;
}

export function nearestSwingLevel(
  bars: PriceBar[], direction: TechnicalDirection, price: number,
): number | null {
  const levels = confirmedSwingLevels(bars, direction, price, "support");
  if (!levels.length) return null;
  return direction === "LONG" ? Math.max(...levels) : Math.min(...levels);
}

export function nearestAcrossTimeframes(
  levels: Array<number | null>, direction: TechnicalDirection,
): number | null {
  const valid = levels.filter((level): level is number => level !== null);
  return valid.length ? direction === "LONG" ? Math.max(...valid) : Math.min(...valid) : null;
}

export function stopFromAtr(
  direction: TechnicalDirection, entry: number, atr1h: number, atr30m: number,
): number {
  const risk = Math.max(atr1h * 1.25, atr30m * 2);
  return direction === "LONG" ? entry - risk : entry + risk;
}

export function structuralTarget(
  direction: TechnicalDirection, entry: number, stop: number, daily: PriceBar[],
): number | null {
  const candidates = confirmedSwingLevels(daily, direction, entry, "target");
  if (!candidates.length) return null;
  const risk = Math.abs(entry - stop);
  const ideal = entry + (direction === "LONG" ? 2.4 : -2.4) * risk;
  const obstacle = direction === "LONG" ? Math.min(...candidates) - 0.05 * risk
    : Math.max(...candidates) + 0.05 * risk;
  return direction === "LONG" ? Math.min(ideal, obstacle) : Math.max(ideal, obstacle);
}

export function rewardRisk(
  direction: TechnicalDirection, entry: number, stop: number, target: number,
): number {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return NaN;
  const reward = direction === "LONG" ? target - entry : entry - target;
  return reward / risk;
}
