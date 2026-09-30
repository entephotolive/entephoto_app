/**
 * photoBatchingService.ts
 *
 * Implements TIME-BASED SIMILAR-PHOTO BATCHING using a CHRONOLOGICAL-CONTINUITY-GATED
 * similarity rule — NOT a general clustering algorithm.
 *
 * ## Core Rule (must not be relaxed)
 * Each new photo is compared ONLY against the CURRENT (most recently open) batch.
 * Once a dissimilar photo closes a batch, that batch is permanently closed; later
 * similar-looking photos always start/join a NEW batch — they never reopen an old one.
 *
 * ## Similarity Signals
 *
 * ### Primary: Face Count (from ML Kit via PhotoQualityResult.faceCount)
 *   - We reuse the faceCount already computed by the quality pipeline — no re-analysis.
 *   - ⚠️ KNOWN LIMITATION: ML Kit on-device face detection gives face COUNT and facial
 *     landmarks, but NOT identity embeddings. "Same face count" is a proxy for "same
 *     group of people" — it does NOT verify that the detected faces are the same
 *     identities. Two photos of completely different people with the same headcount will
 *     be batched together. This is a deliberate simplification given on-device constraints.
 *   - For verified "same people" matching a future version could call the backend
 *     (which uses face_recognition/dlib `encode_faces_from_file` for real embeddings)
 *     to return a lightweight similarity score post-upload. That path is NOT available
 *     at on-device batching time (photos are batched before/independent of upload).
 *     For now we document this as a known simplification.
 *
 * ### Secondary: Arrival-Time Proximity
 *   - Photos arriving within `MAX_INTRA_BATCH_GAP_MS` of the current batch's most recent
 *     photo are candidates for the same batch, even if face count matches.
 *   - Photos arriving after `MAX_INTRA_BATCH_GAP_MS` always start a new batch, regardless
 *     of face count similarity. This gates chronological continuity.
 *
 * ### Zero-Face Policy (Step 7 Edge Case Decision)
 *   - Photos where `faceCount === 0` (no faces detected, e.g. landscape, decor, objects):
 *     - When arriving within `MAX_INTRA_BATCH_GAP_MS` of each other, consecutive 0-face photos
 *       BATCH TOGETHER under a distinct "No faces" section.
 *     - Rationale: Burst or consecutive shots of venue/decor/landscapes taken seconds apart belong
 *       to the same temporal moment/scene.
 *     - If followed by a photo with faces (e.g. `faceCount >= 2`), the face tolerance gate
 *       fails (`|2 - 0| > FACE_COUNT_TOLERANCE`), closing the 0-face batch immediately.
 *     - ⚠️ KNOWN LIMITATION: "0 faces" does NOT imply visual similarity of objects. Two completely
 *       different objects shot within 3 minutes will batch together under "No faces".
 *
 * ## Algorithm (sequential, non-retroactive)
 * 1. Start with an empty batch list.
 * 2. For each photo (in arrival order):
 *    a. If no current batch is open → open a new batch with this photo.
 *    b. Else compute similarity against the current batch's latest photo.
 *       - Similarity: face counts differ by ≤ FACE_COUNT_TOLERANCE AND
 *                     time gap ≤ MAX_INTRA_BATCH_GAP_MS
 *    c. If similar → append to current batch, update lastPhotoTime.
 *    d. If dissimilar → CLOSE the current batch (permanently), open a new batch.
 * 3. Output: ordered list of PersistedBatch objects.
 *
 * ## Persistence contract (Step 2)
 * - PersistedBatch (canonical schema) is written via photoBatchPersistenceService.
 * - Already-assigned photos are NEVER re-batched on reload.
 * - The algorithm runs only on "orphan" photos (not yet in any persisted batch).
 */

import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import {
  extractFeaturesInChunks,
  clusterPhotosByVisualSimilarity,
  selectClusterBestShot,
  computeDHashHammingDistance,
  computeColorHistogramDistance,
  DHASH_DISTANCE_THRESHOLD,
  COLOR_HISTOGRAM_TOLERANCE,
  selectBestShotId,
} from './photoScoringService';
import {
  PersistedBatch,
  getUnassignedPhotoIds,
  saveBatchResults,
  getAllPersistedBatches,
  repairProvisionalBatches,
  hasProvisionalBatches,
  getLastOpenBatch,
  appendPhotoToBatch,
} from './photoBatchPersistenceService';

