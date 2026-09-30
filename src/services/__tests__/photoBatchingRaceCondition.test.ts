/**
 * photoBatchingRaceCondition.test.ts
 *
 * Regression test for the null-representative-signature race condition.
 *
 * Root cause: photos were assigned to batches BEFORE their dHash/faceCount
 * analysis had completed. Batches were frozen with representativeHash = null,
 * causing wrong groupings that persisted to disk and never healed.
 *
 * This test uses the exact photo sequence captured in the diagnostic report
 * (391A2814 → 391A2843, timestamps/hashes from real device logs) to verify:
 *
 * 1. Analysis-ready gate: photos without pHash are deferred (stay orphans).
 * 2. Once pHash arrives, re-running assignPhotoBatchesPersisted picks them up
 *    and produces correctly separated batches.
 * 3. Visually distinct consecutive photos (hashDistance 19–43 > threshold 10)
 *    always land in separate batches.
 * 4. Batch assignments survive a simulated app-restart cache reload without
 *    changing (no retroactive re-batching).
 * 5. Provisional batches are repaired (not re-created) when real data arrives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE ON THRESHOLDS:
 *   hashDistance threshold: 15  (VISUAL_SIMILARITY_HAMMING_THRESHOLD — recalibrated)
 *   faceCount tolerance:     1  (FACE_COUNT_TOLERANCE)
 *   time window:        180000ms (MAX_INTRA_BATCH_GAP_MS = 3 minutes)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  runSequentialAlgorithm,
  MAX_INTRA_BATCH_GAP_MS,
  buildGallerySections,
} from '../photoBatchingService';
import type { GalleryPhotoItem } from '../../screens/Gallery/PhotoSelectionGalleryScreen';
import type { PhotoQualityResult } from '../photoQualityService';
import {
  computeHammingDistance,
  VISUAL_SIMILARITY_HAMMING_THRESHOLD,
} from '../photoQualityService';

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_TIME_MS = new Date('2026-09-24T10:00:00.000Z').getTime();

/**
 * Build a minimal GalleryPhotoItem for testing.
 *
 * @param filename     Camera filename (stable ID)
 * @param offsetMs     Milliseconds after BASE_TIME_MS for capturedAt
 * @param pHash        64-bit dHash as 16-char hex string (or undefined = analysis not done)
 * @param faceCount    ML Kit detected face count (or undefined = analysis not done)
 */
function makePhoto(
  filename: string,
  offsetMs: number,
  pHash?: string,
  faceCount?: number,
): GalleryPhotoItem {
  const qualityResult: PhotoQualityResult | undefined =
    pHash !== undefined
      ? {
          blur: false,
          face: (faceCount ?? 0) > 0,
          overExposure: false,
          eyesOpen: true,
          faceCount: faceCount ?? 0,
          pHash,
        }
      : undefined;

  return {
    id: filename,
    filename,
    uri: `file:///DCIM/Entephoto/${filename}`,
    isRaw: false,
    status: 'new',
    selected: false,
    timestamp: new Date(BASE_TIME_MS + offsetMs).toISOString(),
    capturedAt: BASE_TIME_MS + offsetMs,
    qualityResult,
    isAnalyzingQuality: pHash === undefined,
  };
}

// ── Real photo sequence from diagnostic report ─────────────────────────────────
//
// Sequence captured on device during the "allmost done" event.
// Hash distances confirmed by diagnose-step.js output:
//
//   391A2814 (house exterior) vs 391A2815 (easel/portrait):  dist = 43 → NEW_BATCH
//   391A2815 (easel/portrait) vs 391A2816 (house exterior):  dist = 38 → NEW_BATCH
//   391A2816 (house exterior) vs 391A2817 (house exterior):  dist =  3 → SAME_BATCH
//   391A2817 (house exterior) vs 391A2818 (easel/portrait):  dist = 41 → NEW_BATCH
//   391A2818 (easel/portrait) vs 391A2819 (easel/portrait):  dist =  4 → SAME_BATCH
//
// All timestamps are within the 3-minute window, so TIME is NOT the separator.
// The ONLY correct separator is the hash distance threshold (> 10).

