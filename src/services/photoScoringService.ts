/**
 * photoScoringService.ts
 *
 * Implements composite quality scoring and best-shot recommendation per batch.
 *
 * Performance Philosophy:
 * - Reuses existing PhotoQualityResult fields (blur, face, overExposure, eyesOpen,
 *   sharpnessScore, exposureScore, faceCount, closedEyeCount) already computed by Skia/ML Kit.
 * - Zero new decode, ML Kit, or Skia computation. Pure O(1) mathematical scoring per photo.
 * - Enables collapsed-by-default batch UI to render only 1 hero photo per batch at scale (1000+ photos).
 */

import { PhotoQualityResult } from './photoQualityService';

// ── SCORING WEIGHTS & CONSTANTS (Configurable for calibration) ─────────────────
/**
 * Note: These weights represent a calibrated starting baseline.
 * As with blur and exposure thresholds, weights can be adjusted based on
 * empirical evaluation against real event photos.
 */
export const SHOT_SCORE_WEIGHTS = {
  FACE_DETECTED: 25,
  NOT_BLURRY: 25,
  NOT_OVEREXPOSED: 20,
  ALL_EYES_OPEN: 20,
  SHARPNESS_CONTINUOUS_MAX: 5,
  EXPOSURE_CONTINUOUS_MAX: 5,
  CLOSED_EYES_MAX_PENALTY: 10,
};

// Normalization ceilings for continuous metrics
const SHARPNESS_NORMALIZATION_CEILING = 200.0; // Scaled for 256px Laplacian variance
const EXPOSURE_NORMALIZATION_CEILING = 20.0; // Percentage of clipped highlights

/**
 * Normalizes a continuous value into the [0, 1] range.
 */
function normalize(value: number | undefined, maxCeiling: number): number {
  if (value === undefined || isNaN(value) || value <= 0) return 0;
  return Math.min(1.0, Math.max(0.0, value / maxCeiling));
}

/**
 * Computes a composite quality score (0 - 100 scale) for a photo based on its PhotoQualityResult.
 *
 * Scoring breakdown:
 * - +25 pts: Has detected face(s)
 * - +25 pts: Not blurry (Laplacian variance >= BLUR_THRESHOLD)
 * - +20 pts: Not overexposed (Clipped highlights <= EXPOSURE_THRESHOLD)
 * - +20 pts: All detected faces have eyes open (closedEyeCount === 0)
 * - +0..5 pts: Continuous sharpness score (higher sharpness gives a small boost / tiebreaker)
 * - +0..5 pts: Continuous exposure balance (lower highlight clipping gives a small boost)
 * - -0..10 pts: Proportional penalty for partial eye-closures in group photos
 */
export function computeShotScore(result?: PhotoQualityResult | null): number {
  if (!result) return 0;

  let score = 0;

  // Primary discrete signals
  if (result.face) {
    score += SHOT_SCORE_WEIGHTS.FACE_DETECTED;
  }
  if (!result.blur) {
    score += SHOT_SCORE_WEIGHTS.NOT_BLURRY;
  }
  if (!result.overExposure) {
    score += SHOT_SCORE_WEIGHTS.NOT_OVEREXPOSED;
  }
  if (result.eyesOpen) {
    score += SHOT_SCORE_WEIGHTS.ALL_EYES_OPEN;
  }

  // Continuous fine-grained tiebreakers
  const normSharpness = normalize(result.sharpnessScore, SHARPNESS_NORMALIZATION_CEILING);
  score += normSharpness * SHOT_SCORE_WEIGHTS.SHARPNESS_CONTINUOUS_MAX;

  const normExposure = normalize(result.exposureScore, EXPOSURE_NORMALIZATION_CEILING);
  score += (1.0 - normExposure) * SHOT_SCORE_WEIGHTS.EXPOSURE_CONTINUOUS_MAX;

  // Proportional eye closure penalty for group photos (e.g. 1 out of 5 eyes closed is a milder penalty than 1 out of 1)
  if (
    result.faceCount &&
    result.faceCount > 0 &&
    result.closedEyeCount &&
    result.closedEyeCount > 0
  ) {
    const closedRatio = Math.min(1.0, result.closedEyeCount / result.faceCount);
    score -= closedRatio * SHOT_SCORE_WEIGHTS.CLOSED_EYES_MAX_PENALTY;
  }

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

/**
 * Finds the best-shot photo ID within a list of photos with quality results.
 * Returns the photo ID with the highest composite shot score.
 * In case of a tie, preserves the earliest photo (stable deterministic order).
 */
export function selectBestShotId<T extends { id: string; qualityResult?: PhotoQualityResult }>(
  photos: T[],
): { bestShotId: string | null; bestScore: number } {
  if (!photos || photos.length === 0) {
    return { bestShotId: null, bestScore: 0 };
  }

  let bestPhotoId: string | null = photos[0].id;
  let highestScore = -1;

  for (const photo of photos) {
    const score = computeShotScore(photo.qualityResult);
    if (score > highestScore) {
      highestScore = score;
      bestPhotoId = photo.id;
    }
  }

  return {
    bestShotId: bestPhotoId,
    bestScore: Math.max(0, highestScore),
  };
}