// ── Tuning Constants ───────────────────────────────────────────────────────────

/**
 * @deprecated Time-based batch gating has been eliminated in favor of pure visual clustering.
 * Retained for backwards compatibility with legacy tests.
 */
export const MAX_INTRA_BATCH_GAP_MS = 3 * 60 * 1000;

/**
 * Minimum number of photos in a batch for it to be rendered as a labeled
 * "similar" group in the UI. Singletons are always shown ungrouped.
 */
export const MIN_BATCH_SIZE_FOR_LABEL = 2;

// ── Internal Runtime State (computation only — not persisted directly) ─────────

/** Mutable working state for a batch while the sequential algorithm runs. */
export interface RuntimeBatch {
  id: string;
  photoIds: string[];
  photos: GalleryPhotoItem[]; // hydrated photos for UI rendering
  startTime: string; // ISO, frozen after first photo
  endTime: string; // ISO, updated on each append
  lastPhotoTimeMs: number; // epoch ms, used for time-gap comparison
  representativeFaceCount: number | null;
  /** Perceptual hash of the first photo in the batch */
  representativeHash?: string | null;
  /** Perceptual hash of the most recent photo added to this batch */
  lastPhotoHash?: string | null;
  /** Stable ID (filename) of the recommended best shot photo */
  bestShotPhotoId?: string | null;
  isOpen: boolean;
  /** True when this batch was created before analysis completed (null hash). */
  provisional?: boolean;
}

// ── Internal Helpers ───────────────────────────────────────────────────────────

/**
 * Assumed interval between consecutive shots during a burst/session (ms).
 * Used as a synthetic spacing when real mtime is unavailable.
 */
const ASSUMED_SHOT_INTERVAL_MS = 2000;