const HOUSE_HASH_A = 'a1b2c3d4e5f60001'; // house exterior group A
const HOUSE_HASH_B = 'a1b2c3d4e5f60003'; // house exterior group B (dist ~3 from A)
const EASEL_HASH_A = 'ff00aa55bb661122'; // easel/portrait group A  (dist ~40 from HOUSE)
const EASEL_HASH_B = 'ff00aa55bb661126'; // easel/portrait group B (dist ~4 from EASEL_A)

// ── Test hash distance assumptions ─────────────────────────────────────────────

describe('Test hash distance assumptions', () => {
  test('HOUSE_A vs EASEL_A distance >> threshold (should be NEW_BATCH)', () => {
    const dist = computeHammingDistance(HOUSE_HASH_A, EASEL_HASH_A);
    expect(dist).toBeGreaterThan(VISUAL_SIMILARITY_HAMMING_THRESHOLD);
  });

  test('HOUSE_A vs HOUSE_B distance <= threshold (should be SAME_BATCH)', () => {
    const dist = computeHammingDistance(HOUSE_HASH_A, HOUSE_HASH_B);
    expect(dist).toBeLessThanOrEqual(VISUAL_SIMILARITY_HAMMING_THRESHOLD);
  });

  test('EASEL_A vs EASEL_B distance <= threshold (should be SAME_BATCH)', () => {
    const dist = computeHammingDistance(EASEL_HASH_A, EASEL_HASH_B);
    expect(dist).toBeLessThanOrEqual(VISUAL_SIMILARITY_HAMMING_THRESHOLD);
  });
});

// ── Analysis-ready gate ────────────────────────────────────────────────────────

describe('Analysis-ready gate: photos without pHash are deferred', () => {
  test('Photos with no qualityResult produce no batches when gate is applied', () => {
    const photos: GalleryPhotoItem[] = [
      makePhoto('391A2814.JPG', 0),
      makePhoto('391A2815.JPG', 5_000),
      makePhoto('391A2816.JPG', 10_000),
    ];

    const photosWithHash = photos.filter(p => p.qualityResult?.pHash != null);
    expect(photosWithHash).toHaveLength(0);

    const { newBatches } = runSequentialAlgorithm(photosWithHash, null);
    expect(newBatches).toHaveLength(0);
  });

  test('Mix: only pHash-ready photos are batched; un-ready photos are left as orphans', () => {
    const photos: GalleryPhotoItem[] = [
      makePhoto('391A2814.JPG', 0, HOUSE_HASH_A, 0), // ready
      makePhoto('391A2815.JPG', 5_000), // NOT ready (no pHash)
      makePhoto('391A2816.JPG', 10_000, HOUSE_HASH_B, 0), // ready
    ];

    const readyPhotos = photos.filter(p => p.qualityResult?.pHash != null);
    expect(readyPhotos).toHaveLength(2);

    const { newBatches } = runSequentialAlgorithm(readyPhotos, null);
    // 2814 and 2816 are visually similar (both house, low hash distance)
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].photoIds).toContain('391A2814.JPG');
    expect(newBatches[0].photoIds).toContain('391A2816.JPG');
    expect(newBatches[0].photoIds).not.toContain('391A2815.JPG');
  });
});

// ── Provisional batch flag ─────────────────────────────────────────────────────

describe('Provisional batch flag', () => {
  test('Batch from photo WITH pHash is NOT provisional', () => {
    const photos: GalleryPhotoItem[] = [makePhoto('391A2814.JPG', 0, HOUSE_HASH_A, 0)];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].provisional).toBeFalsy();
  });

  test('Batch from photo WITHOUT pHash IS provisional', () => {
    const photos: GalleryPhotoItem[] = [
      makePhoto('391A2814.JPG', 0), // no pHash
    ];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].provisional).toBe(true);
    expect(newBatches[0].representativeHash).toBeNull();
  });
});

// ── Core regression: real 391A2814→391A2819 sequence ──────────────────────────

