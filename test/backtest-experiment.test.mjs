import assert from "node:assert/strict";
import { test } from "node:test";
import { passesExperimentFilter, REPLAY_VARIANTS } from "../lib/mtf-backtest.ts";

test("original four baseline hypotheses remain unchanged; quality candidate added explicitly", () => {
  assert.deepEqual(REPLAY_VARIANTS.slice(0, 4).map((variant) => variant.key), [
    "baseline", "near-entry", "moderate-trend", "lower-volume",
  ]);
  assert.equal(REPLAY_VARIANTS[4]?.key, "intraday-quality");
});

test("near-entry gate rejects an entry more than 1 ATR away", () => {
  const features = { distanceAtr: 1.01, trendStrengthAtr: 0.5, relativeVolume: 1 };
  assert.equal(passesExperimentFilter("baseline", features), true);
  assert.equal(passesExperimentFilter("near-entry", features), false);
  assert.equal(passesExperimentFilter("near-entry", { ...features, distanceAtr: 1 }), true);
});

test("moderate trend and volume gates only use decision-time features", () => {
  const features = { distanceAtr: 0.5, trendStrengthAtr: 1, relativeVolume: 1.2 };
  assert.equal(passesExperimentFilter("moderate-trend", features), false);
  assert.equal(passesExperimentFilter("lower-volume", features), false);
  assert.equal(passesExperimentFilter("moderate-trend", { ...features, trendStrengthAtr: 0.99 }), true);
  assert.equal(passesExperimentFilter("lower-volume", { ...features, relativeVolume: 1.19 }), true);
});

test("invalid feature values fail closed for every research variant", () => {
  for (const variant of REPLAY_VARIANTS) {
    assert.equal(passesExperimentFilter(variant.key, {
      distanceAtr: Number.NaN, trendStrengthAtr: 0.7, relativeVolume: 1,
    }), false);
  }
});