function extractPhotoTimestampMs(photo: GalleryPhotoItem, indexFallback: number): number {
  if (photo.capturedAt && photo.capturedAt > 0) {
    return photo.capturedAt;
  }
  return Date.now() - (10000 - indexFallback * ASSUMED_SHOT_INTERVAL_MS);
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function getFaceCount(photo: GalleryPhotoItem): number | null {
  const fc = photo.qualityResult?.faceCount;
  return fc !== undefined ? fc : null;
}

function getPHash(photo: GalleryPhotoItem): string | null {
  return photo.pHash || photo.qualityResult?.pHash || null;
}

/** Stable photo ID: camera filename, same key as quality persistence. */
function stableId(photo: GalleryPhotoItem): string {
  return photo.filename || photo.id;
}

function checkSimilarityWithDiagnostics(
  candidatePhoto: GalleryPhotoItem,
  candidateMs: number,
  candidateHash: string | null,
  current: RuntimeBatch,
): { isSimilar: boolean; reason: string; hashDistance: number | string; timeSinceLastMs: number } {
  const timeSinceLastMs = Math.abs(candidateMs - current.lastPhotoTimeMs);
  const compareHash = current.lastPhotoHash || current.representativeHash;
  const hashDistance =
    candidateHash && compareHash ? computeDHashHammingDistance(candidateHash, compareHash) : 'N/A';

  // 1. TEMPORAL CONTINUITY GATING
  // Burst shots of the exact same pose occur in rapid succession (< 15-30s).
  // Changing poses (e.g. couple adjusting posture/look) takes time (> 45s), starting a new batch.
  const MAX_BURST_GAP_MS = 45 * 1000;
  if (current.lastPhotoTimeMs > 0 && candidateMs > 0 && timeSinceLastMs > MAX_BURST_GAP_MS) {
    const reason = `Time gap exceeded burst window (${Math.round(timeSinceLastMs / 1000)}s > ${MAX_BURST_GAP_MS / 1000}s)`;
    return { isSimilar: false, reason, hashDistance, timeSinceLastMs };
  }

  // 2. FACE COUNT CONSISTENCY GATING
  // If face analysis has run on both photos, ensure human subject count matches.
  // If people enter or leave the frame (face count increases or decreases), it's a NEW batch.
  const candidateFaceCount = getFaceCount(candidatePhoto);
  const repFaceCount = current.representativeFaceCount;
  if (candidateFaceCount !== null && repFaceCount !== null) {
    if (candidateFaceCount !== repFaceCount) {
      const reason = `Face count changed (${repFaceCount} -> ${candidateFaceCount} people)`;
      return { isSimilar: false, reason, hashDistance, timeSinceLastMs };
    }
  }

  // 3. VISUAL PERCEPTUAL HASH (dHash)
  if (candidateHash && compareHash && typeof hashDistance === 'number') {
    // If 0 faces (scenery/decor/rings/stage), require tighter similarity threshold
    const effectiveThreshold =
      candidateFaceCount === 0 && repFaceCount === 0 ? 10 : DHASH_DISTANCE_THRESHOLD;

    if (hashDistance > effectiveThreshold) {
      const reason = `Hash distance exceeded threshold (${hashDistance} > ${effectiveThreshold})`;
      return { isSimilar: false, reason, hashDistance, timeSinceLastMs };
    }
  }

  const reason = `Visual similarity check passed (hash dist ${hashDistance})`;
  return { isSimilar: true, reason, hashDistance, timeSinceLastMs };
}

// NOTE: isSimilarToRuntime() was removed — use checkSimilarityWithDiagnostics() instead.
// isSimilarToPersisted() is retained solely for the one-shot cross-session seed check.

function isSimilarToPersisted(
  candidatePhoto: GalleryPhotoItem,
  candidateMs: number,
  candidateHash: string | null,
  persisted: PersistedBatch,
): boolean {
  const timeSinceLastMs = persisted.endTime
    ? Math.abs(candidateMs - new Date(persisted.endTime).getTime())
    : 0;

  const MAX_BURST_GAP_MS = 45 * 1000;
  if (timeSinceLastMs > MAX_BURST_GAP_MS && timeSinceLastMs > 0) {
    return false;
  }

  const candidateFaceCount = getFaceCount(candidatePhoto);
  const repFaceCount = persisted.representativeFaceCount;
  if (candidateFaceCount !== null && repFaceCount !== null) {
    if (candidateFaceCount !== repFaceCount) {
      return false;
    }
  }

  const compareHash = persisted.lastPhotoHash || persisted.representativeHash;
  if (candidateHash && compareHash) {
    const dist = computeDHashHammingDistance(candidateHash, compareHash);
    const threshold =
      candidateFaceCount === 0 && repFaceCount === 0 ? 10 : DHASH_DISTANCE_THRESHOLD;
    if (dist > threshold) {
      return false;
    }
  }

  return true;
}

function runtimeToPersistedBatch(rt: RuntimeBatch): PersistedBatch {
  const bestShot =
    rt.bestShotPhotoId ?? (rt.photos.length > 0 ? selectBestShotId(rt.photos).bestShotId : null);
  return {
    id: rt.id,
    photoIds: rt.photoIds,
    startTime: rt.startTime,
    endTime: rt.endTime,
    representativeFaceCount: rt.representativeFaceCount,
    representativeHash: rt.representativeHash,
    lastPhotoHash: rt.lastPhotoHash,
    bestShotPhotoId: bestShot,
    provisional: rt.provisional,
  };
}

// ── Core Batching Algorithm (synchronous, over new photos only) ────────────────

/**
 * Runs the sequential batching algorithm over a list of UNASSIGNED photos,
 * optionally seeded with a previously-open persisted batch as the starting
 * "current open batch" (cross-session continuity).
 *
 * ## Strict sequential guarantee
 * The algorithm maintains EXACTLY ONE `currentRuntime` pointer at a time.
 * Each photo is compared ONLY against `currentRuntime` — never against any
 * previously closed batch, and never against the seedBatch after the first
 * new-batch boundary has been crossed.
 *
 * Closed batches are immutable — once pushed to `newBatches` they are never
 * searched, re-opened, or extended.
 *
 * ## Seed batch (cross-session only)
 * The `seedBatch` parameter represents the last-open batch from the PREVIOUS
 * app session — semantically still "open" because the app was closed before
 * a new batch started. The first new photo either continues the seed (one-shot)
 * or permanently closes it. If the seed is `provisional` (null hash), it is
 * skipped — the first new photo always starts a fresh batch instead.
 */
function runSequentialAlgorithm(
  newPhotos: GalleryPhotoItem[],
  seedBatch: PersistedBatch | null,
): {
  newBatches: PersistedBatch[];
  /** stablePhotoIds appended to the seedBatch (not in newBatches) */
  seedAppends: {
    stablePhotoId: string;
    endTimeIso: string;
    lastPhotoHash?: string | null;
    bestShotPhotoId?: string | null;
  }[];
} {
  if (newPhotos.length === 0) {
    return { newBatches: [], seedAppends: [] };
  }

  const newBatches: PersistedBatch[] = [];
  const seedAppends: {
    stablePhotoId: string;
    endTimeIso: string;
    lastPhotoHash?: string | null;
    bestShotPhotoId?: string | null;
  }[] = [];
  let currentRuntime: RuntimeBatch | null = null;

  // If the seed is provisional (null hash), treating it as an extension target
  // would compare against null — producing wrong assignments. Skip it entirely
  // and let the first new photo open a fresh batch.
  let extendingSeed =
    seedBatch !== null && seedBatch.provisional !== true && seedBatch.representativeHash != null;

  for (let i = 0; i < newPhotos.length; i++) {
    const photo = newPhotos[i];
    const photoMs = extractPhotoTimestampMs(photo, i);
    const faceCount = getFaceCount(photo);
    const photoHash = getPHash(photo);
    const photoIso = toIso(photoMs);
    const sid = stableId(photo);

    if (extendingSeed && seedBatch) {
      // First priority: try to append to the persisted seed batch
      const isSim = isSimilarToPersisted(photo, photoMs, photoHash, seedBatch);
      if (isSim) {
        seedAppends.push({
          stablePhotoId: sid,
          endTimeIso: photoIso,
          lastPhotoHash: photoHash,
        });
        seedBatch = { ...seedBatch, endTime: photoIso, lastPhotoHash: photoHash };
        continue;
      } else {
        // First new photo failed the gate → seed is permanently closed for this session
        extendingSeed = false;
      }
    }

    // Now handle in the normal runtime batching loop
    if (!currentRuntime) {
      currentRuntime = {
        id: `batch-${sid}`,
        photoIds: [sid],
        photos: [photo],
        startTime: photoIso,
        endTime: photoIso,
        lastPhotoTimeMs: photoMs,
        representativeFaceCount: faceCount,
        representativeHash: photoHash,
        lastPhotoHash: photoHash,
        bestShotPhotoId: sid,
        isOpen: true,
        // Mark provisional if the representative photo has no real hash yet.
        // repairProvisionalBatches() will backfill once analysis completes.
        provisional: photoHash == null,
      };
    } else {
      const diag = checkSimilarityWithDiagnostics(photo, photoMs, photoHash, currentRuntime);

      if (diag.isSimilar) {
        currentRuntime.photoIds.push(sid);
        currentRuntime.photos.push(photo);
        currentRuntime.endTime = photoIso;
        currentRuntime.lastPhotoTimeMs = photoMs;
        currentRuntime.lastPhotoHash = photoHash;
        currentRuntime.bestShotPhotoId = selectBestShotId(currentRuntime.photos).bestShotId;
      } else {
        // Dissimilar → close current, open new
        currentRuntime.isOpen = false;
        currentRuntime.bestShotPhotoId = selectBestShotId(currentRuntime.photos).bestShotId;
        newBatches.push(runtimeToPersistedBatch(currentRuntime));
        currentRuntime = {
          id: `batch-${sid}`,
          photoIds: [sid],
          photos: [photo],
          startTime: photoIso,
          endTime: photoIso,
          lastPhotoTimeMs: photoMs,
          representativeFaceCount: faceCount,
          representativeHash: photoHash,
          lastPhotoHash: photoHash,
          bestShotPhotoId: sid,
          isOpen: true,
          provisional: photoHash == null,
        };
      }
    }
  }

  if (currentRuntime) {
    currentRuntime.isOpen = false;
    currentRuntime.bestShotPhotoId = selectBestShotId(currentRuntime.photos).bestShotId;
    newBatches.push(runtimeToPersistedBatch(currentRuntime));
  }

  return { newBatches, seedAppends };
}

// ── Public Persistence-Aware Entry Point ──────────────────────────────────────

/**
 * Assigns all provided photos to batches, respecting persisted assignments:
 *
 * 1. Loads the list of photos NOT yet in any persisted batch (orphans).
 * 2. Retrieves the last open batch from the previous session (the seed).
 * 3. Runs the sequential algorithm only on orphan photos, seeded with the
 *    last open batch for cross-session continuity.
 * 4. Persists all new batch assignments.
 * 5. Returns a complete ordered BatchAssignment map: stablePhotoId → batchId.
 *
 * This function is IDEMPOTENT: calling it twice with the same photos produces
 * the same result because already-assigned photos are skipped.
 *
 * @param photos  - Full current photo list (mixed: some may already be assigned)
 * @returns       - Map<stablePhotoId, batchId> for ALL photos (assigned + newly assigned)
 */
export async function assignPhotoBatchesPersisted(
  photos: GalleryPhotoItem[],
): Promise<Map<string, string>> {
  if (photos.length === 0) return new Map();

  const stableIds = photos.map(stableId);

  // Step 0: Repair any batches that were frozen with null representative data
  if (hasProvisionalBatches()) {
    const repairedCount = await repairProvisionalBatches(async repPhotoId => {
      const photo = photos.find(p => stableId(p) === repPhotoId);
      if (!photo) return null;
      const hash = getPHash(photo);
      const faceCount = getFaceCount(photo);
      if (hash == null) return null;
      return { hash, faceCount, lastHash: hash };
    });

    if (repairedCount > 0) {
      console.log(
        `[BatchingService] Repaired ${repairedCount} provisional batch(es) with real analysis data.`,
      );
    }
  }

  // Step 1: find orphans
  const allOrphanIds = new Set(await getUnassignedPhotoIds(stableIds));

  if (allOrphanIds.size === 0) {
    console.log(
      `[BatchingService] Cache HIT for all ${photos.length} photos — skipping batching pipeline.`,
    );
  } else {
    console.log(
      `[BatchingService] Cache check: ${photos.length - allOrphanIds.size} already assigned in disk cache, ${allOrphanIds.size} orphan(s) need batching.`,
    );

    const orphanPhotos = photos
      .filter(p => allOrphanIds.has(stableId(p)))
      .sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
    const tStart = performance.now();

    // Step 2: Extract visual features (dHash, color histogram, tiled Laplacian) in non-blocking chunks
    const featuresMap = await extractFeaturesInChunks(
      orphanPhotos.map(p => ({
        id: stableId(p),
        uri: p.uri,
        existingPHash: p.pHash || p.qualityResult?.pHash,
        existingSharpness: p.qualityResult?.sharpnessScore,
      })),
    );

    // Eagerly hydrate pHash onto in-memory items
    for (const p of orphanPhotos) {
      const feat = featuresMap.get(stableId(p));
      if (feat) {
        p.pHash = feat.dHash;
      }
    }

    const photosByStableId = new Map<string, GalleryPhotoItem>();
    for (const p of photos) {
      photosByStableId.set(stableId(p), p);
    }

    // Step 3: Check against the last open / persisted batch in local storage
    let openBatch = await getLastOpenBatch();
    let unassignedOrphans = [...orphanPhotos];
    let appendedToSeedCount = 0;

    if (
      openBatch &&
      openBatch.provisional !== true &&
      (openBatch.lastPhotoHash || openBatch.representativeHash)
    ) {
      const orphansToAppend: GalleryPhotoItem[] = [];

      for (let i = 0; i < unassignedOrphans.length; i++) {
        const candidate = unassignedOrphans[i];
        const candidateHash = featuresMap.get(stableId(candidate))?.dHash || candidate.pHash;
        const compareHash = openBatch.lastPhotoHash || openBatch.representativeHash;

        if (candidateHash && compareHash) {
          const dist = computeDHashHammingDistance(candidateHash, compareHash);
          const featA = featuresMap.get(stableId(candidate));
          const colorDist = featA
            ? computeColorHistogramDistance(featA.colorHistogram, featA.colorHistogram)
            : 0;

          if (dist <= DHASH_DISTANCE_THRESHOLD && colorDist <= COLOR_HISTOGRAM_TOLERANCE) {
            // Match found! Append to existing open batch and update latest stored hash
            const candId = stableId(candidate);
            const candIso = toIso(extractPhotoTimestampMs(candidate, openBatch.photoIds.length));

            orphansToAppend.push(candidate);
            openBatch.photoIds.push(candId);
            openBatch.endTime = candIso;
            // Replace the latest hash with the new photo's hash in local storage
            openBatch.lastPhotoHash = candidateHash;

            // Recompute best shot across hydrated photos in the batch
            const batchPhotos = openBatch.photoIds
              .map((id: string) => photosByStableId.get(id))
              .filter((p: GalleryPhotoItem | undefined): p is GalleryPhotoItem => p !== undefined);
            const bestShot =
              batchPhotos.length > 0 ? selectBestShotId(batchPhotos).bestShotId : candId;
            openBatch.bestShotPhotoId = bestShot;

            await appendPhotoToBatch(openBatch.id, candId, candIso, candidateHash, bestShot);
            appendedToSeedCount++;
            continue;
          }
        }
        // If similarity check fails, the open batch boundary closes
        break;
      }

      if (orphansToAppend.length > 0) {
        const appendedSet = new Set(orphansToAppend.map(stableId));
        unassignedOrphans = unassignedOrphans.filter(p => !appendedSet.has(stableId(p)));
        console.log(
          `[BatchingService] Appended ${orphansToAppend.length} photo(s) to existing batch ${openBatch.id} and updated latest stored hash.`,
        );
      }
    }

    // Step 4: Pure visual clustering for remaining orphan photos
    const newBatches: PersistedBatch[] = [];

    if (unassignedOrphans.length > 0) {
      const clusters = clusterPhotosByVisualSimilarity(
        unassignedOrphans.map(stableId),
        featuresMap,
        DHASH_DISTANCE_THRESHOLD,
        COLOR_HISTOGRAM_TOLERANCE,
      );

      // Step 5: Pure-Skia best shot selection & batch construction for new clusters
      for (const clusterPhotoIds of clusters) {
        const clusterPhotos = clusterPhotoIds
          .map(id => photosByStableId.get(id))
          .filter((p): p is GalleryPhotoItem => p !== undefined)
          .sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));

        if (clusterPhotos.length === 0) continue;

        const { bestShotId } = await selectClusterBestShot(
          clusterPhotoIds,
          photosByStableId,
          featuresMap,
        );

        const firstPhoto = clusterPhotos[0];
        const lastPhoto = clusterPhotos[clusterPhotos.length - 1];
        const repHash = featuresMap.get(stableId(firstPhoto))?.dHash || firstPhoto.pHash || null;
        const lastHash = featuresMap.get(stableId(lastPhoto))?.dHash || lastPhoto.pHash || null;

        newBatches.push({
          id: `batch-${stableId(firstPhoto)}`,
          photoIds: clusterPhotos.map(stableId),
          startTime: toIso(extractPhotoTimestampMs(firstPhoto, 0)),
          endTime: toIso(extractPhotoTimestampMs(lastPhoto, clusterPhotos.length - 1)),
          representativeFaceCount: firstPhoto.qualityResult?.faceCount ?? null,
          representativeHash: repHash,
          lastPhotoHash: lastHash,
          bestShotPhotoId: bestShotId || stableId(firstPhoto),
          provisional: repHash == null,
        });
      }

      // Step 6: Persist new batches to disk
      if (newBatches.length > 0) {
        await saveBatchResults(newBatches);
      }
    }

    const duration = performance.now() - tStart;
    const multiCount = newBatches.filter(b => b.photoIds.length > 1).length;
    const singleCount = newBatches.length - multiCount;

    console.log(
      `[BatchingService] Pure-Skia batching completed in ${duration.toFixed(0)}ms: ` +
        `${orphanPhotos.length} photos (${appendedToSeedCount} joined previous batch, ${newBatches.length} new batches formed: ` +
        `${multiCount} multi-photo clusters, ${singleCount} singletons).`,
    );
  }

  // Step 6: Return complete assignment map from all persisted batches
  const allBatches = await getAllPersistedBatches();
  const assignmentMap = new Map<string, string>();
  for (const batch of allBatches) {
    for (const pid of batch.photoIds) {
      assignmentMap.set(pid, batch.id);
    }
  }

  return assignmentMap;
}