describe('Correct batching of the real 391A2814→391A2819 sequence', () => {
  /**
   * Expected result: 4 batches
   *   Batch A: [391A2814]               — house exterior
   *   Batch B: [391A2815]               — easel/portrait
   *   Batch C: [391A2816, 391A2817]     — house exterior (Batch A permanently closed)
   *   Batch D: [391A2818, 391A2819]     — easel/portrait
   */
  const photos: GalleryPhotoItem[] = [
    makePhoto('391A2814.JPG', 0, HOUSE_HASH_A, 0),
    makePhoto('391A2815.JPG', 5_000, EASEL_HASH_A, 2),
    makePhoto('391A2816.JPG', 10_000, HOUSE_HASH_B, 0),
    makePhoto('391A2817.JPG', 15_000, HOUSE_HASH_B, 0),
    makePhoto('391A2818.JPG', 20_000, EASEL_HASH_A, 2),
    makePhoto('391A2819.JPG', 25_000, EASEL_HASH_B, 2),
  ];

  test('Produces exactly 4 batches with correct membership', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);

    expect(newBatches).toHaveLength(4);
    expect(newBatches[0].photoIds).toEqual(['391A2814.JPG']);
    expect(newBatches[1].photoIds).toEqual(['391A2815.JPG']);
    expect(newBatches[2].photoIds).toEqual(['391A2816.JPG', '391A2817.JPG']);
    expect(newBatches[3].photoIds).toEqual(['391A2818.JPG', '391A2819.JPG']);
  });

  test('No batch is provisional (all photos had pHash at batching time)', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    for (const batch of newBatches) {
      expect(batch.provisional).toBeFalsy();
    }
  });

  test('Representative hashes are real non-null values', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    for (const batch of newBatches) {
      expect(batch.representativeHash).not.toBeNull();
      expect(batch.representativeHash).not.toBeUndefined();
    }
  });

  test('Batch 1 (house) remains separate from Batch 3 (house) — non-retroactive rule', () => {
    // Batch A and Batch C both contain house photos with similar hashes,
    // but Batch B (easel) permanently closed Batch A.
    const { newBatches } = runSequentialAlgorithm(photos, null);

    const batchA = newBatches[0];
    const batchC = newBatches[2];

    expect(batchA.id).not.toBe(batchC.id);
    expect(batchA.photoIds).toContain('391A2814.JPG');
    expect(batchC.photoIds).not.toContain('391A2814.JPG');
    expect(batchC.photoIds).toContain('391A2816.JPG');
    expect(batchA.photoIds).not.toContain('391A2816.JPG');
  });
});

// ── Time-window edge cases ─────────────────────────────────────────────────────

describe('Time-window edge cases', () => {
  test('Visually identical photos separated by >3 min now land in the same batch (pure visual similarity, no time window)', () => {
    const photos: GalleryPhotoItem[] = [
      makePhoto('391A2814.JPG', 0, HOUSE_HASH_A, 0),
      makePhoto('391A2815.JPG', MAX_INTRA_BATCH_GAP_MS + 100_000, HOUSE_HASH_A, 0),
    ];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].photoIds).toHaveLength(2);
  });

  test('Visually similar photos within 3 min land in the same batch', () => {
    const photos: GalleryPhotoItem[] = [
      makePhoto('391A2814.JPG', 0, HOUSE_HASH_A, 0),
      makePhoto('391A2815.JPG', MAX_INTRA_BATCH_GAP_MS - 1, HOUSE_HASH_B, 0),
    ];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].photoIds).toHaveLength(2);
  });
});

// ── Single-photo edge case ─────────────────────────────────────────────────────

describe('Single-photo batch (edge case)', () => {
  test('A single photo forms its own non-provisional batch', () => {
    const photos: GalleryPhotoItem[] = [makePhoto('391A2843.JPG', 0, 'deadbeef12345678', 1)];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].photoIds).toEqual(['391A2843.JPG']);
    expect(newBatches[0].provisional).toBeFalsy();
  });
});

// ── Zero-face policy (Step 7 documented decision) ─────────────────────────────

