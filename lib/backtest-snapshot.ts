import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReplayBar, ReplayTimeframes } from "./mtf-backtest.ts";

const intervals = ["30", "60", "240", "D"] as const;
const durations = { "30": 1_800_000, "60": 3_600_000, "240": 14_400_000, D: 86_400_000 } as const;
const namePattern = /^[A-Z0-9]{3,24}USDT$/;
const snapshotDir = ".alpha-pulse-backtest-snapshots";
export type MarketSnapshot = {
  schema: 1; symbol: string; cutoff: number; capturedAt: string; tickSize: number;
  source: "bybit-public-linear"; warnings: string[]; pages: number[];
  bars: ReplayTimeframes; sha256: string;
};
type SnapshotContent = Omit<MarketSnapshot, "sha256">;

function canonical(value: SnapshotContent): string { return JSON.stringify(value); }
function digest(value: SnapshotContent): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function filename(symbol: string, cutoff: number): string {
  if (!namePattern.test(symbol) || !Number.isSafeInteger(cutoff) || cutoff < 0) {
    throw Error("Некоректні параметри історичного знімка.");
  }
  return path.join(process.cwd(), snapshotDir, `${symbol}-${cutoff}.json`);
}
function validateBars(bars: ReplayTimeframes, cutoff: number): void {
  for (const interval of intervals) {
    const list = bars[interval];
    if (!Array.isArray(list) || !list.length || list.length > 10_000) {
      throw Error(`Некоректна кількість свічок у знімку ${interval}.`);
    }
    let previous = -1;
    for (const bar of list) {
      if (!bar || !Number.isSafeInteger(bar.time) || bar.time <= previous ||
          bar.time + durations[interval] > cutoff ||
          ![bar.open, bar.high, bar.low, bar.close, bar.volume, bar.turnover].every(Number.isFinite) ||
          !(bar.open > 0 && bar.low > 0 && bar.high >= bar.low) ||
          !(bar.open >= bar.low && bar.open <= bar.high) ||
          !(bar.close >= bar.low && bar.close <= bar.high) ||
          bar.volume < 0 || bar.turnover < 0) {
        throw Error(`Некоректні свічки у знімку ${interval}.`);
      }
      previous = bar.time;
    }
  }
}
export function sealSnapshot(content: SnapshotContent): MarketSnapshot {
  validateBars(content.bars, content.cutoff);
  if (!namePattern.test(content.symbol) || content.schema !== 1 ||
      content.source !== "bybit-public-linear" ||
      !Number.isFinite(content.tickSize) || content.tickSize <= 0 ||
      !Number.isSafeInteger(content.cutoff) ||
      !Array.isArray(content.warnings) || !Array.isArray(content.pages) ||
      content.pages.length !== 4 || !Number.isFinite(Date.parse(content.capturedAt))) {
    throw Error("Некоректні метадані знімка.");
  }
  return { ...content, sha256: digest(content) };
}
export function verifySnapshot(value: MarketSnapshot, symbol: string, cutoff: number): MarketSnapshot {
  if (!value || value.symbol !== symbol || value.cutoff !== cutoff ||
      !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw Error("Знімок не відповідає інструменту або даті.");
  }
  const { sha256, ...content } = value;
  if (digest(content) !== sha256) {
    throw Error("Контрольна сума знімка не збігається: файл змінений.");
  }
  sealSnapshot(content); // refuse malformed or incomplete input even with a valid checksum
  return value;
}
export async function loadSnapshot(symbol: string, cutoff: number): Promise<MarketSnapshot | null> {
  const file = filename(symbol, cutoff);
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return verifySnapshot(JSON.parse(raw) as MarketSnapshot, symbol, cutoff);
}
export async function persistSnapshot(value: MarketSnapshot): Promise<void> {
  verifySnapshot(value, value.symbol, value.cutoff);
  const file = filename(value.symbol, value.cutoff);
  await mkdir(path.dirname(file), { recursive: true });
  // Exclusive write: historical data never silently replaces an earlier research snapshot.
  try { await writeFile(file, JSON.stringify(value), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = await loadSnapshot(value.symbol, value.cutoff);
    if (!previous) throw Error("Не вдалось прочитати збережений знімок.");
    // Another request has already captured the same dataset. It is intentionally immutable.
  }
}