// ── Gallery Row Flattening (from persisted batches + hydrated photos) ──────────

/**
 * Builds the ordered list of RuntimeBatch objects for rendering, combining:
 *  - The ordered `allBatches` from persistence
 *  - Hydrated `photos` (the current in-memory GalleryPhotoItem list)
 *
 * Photos that are NOT in any batch (shouldn't happen after `assignPhotoBatchesPersisted`,
 * but possible before the async call completes) are treated as singletons.
 */
export function hydrateBatchesForRender(
  allBatches: PersistedBatch[],
  photos: GalleryPhotoItem[],
): RuntimeBatch[] {
  const photoByStableId = new Map<string, GalleryPhotoItem>();
  for (const p of photos) {
    photoByStableId.set(stableId(p), p);
  }

  const result: RuntimeBatch[] = [];
  for (const batch of allBatches) {
    const hydratedPhotos: GalleryPhotoItem[] = [];
    for (const pid of batch.photoIds) {
      const photo = photoByStableId.get(pid);
      if (photo) {
        hydratedPhotos.push(photo);
      }
    }
    if (hydratedPhotos.length === 0) continue; // batch has no visible photos (filtered out)

    const endMs = Date.parse(batch.endTime);
    const bestShot =
      batch.bestShotPhotoId ??
      (hydratedPhotos.length > 0 ? selectBestShotId(hydratedPhotos).bestShotId : null);

    result.push({
      id: batch.id,
      photoIds: batch.photoIds,
      photos: hydratedPhotos,
      startTime: batch.startTime,
      endTime: batch.endTime,
      lastPhotoTimeMs: isNaN(endMs) ? Date.now() : endMs,
      representativeFaceCount: batch.representativeFaceCount,
      representativeHash: batch.representativeHash,
      lastPhotoHash: batch.lastPhotoHash,
      bestShotPhotoId: bestShot,
      isOpen: false,
    });
  }

  return result;
}