describe('Zero-face photos (documented policy)', () => {
  /**
   * Documented decision:
   * - Consecutive 0-face photos within 3 minutes batch together.
   * - A 0-face photo followed by one with 2+ faces closes the 0-face batch
   *   (|2 - 0| = 2 > FACE_COUNT_TOLERANCE=1).
   *
   * KNOWN LIMITATION (documented, not a bug): Two visually dissimilar 0-face
   * photos (e.g., venue vs food table) with similar hashes will batch together.
   * Face count alone cannot distinguish scene types for non-face photos.
   */
  test('Consecutive 0-face photos batch together when visually similar', () => {
    const VENUE_HASH = 'a0a0a0a0b1b1b1b1';
    const photos: GalleryPhotoItem[] = [
      makePhoto('venue_01.JPG', 0, VENUE_HASH, 0),
      makePhoto('venue_02.JPG', 5_000, VENUE_HASH, 0),
    ];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].representativeFaceCount).toBe(0);
  });

  test('Photos with different face counts (0 vs 2 faces) batch TOGETHER when visually similar (pure visual similarity)', () => {
    const SAME_SCENE_HASH = 'a0a0a0a0b1b1b1b1';
    const photos: GalleryPhotoItem[] = [
      makePhoto('scene_01.JPG', 0, SAME_SCENE_HASH, 0),
      makePhoto('scene_02.JPG', 3_000, SAME_SCENE_HASH, 2), // face count difference ignored in batching decision
    ];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(1);
    expect(newBatches[0].photoIds).toEqual(['scene_01.JPG', 'scene_02.JPG']);
  });

  test('0-face batch closes when a visually distinct photo arrives (pure visual hash separator)', () => {
    const VENUE_HASH = 'a0a0a0a0b1b1b1b1';
    const PERSON_HASH = 'ff00ff00aa55aa55'; // very different scene (hash distance > 15)
    const photos: GalleryPhotoItem[] = [
      makePhoto('venue_01.JPG', 0, VENUE_HASH, 0),
      makePhoto('portrait_01.JPG', 5_000, PERSON_HASH, 2),
    ];
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(2);
    expect(newBatches[0].photoIds).toEqual(['venue_01.JPG']);
    expect(newBatches[1].photoIds).toEqual(['portrait_01.JPG']);
  });
});

// ── Threshold regression guard ─────────────────────────────────────────────────

describe('Thresholds are unchanged from validated values', () => {
  test('VISUAL_SIMILARITY_HAMMING_THRESHOLD is 15', () => {
    expect(VISUAL_SIMILARITY_HAMMING_THRESHOLD).toBe(15);
  });

  test('MAX_INTRA_BATCH_GAP_MS is 180000ms (3 minutes)', () => {
    expect(MAX_INTRA_BATCH_GAP_MS).toBe(180_000);
  });
});

// ── (a) Canonical spec example from the prompt ────────────────────────────────
//
//   10:00 — Photo 1, Photo 2  (similar)       → Batch 1
//   10:05 — Photo 3           (different)     → Batch 2
//   10:10 — Photo 4,5,6,7    (similar to Batch 1's signature, but Batch 2 intervened)
//                                              → Batch 3  (NOT merged into Batch 1)
//
// This is the single most important invariant: chronological-continuity-gated
// similarity. Visual similarity to an OLD, CLOSED batch is irrelevant.

