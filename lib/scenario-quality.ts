export type Direction = "LONG" | "SHORT";
export type QualityInput = {
  direction4h: Direction | null;
  direction1h: Direction | null;
  direction30m: Direction | null;
  relativeVolume: number;
  change24h: number;
  turnover24h: number;
  rewardRisk: number;
  distanceAtr: number;
  pivot1h: boolean;
  pivot4h: boolean;
  pivotDaily: boolean;
  hasTargetLevel: boolean;
};
export type QualityResult = { score: number; status: "ACTIVE" | "REVIEW"; checks: string[] };

// A deterministic, comparative ranking. It is not a probability or a forecast of P&L.
export function evaluateScenarioQuality(input: QualityInput): QualityResult {
  const aligned = input.direction4h !== null &&
    input.direction4h === input.direction1h &&
    input.direction1h === input.direction30m;
  const momentum = input.direction4h === "LONG"
    ? input.change24h > 0.003
    : input.direction4h === "SHORT" && input.change24h < -0.003;
  const levelStrength = Number(input.pivot1h) + Number(input.pivot4h) + Number(input.pivotDaily);
  const volumeConfirmed = Number.isFinite(input.relativeVolume) && input.relativeVolume >= 0.9;
  const liquid = Number.isFinite(input.turnover24h) && input.turnover24h >= 20_000_000;
  const rrConfirmed = Number.isFinite(input.rewardRisk) && input.rewardRisk >= 1.5;
  const nearby = Number.isFinite(input.distanceAtr) && input.distanceAtr <= 2.5;
  const structured = input.pivot1h || input.pivot4h || input.pivotDaily;
  const ready = aligned && momentum && volumeConfirmed && liquid && rrConfirmed &&
    nearby && structured && input.hasTargetLevel;
  const checks = [
    !aligned && "Тренди 4h/1h/30m не узгоджені",
    !momentum && "Добовий імпульс не підтверджений",
    !volumeConfirmed && "Обсяг останньої закритої 1h свічки слабкий",
    !liquid && "Оборот за 24 години нижче 20 млн USDT",
    !structured && "Підтверджений рівень 1h/4h/1D відсутній",
    !input.hasTargetLevel && "Денна ціль не підтверджена",
    !rrConfirmed && "R:R нижче 1:1.5",
    !nearby && "Limit-вхід далеко від поточної ціни",
  ].filter((item): item is string => typeof item === "string");
  const trendPoints = (input.direction4h ? 7 : 0) +
    (input.direction1h === input.direction4h && input.direction4h ? 7 : 0) +
    (aligned ? 10 : 0);
  const levelPoints = Math.min(18, levelStrength * 6);
  const volumePoints = Math.min(10, Math.max(0, (input.relativeVolume - 0.5) * 10));
  const rrPoints = Math.min(16, Math.max(0, (input.rewardRisk - 0.5) / 1.9 * 16));
  const distancePoints = Math.min(12, Math.max(0, (1 - input.distanceAtr / 5) * 12));
  const liquidityPoints = Math.min(10, Math.max(0, input.turnover24h / 20_000_000 * 10));
  const momentumPoints = momentum ? 6 : 0;
  const targetPoints = input.hasTargetLevel ? 4 : 0;
  const score = Math.max(1, Math.min(100, Math.round(
    trendPoints + levelPoints + volumePoints + rrPoints +
    distancePoints + liquidityPoints + momentumPoints + targetPoints
  )));
  return { score, status: ready ? "ACTIVE" : "REVIEW", checks };
}