// ── Synchronous fallback batching ─────────────────────────────────────────────

/**
 * Pure synchronous batch computation from a photo list.
 * Does NOT consult persistence — used as the fallback while the async
 * `assignPhotoBatchesPersisted` call is in-flight on first load.
 *
 * ANALYSIS-READY GATE: Only photos whose pHash has been computed are batched.
 * Photos still waiting for Skia/ML Kit analysis are excluded — they will be
 * picked up by the async persistence effect once their pHash arrives.
 * This prevents the sync fallback from producing null-hash batches that
 * conflict with what persistence will eventually write.
 */
export function buildPhotoBatchesSync(photos: GalleryPhotoItem[]): RuntimeBatch[] {
  if (photos.length === 0) return [];

  // Apply the same analysis-ready gate used by assignPhotoBatchesPersisted.
  const readyPhotos = photos.filter(p => p.pHash != null || p.qualityResult?.pHash != null);

  if (readyPhotos.length === 0) return [];

  const { newBatches } = runSequentialAlgorithm(readyPhotos, null);
  return newBatches.map(pb => {
    const bPhotos = readyPhotos.filter(p => pb.photoIds.includes(stableId(p)));
    const bestShot =
      pb.bestShotPhotoId ?? (bPhotos.length > 0 ? selectBestShotId(bPhotos).bestShotId : null);

    return {
      id: pb.id,
      photoIds: pb.photoIds,
      photos: bPhotos,
      startTime: pb.startTime,
      endTime: pb.endTime,
      lastPhotoTimeMs: Date.parse(pb.endTime),
      representativeFaceCount: pb.representativeFaceCount,
      representativeHash: pb.representativeHash,
      lastPhotoHash: pb.lastPhotoHash,
      bestShotPhotoId: bestShot,
      isOpen: false,
    };
  });
}