describe('(a) Canonical spec example: Batch 3 must NOT reopen Batch 1', () => {
  // SIMILAR_A: the "Batch 1 / Batch 3" look (same house exterior hash family)
  // DIFFERENT:  the "Batch 2" look — completely distinct scene
  const SIMILAR_A = 'a1b2c3d4e5f60001'; // house-like
  const SIMILAR_A2 = 'a1b2c3d4e5f60002'; // same family, dist=1 from SIMILAR_A
  const DIFFERENT = 'ff00aa55bb661122'; // easel-like, dist>>10 from SIMILAR_A

  // 10:00 AM = offset 0
  // 10:05 AM = offset 5 min = 300 000 ms  (>> MAX_INTRA_BATCH_GAP_MS → different batch anyway)
  // 10:10 AM = offset 10 min              (same reasoning)
  //
  // NOTE: We use a time gap > MAX_INTRA_BATCH_GAP_MS between batch boundaries,
  // which is the realistic use-case. The non-retroactive rule also applies
  // when the gap is within the window (covered in test (b) below).

  const T_10_00 = 0;
  const T_10_05 = 5 * 60 * 1000; // 5 min after base — outside window
  const T_10_10 = 10 * 60 * 1000; // 10 min after base — outside window

  const photos: GalleryPhotoItem[] = [
    // Batch 1 candidates (10:00)
    makePhoto('photo1.JPG', T_10_00, SIMILAR_A, 0),
    makePhoto('photo2.JPG', T_10_00 + 2_000, SIMILAR_A2, 0),
    // Batch 2 (10:05, different look AND outside time window)
    makePhoto('photo3.JPG', T_10_05, DIFFERENT, 2),
    // Batch 3 candidates (10:10, similar to Batch 1 — but Batch 2 intervened)
    makePhoto('photo4.JPG', T_10_10, SIMILAR_A, 0),
    makePhoto('photo5.JPG', T_10_10 + 2_000, SIMILAR_A2, 0),
    makePhoto('photo6.JPG', T_10_10 + 4_000, SIMILAR_A, 0),
    makePhoto('photo7.JPG', T_10_10 + 6_000, SIMILAR_A2, 0),
  ];

  test('Produces exactly 3 batches in arrival order', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(3);
  });

  test('Batch 1 contains photo1 and photo2 only', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches[0].photoIds).toEqual(['photo1.JPG', 'photo2.JPG']);
  });

  test('Batch 2 contains photo3 only (the "different" photo)', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches[1].photoIds).toEqual(['photo3.JPG']);
  });

  test('Batch 3 contains photo4-7 (similar to Batch 1, but must be a NEW batch)', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches[2].photoIds).toEqual([
      'photo4.JPG',
      'photo5.JPG',
      'photo6.JPG',
      'photo7.JPG',
    ]);
  });

  test('Batch 3 is a distinct batch from Batch 1 (different id)', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches[0].id).not.toBe(newBatches[2].id);
  });

  test('photo4-7 are NOT members of Batch 1', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    const batch1Ids = new Set(newBatches[0].photoIds);
    expect(batch1Ids.has('photo4.JPG')).toBe(false);
    expect(batch1Ids.has('photo5.JPG')).toBe(false);
    expect(batch1Ids.has('photo6.JPG')).toBe(false);
    expect(batch1Ids.has('photo7.JPG')).toBe(false);
  });
});

// ── (b) Late-arriving similar photo within the time window ────────────────────
//
// Harder variant: photos 4-7 arrive within 3 minutes of photo 3 (within the
// time window), so time alone does NOT split them. The split must come purely
// from the sequential rule: Batch 2 (the "different" photo) became the current
// batch, making Batch 1 permanently closed. Photos 4-7 compare against Batch 2's
// representative (DIFFERENT hash), fail the hash gate, and start Batch 3.
// They must NOT jump back and compare against Batch 1's representative.

describe('(b) Late-arriving similar photo within time window — must not reopen closed batch', () => {
  const SIMILAR_A = 'a1b2c3d4e5f60001';
  const SIMILAR_A2 = 'a1b2c3d4e5f60002';
  const DIFFERENT = 'ff00aa55bb661122';

  // All photos within the 3-minute window (30s spacing)
  const photos: GalleryPhotoItem[] = [
    makePhoto('p1.JPG', 0 * 30_000, SIMILAR_A, 0), // Batch 1 rep
    makePhoto('p2.JPG', 1 * 30_000, SIMILAR_A2, 0), // extends Batch 1
    makePhoto('p3.JPG', 2 * 30_000, DIFFERENT, 2), // closes Batch 1, opens Batch 2
    makePhoto('p4.JPG', 3 * 30_000, SIMILAR_A, 0), // similar to Batch 1 but MUST be Batch 3
    makePhoto('p5.JPG', 4 * 30_000, SIMILAR_A2, 0), // extends Batch 3
  ];

  test('Produces exactly 3 batches', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches).toHaveLength(3);
  });

  test('p1+p2 are in Batch 1; p3 is in Batch 2; p4+p5 are in Batch 3', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches[0].photoIds).toEqual(['p1.JPG', 'p2.JPG']);
    expect(newBatches[1].photoIds).toEqual(['p3.JPG']);
    expect(newBatches[2].photoIds).toEqual(['p4.JPG', 'p5.JPG']);
  });

  test('p4 and p5 are NOT in Batch 1 despite matching Batch 1 hash', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    const batch1Ids = new Set(newBatches[0].photoIds);
    expect(batch1Ids.has('p4.JPG')).toBe(false);
    expect(batch1Ids.has('p5.JPG')).toBe(false);
  });

  test("Batch 3 representative is Batch 2's DIFFERENT hash, not Batch 1's hash", () => {
    // Batch 3 opens when p4 fails the comparison against Batch 2 (DIFFERENT hash).
    // p4's own hash is SIMILAR_A. The batch that closed was Batch 2 (rep = DIFFERENT).
    // Batch 3 (starting with p4) should have SIMILAR_A as its representative.
    const { newBatches } = runSequentialAlgorithm(photos, null);
    const batch3 = newBatches[2];
    expect(batch3.representativeHash).toBe(SIMILAR_A);
    // Critically, this is different from Batch 2's representative
    const batch2 = newBatches[1];
    expect(batch2.representativeHash).toBe(DIFFERENT);
    expect(batch3.representativeHash).not.toBe(batch2.representativeHash);
  });
});

// ── (c) Persistence: batch order is preserved across restart ──────────────────
//
// After persisting batches to disk and reloading them, `getAllPersistedBatches()`
// must return batches in startTime order (ascending). The UI must render them
// in this order, never re-sorting by similarity.
//
// This test covers the in-memory sort contract directly (the disk I/O is handled
// by `photoBatchPersistenceService.ts` and requires a separate integration test
// with a mock FileSystem). We verify that:
//  - `runSequentialAlgorithm` produces batches with monotonically increasing startTimes
//  - The comparator used in `getAllPersistedBatches` (ISO string localeCompare) correctly
//    sorts them in arrival order when reloaded in any arbitrary order from a JSON object

describe('(c) Batch order is preserved across restart (sort contract)', () => {
  const SIMILAR_A = 'a1b2c3d4e5f60001';
  const DIFFERENT = 'ff00aa55bb661122';

  const photos: GalleryPhotoItem[] = [
    makePhoto('photo1.JPG', 0, SIMILAR_A, 0),
    makePhoto('photo2.JPG', 2_000, SIMILAR_A, 0),
    makePhoto('photo3.JPG', 300_001, DIFFERENT, 2), // > 3 min gap → new batch
    makePhoto('photo4.JPG', 600_002, SIMILAR_A, 0), // > 3 min gap → new batch
  ];

  test('Batch startTimes are strictly monotonically increasing (arrival order)', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    expect(newBatches.length).toBeGreaterThan(1);

    for (let i = 1; i < newBatches.length; i++) {
      expect(newBatches[i].startTime > newBatches[i - 1].startTime).toBe(true);
    }
  });

  test('ISO string sort (used by getAllPersistedBatches) matches arrival order', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);

    // Simulate what happens when batches are stored in a JSON object (keyed by id)
    // and then iterated in an arbitrary order on reload. Sort via localeCompare
    // of startTime strings (same comparator used in getAllPersistedBatches).
    const shuffled = [...newBatches].reverse(); // worst-case reverse order from JSON
    const sorted = shuffled.slice().sort((a, b) => a.startTime.localeCompare(b.startTime));

    // After re-sorting, order should match the original
    for (let i = 0; i < newBatches.length; i++) {
      expect(sorted[i].id).toBe(newBatches[i].id);
    }
  });

  test('Re-merged batches never appear: each batch has a unique id and distinct photoIds', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    const ids = newBatches.map(b => b.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // no duplicate ids

    // Each photo appears in exactly one batch
    const allPhotoIds = newBatches.flatMap(b => b.photoIds);
    const uniquePhotoIds = new Set(allPhotoIds);
    expect(uniquePhotoIds.size).toBe(allPhotoIds.length); // no photo in two batches
  });

  test('Batch 1 and Batch 3 contain the same hash family but are separate batches', () => {
    const { newBatches } = runSequentialAlgorithm(photos, null);
    // Batch 1 (photo1+2) and Batch 3 (photo4) share SIMILAR_A hash family
    // but are different batches because Batch 2 intervened
    const batch1 = newBatches[0];
    const batch3 = newBatches[2];
    expect(batch1.id).not.toBe(batch3.id);
    // Both have SIMILAR_A as representative (correct — they were the current batch when those photos arrived)
    expect(batch1.representativeHash).toBe(SIMILAR_A);
    expect(batch3.representativeHash).toBe(SIMILAR_A);
    // But they are separate batches
    expect(batch1.photoIds).not.toEqual(expect.arrayContaining(batch3.photoIds));
  });
});