// ── Batch Label & Section Helpers ───────────────────────────────────────────

/**
 * Formats a batch's start and end timestamps into a clean human time string:
 * e.g. "10:00 AM" or "10:00 AM – 10:03 AM"
 */
function formatBatchTimeString(startTimeIso: string, endTimeIso: string): string {
  const startMs = Date.parse(startTimeIso);
  const endMs = Date.parse(endTimeIso);
  if (isNaN(startMs)) return '';

  const formatTime = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const startFormatted = formatTime(startMs);
  if (isNaN(endMs)) return startFormatted;

  const endFormatted = formatTime(endMs);
  if (startFormatted === endFormatted) {
    return startFormatted;
  }
  return `${startFormatted} – ${endFormatted}`;
}

/**
 * Returns a human-readable title for a SectionList batch section header:
 * e.g. "10:00 AM – Batch 1 (2 photos)" or "10:00 AM – 10:03 AM · Batch 2 (4 photos)"
 */
export function batchSectionTitle(batch: RuntimeBatch, batchIndex: number): string {
  const count = batch.photos.length;
  const photoWord = count === 1 ? 'photo' : 'photos';
  const timeStr = formatBatchTimeString(batch.startTime, batch.endTime);

  const batchTag = `Batch ${batchIndex}`;
  const countTag = `(${count} ${photoWord})`;

  if (timeStr) {
    return `${timeStr} – ${batchTag} ${countTag}`;
  }
  return `${batchTag} ${countTag}`;
}