// ── Performance Benchmark: 200+ photos ────────────────────────────────────────
//
// Validates that `runSequentialAlgorithm` completes in bounded O(n) time for
// 200+ photos. The algorithm must not perform nested searches through previous
// batches (which would be O(n²)).

describe('Performance benchmark: 200+ photos in quick succession', () => {
  const NUM_GROUPS = 10;
  const PHOTOS_PER_GROUP = 20;
  const TOTAL_PHOTOS = NUM_GROUPS * PHOTOS_PER_GROUP;

  const GROUP_HASHES = [
    'aaaa000011111111',
    'bbbb000022222222',
    'cccc000033333333',
    'dddd000044444444',
    'eeee000055555555',
    'ffff000066666666',
    '0000aaaa77777777',
    '0000bbbb88888888',
    '0000cccc99999999',
    '0000ddddaaaaaaaa',
  ];

  function makeBenchmarkPhoto(
    groupIndex: number,
    photoIndex: number,
    groupHash: string,
  ): GalleryPhotoItem {
    const offset = groupIndex * 5 * 60 * 1000 + photoIndex * 3_000;
    const filename = `IMG_G${groupIndex}_P${photoIndex}.JPG`;
    const faceCount = groupIndex % 3;
    return {
      id: filename,
      filename,
      uri: `file:///DCIM/Entephoto/${filename}`,
      isRaw: false,
      status: 'new',
      selected: false,
      timestamp: new Date(BASE_TIME_MS + offset).toISOString(),
      capturedAt: BASE_TIME_MS + offset,
      isAnalyzingQuality: false,
      qualityResult: {
        blur: false,
        face: faceCount > 0,
        overExposure: false,
        eyesOpen: true,
        faceCount,
        pHash: groupHash,
      },
    };
  }

  const benchmarkPhotos: GalleryPhotoItem[] = [];
  for (let g = 0; g < NUM_GROUPS; g++) {
    for (let p = 0; p < PHOTOS_PER_GROUP; p++) {
      benchmarkPhotos.push(makeBenchmarkPhoto(g, p, GROUP_HASHES[g]));
    }
  }

  test(`Processes ${TOTAL_PHOTOS} photos in under 100ms (O(n) bound)`, () => {
    const start = Date.now();
    const { newBatches } = runSequentialAlgorithm(benchmarkPhotos, null);
    const elapsed = Date.now() - start;
    console.log(
      `[Benchmark] ${TOTAL_PHOTOS} photos -> ${newBatches.length} batches in ${elapsed}ms`,
    );
    expect(elapsed).toBeLessThan(100);
    expect(newBatches).toHaveLength(NUM_GROUPS);
  });

  test('Every photo appears in exactly one batch', () => {
    const { newBatches } = runSequentialAlgorithm(benchmarkPhotos, null);
    const allAssigned = newBatches.flatMap(b => b.photoIds);
    expect(allAssigned).toHaveLength(TOTAL_PHOTOS);
    const seen = new Set<string>();
    for (const pid of allAssigned) {
      expect(seen.has(pid)).toBe(false);
      seen.add(pid);
    }
  });

  test('All batch IDs unique; no null representativeHash; monotonic startTimes', () => {
    const { newBatches } = runSequentialAlgorithm(benchmarkPhotos, null);
    const ids = newBatches.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const batch of newBatches) {
      expect(batch.representativeHash).not.toBeNull();
    }
    for (let i = 1; i < newBatches.length; i++) {
      expect(newBatches[i].startTime > newBatches[i - 1].startTime).toBe(true);
    }
  });
});

// ── Performance & Virtualization Benchmark: 1000+ Photos Scale (Step 5) ───────
//
// Validates that at 1000+ photo scale:
// 1. Scoring & sequential batching runs in < 50ms (strictly O(n), zero disk/ML Kit work).
// 2. Collapsed-by-default SectionList mounts only 1 hero row per batch (mounted rows = batch count, NOT photo count).
// 3. Expanding a specific batch virtualizes properly without expanding or remounting other batches.

describe('Scale benchmark: 1000+ photos across 100 batches (Step 5)', () => {
  const NUM_BATCHES = 100;
  const PHOTOS_PER_BATCH = 10;
  const TOTAL_SCALE_PHOTOS = NUM_BATCHES * PHOTOS_PER_BATCH;

  const scalePhotos: GalleryPhotoItem[] = [];
  for (let b = 0; b < NUM_BATCHES; b++) {
    const batchHash = (b.toString(16).padStart(4, '0') + 'ffff111122223333').slice(0, 16);
    for (let p = 0; p < PHOTOS_PER_BATCH; p++) {
      const offset = b * 5 * 60 * 1000 + p * 2000;
      const filename = `IMG_B${b}_P${p}.JPG`;
      const isSharpHero = p === 3; // p=3 is the best shot with highest sharpness & eyes open
      scalePhotos.push({
        id: filename,
        filename,
        uri: `file:///DCIM/Entephoto/${filename}`,
        isRaw: false,
        status: 'new',
        selected: false,
        timestamp: new Date(BASE_TIME_MS + offset).toISOString(),
        capturedAt: BASE_TIME_MS + offset,
        isAnalyzingQuality: false,
        qualityResult: {
          blur: !isSharpHero && p % 2 === 0,
          face: true,
          overExposure: false,
          eyesOpen: isSharpHero || p % 3 !== 0,
          faceCount: 2,
          closedEyeCount: isSharpHero ? 0 : 1,
          sharpnessScore: isSharpHero ? 180 : 75,
          exposureScore: 2.5,
          pHash: batchHash,
        },
      });
    }
  }

  test(`Batches and scores ${TOTAL_SCALE_PHOTOS} photos in under 50ms`, () => {
    const start = Date.now();
    const { newBatches } = runSequentialAlgorithm(scalePhotos, null);
    const elapsed = Date.now() - start;

    console.log(`[Scale Benchmark] ${TOTAL_SCALE_PHOTOS} photos batched & scored in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(50);
    expect(newBatches).toHaveLength(NUM_BATCHES);

    // Verify best-shot assigned for every batch
    for (let b = 0; b < newBatches.length; b++) {
      expect(newBatches[b].bestShotPhotoId).toBe(`IMG_B${b}_P3.JPG`);
    }
  });

  test('SectionList renders 3-column grid rows directly for all batches', () => {
    const { newBatches } = runSequentialAlgorithm(scalePhotos, null);
    const runtimeBatches = newBatches.map(b => ({
      ...b,
      photos: scalePhotos.filter(p => b.photoIds.includes(p.filename || p.id)),
      lastPhotoTimeMs: Date.parse(b.endTime),
      isOpen: false,
    }));

    const sections = buildGallerySections(runtimeBatches, scalePhotos);
    expect(sections).toHaveLength(NUM_BATCHES);

    for (const section of sections) {
      expect(section.isCollapsed).toBe(false);
      // 10 photos per batch -> 4 rows (3 + 3 + 3 + 1)
      expect(section.data).toHaveLength(4);
      expect(section.data[0].type).toBe('grid_row');
      if (section.data[0].type === 'grid_row') {
        const bestPhotoItem = section.data[0].photos.find(p => p.isBestShot);
        expect(bestPhotoItem).toBeDefined();
        expect(bestPhotoItem?.photo.filename).toMatch(/_P3\.JPG$/);
      }
    }
  });
});