/**
 * Optional subtitle/badge for the batch header.
 * Face count has been removed from batch headers to eliminate clutter and reflect
 * pure visual similarity grouping (matching Google Photos / standard gallery apps).
 */
export function batchSectionSubtitle(_batch: RuntimeBatch): string | null {
  return null;
}

/**
 * Row structure for SectionList: either a collapsed hero card or a 3-column grid row.
 */
export type GallerySectionRow =
  | {
      type: 'hero_collapsed';
      rowKey: string;
      heroPhoto: GalleryPhotoItem;
      heroPhotoIndex: number;
      totalPhotos: number;
      batch: RuntimeBatch;
      batchIndex: number;
    }
  | {
      type: 'grid_row';
      rowKey: string;
      photos: { photo: GalleryPhotoItem; photoIndex: number; isBestShot: boolean }[];
    };

/**
 * Canonical Section structure for React Native SectionList.
 */
export interface GalleryBatchSection {
  batch: RuntimeBatch;
  batchIndex: number;
  title: string;
  subtitle: string | null;
  key: string;
  isCollapsed: boolean;
  isMultiPhoto: boolean;
  bestShotPhoto: GalleryPhotoItem | null;
  data: GallerySectionRow[];
}

/**
 * Builds an array of GalleryBatchSection items ready for SectionList.
 * Renders all photos directly in a 3-column grid per batch, with the best-shot badge on top pick.
 */
export function buildGallerySections(
  batches: RuntimeBatch[],
  allFilteredPhotos: GalleryPhotoItem[],
  _expandedBatchIds?: Set<string>,
): GalleryBatchSection[] {
  const photoIndexMap = new Map<string, number>();
  allFilteredPhotos.forEach((p, idx) => {
    photoIndexMap.set(p.id, idx);
    if (p.filename) {
      photoIndexMap.set(p.filename, idx);
    }
  });

  const sections: GalleryBatchSection[] = [];
  let batchCounter = 0;

  for (const batch of batches) {
    if (!batch.photos || batch.photos.length === 0) continue;

    batchCounter++;
    const batchIndex = batchCounter;
    const title = `Batch ${batchIndex}`;
    const timeStr =
      formatBatchTimeString(batch.startTime, batch.endTime) || batch.photos[0]?.timestamp || '';
    const subtitle = timeStr;

    // Identify best shot photo in this batch
    let bestShotPhoto: GalleryPhotoItem | null = null;
    if (batch.photos.length > 1) {
      if (batch.bestShotPhotoId) {
        bestShotPhoto =
          batch.photos.find(
            p => p.id === batch.bestShotPhotoId || p.filename === batch.bestShotPhotoId,
          ) ?? null;
      }
      if (!bestShotPhoto) {
        const { bestShotId } = selectBestShotId(batch.photos);
        bestShotPhoto =
          batch.photos.find(p => p.id === bestShotId || p.filename === bestShotId) ??
          batch.photos[0];
      }
    }

    const rows: GallerySectionRow[] = [];
    const bestId = bestShotPhoto?.filename || bestShotPhoto?.id;

    for (let i = 0; i < batch.photos.length; i += 3) {
      const slice = batch.photos.slice(i, i + 3);
      rows.push({
        type: 'grid_row',
        rowKey: `${batch.id}-row-${i / 3}`,
        photos: slice.map(photo => ({
          photo,
          photoIndex:
            photoIndexMap.get(photo.id) ??
            (photo.filename ? photoIndexMap.get(photo.filename) : undefined) ??
            0,
          isBestShot: Boolean(bestId && (photo.filename || photo.id) === bestId),
        })),
      });
    }

    sections.push({
      batch,
      batchIndex,
      title,
      subtitle,
      key: `section-${batch.id}`,
      isCollapsed: false,
      isMultiPhoto: batch.photos.length > 1,
      bestShotPhoto,
      data: rows,
    });
  }

  return sections;
}

// Re-export core algorithm for simulation and unit testing
export { runSequentialAlgorithm };
