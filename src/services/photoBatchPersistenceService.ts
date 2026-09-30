/**
 * photoBatchPersistenceService.ts
 *
 * Persists photo batch assignments to local JSON storage so that:
 *  - Batch assignments survive app restarts
 *  - A photo's batch assignment NEVER changes once made (no retroactive re-batching)
 *
 * Storage model mirrors photoQualityPersistenceService.ts — a flat JSON file on
 * documentDirectory with an in-memory Map for O(1) reads.
 *
 * JSON schema on disk:
 * {
 *   "batches": {
 *     "<batchId>": { id, photoIds, startTime, endTime, representativeFaceCount }
 *   },
 *   "photoToBatch": {
 *     "<stablePhotoId>": "<batchId>"
 *   }
 * }
 *
 * Stable photo ID convention (same as quality persistence): the camera filename
 * (e.g. "IMG_2048.JPG"), which is invariant across MediaLibrary re-indexing.
 */

import * as FileSystem from 'expo-file-system/legacy';

// ── Canonical Batch Data Model (matches the prompt's schema exactly) ───────────

/**
 * Persisted batch record.
 *
 * ⚠️ IMMUTABILITY RULE: Once a batch is written to disk, its `photoIds`,
 * `startTime`, and `representativeFaceCount` are read-only. Only `endTime`
 * and `photoIds` (append-only) may be updated when the batch is still the
 * "current open batch" at the end of a session.
 *
 * After the session ends (app restarts), the batch is permanently closed:
 * no new photo can ever be added to it, and no field can be mutated.
 *
 * EXCEPTION — Provisional repair: if `provisional === true` the batch was
 * frozen before its representative photo's analysis (dHash + faceCount) had
 * completed. `repairProvisionalBatches()` is allowed to backfill
 * `representativeHash` / `representativeFaceCount` / `lastPhotoHash` from
 * real analysis results and clear the `provisional` flag. No other field is
 * ever mutated after initial write.
 */
export interface PersistedBatch {
  /** Deterministic batch ID: "batch-<firstPhotoStableId>" */
  id: string;
  /** Stable photo IDs (camera filenames) in arrival order. Append-only. */
  photoIds: string[];
  /** ISO 8601 timestamp of the FIRST photo that opened the batch. Read-only once set. */
  startTime: string;
  /**
   * ISO 8601 timestamp of the MOST RECENT photo in this batch.
   * Updated on each append while the batch is open; frozen on session end.
   */
  endTime: string;
  /**
   * Face count of the FIRST photo (the batch's representative). Read-only once set.
   * null when the first photo had no quality result available at batching time.
   */
  representativeFaceCount: number | null;
  /**
   * 64-bit perceptual hash (dHash) of the FIRST photo in the batch.
   * null only when `provisional === true` (analysis had not completed yet).
   */
  representativeHash?: string | null;
  /**
   * 64-bit perceptual hash (dHash) of the MOST RECENT photo added to this batch.
   * New incoming photos are compared against this hash for consecutive visual continuity.
   */
  lastPhotoHash?: string | null;
  /**
   * True when this batch was created before its representative photo's analysis
   * (dHash + faceCount) had finished. The batch's photo membership may be wrong
   * because comparisons were made against null signatures.
   *
   * `repairProvisionalBatches()` will re-evaluate and re-assign photos in any
   * provisional batch once real analysis data is available, then clear this flag.
   */
  provisional?: boolean;
  /**
   * Stable photo ID (camera filename) of the recommended best-shot photo
   * in this batch, computed via composite scoring (computeShotScore).
   */
  bestShotPhotoId?: string | null;
}

const BATCH_CACHE_PATH = `${FileSystem.documentDirectory}ente_batch_cache_v3.json`;

/**
 * Clears all in-memory and disk persisted batches.
 */
export async function clearAllPersistedBatches(): Promise<void> {
  batchById.clear();
  batchIdByPhotoId.clear();
  lastOpenBatchId = null;
  isLoaded = true;
  try {
    const info = await FileSystem.getInfoAsync(BATCH_CACHE_PATH);
    if (info.exists) {
      await FileSystem.deleteAsync(BATCH_CACHE_PATH, { idempotent: true });
    }
  } catch (err) {
    console.warn('[BatchPersistence] Failed to delete cache file:', err);
  }
}

interface DiskSchema {
  batches: Record<string, PersistedBatch>;
  /** Reverse index: stablePhotoId → batchId */
  photoToBatch: Record<string, string>;
  /**
   * ID of the last open batch from the previous session.
   * Null after the first flush (session ended → all batches are closed).
   *
   * On the NEXT session, the algorithm tries to join new photos to this batch
   * if they pass the similarity gates — but ONLY for the first comparison check.
   * If the very first new photo fails the gate, the reference is discarded and
   * a new batch is opened.  Cross-session open-batch continuity is strictly
   * one-shot: a new photo either joins the last batch immediately or never does.
   */
  lastOpenBatchId: string | null;
}

// ── In-memory Layer ────────────────────────────────────────────────────────────

const batchById = new Map<string, PersistedBatch>();
const batchIdByPhotoId = new Map<string, string>(); // stablePhotoId → batchId
let lastOpenBatchId: string | null = null;
let isLoaded = false;
let loadPromise: Promise<void> | null = null;

// ── Debounced Flush ────────────────────────────────────────────────────────────
//
// Coalesces all writes within FLUSH_DEBOUNCE_MS into a single disk write.
// With 200+ photos arriving in quick succession, this prevents 200 sequential
// JSON writes; instead the in-memory state is updated immediately and the disk
// is written once after the burst settles.

const FLUSH_DEBOUNCE_MS = 300;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return; // already scheduled — nothing to do
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToDisk().catch(() => {});
  }, FLUSH_DEBOUNCE_MS);
}

// ── Internal Helpers ───────────────────────────────────────────────────────────

async function ensureLoaded(): Promise<void> {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(BATCH_CACHE_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(BATCH_CACHE_PATH, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const parsed: DiskSchema = JSON.parse(raw);

        // Hydrate in-memory maps
        for (const [id, batch] of Object.entries(parsed.batches || {})) {
          batchById.set(id, batch);
        }
        for (const [photoId, batchId] of Object.entries(parsed.photoToBatch || {})) {
          batchIdByPhotoId.set(photoId, batchId);
        }
        lastOpenBatchId = parsed.lastOpenBatchId ?? null;

        console.log(
          `[BatchPersistence] Loaded ${batchById.size} batches, ${batchIdByPhotoId.size} photo assignments from disk.`,
        );
      }
    } catch (err) {
      console.warn('[BatchPersistence] Failed to load cache — starting fresh:', err);
    } finally {
      isLoaded = true;
    }
  })();

  return loadPromise;
}

async function flushToDisk(): Promise<void> {
  try {
    const schema: DiskSchema = {
      batches: {},
      photoToBatch: {},
      lastOpenBatchId,
    };
    for (const [id, batch] of batchById.entries()) {
      schema.batches[id] = batch;
    }
    for (const [photoId, batchId] of batchIdByPhotoId.entries()) {
      schema.photoToBatch[photoId] = batchId;
    }
    await FileSystem.writeAsStringAsync(BATCH_CACHE_PATH, JSON.stringify(schema), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    console.warn('[BatchPersistence] Failed to flush to disk:', err);
  }
}
// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the "last open batch" from the previous session — the batch whose
 * `endTime` is most recent. Used by the batching algorithm to check whether
 * the very first new photo in this session should continue that batch.
 *
 * Returns null if no batches exist yet or if no open-batch reference was saved.
 */
export async function getLastOpenBatch(): Promise<PersistedBatch | null> {
  await ensureLoaded();
  if (!lastOpenBatchId) return null;
  return batchById.get(lastOpenBatchId) ?? null;
}

/**
 * Filters the given stable photo IDs down to those that are NOT yet assigned
 * to any persisted batch. The caller should run the sequential batching
 * algorithm only on these "orphan" photos.
 *
 * @param stablePhotoIds - Array of camera filenames to check
 * @returns Subset of the input that has no batch assignment yet
 */
export async function getUnassignedPhotoIds(stablePhotoIds: string[]): Promise<string[]> {
  await ensureLoaded();
  return stablePhotoIds.filter(id => !batchIdByPhotoId.has(id));
}

/**
 * Appends a photo to an EXISTING batch (used when a new photo joins the
 * last open batch from a previous session — the only cross-session append allowed).
 *
 * Updates `endTime` and `photoIds` in place on the in-memory record,
 * then flushes to disk asynchronously.
 *
 * IMMUTABILITY: `startTime`, `representativeFaceCount`, and `id` are never changed.
 *
 * @param batchId      - ID of the existing batch to append to
 * @param stablePhotoId - Stable ID (filename) of the new photo
 * @param endTimeIso   - ISO timestamp of the new photo (becomes the new endTime)
 */
export async function appendPhotoToBatch(
  batchId: string,
  stablePhotoId: string,
  endTimeIso: string,
  newLastPhotoHash?: string | null,
  newBestShotPhotoId?: string | null,
): Promise<void> {
  await ensureLoaded();

  const existing = batchById.get(batchId);
  if (!existing) {
    console.warn(`[BatchPersistence] appendPhotoToBatch: batch ${batchId} not found`);
    return;
  }

  // Guard: never re-assign an already-assigned photo
  if (batchIdByPhotoId.has(stablePhotoId)) {
    console.warn(
      `[BatchPersistence] Photo ${stablePhotoId} is already in batch ${batchIdByPhotoId.get(stablePhotoId)} — skipping append`,
    );
    return;
  }

  existing.photoIds.push(stablePhotoId);
  existing.endTime = endTimeIso;
  if (newLastPhotoHash !== undefined) {
    existing.lastPhotoHash = newLastPhotoHash;
  }
  if (newBestShotPhotoId !== undefined) {
    existing.bestShotPhotoId = newBestShotPhotoId;
  }
  batchIdByPhotoId.set(stablePhotoId, batchId);
  lastOpenBatchId = batchId; // keep this as the open batch

  scheduleFlush();
}

/**
 * Saves multiple new batches in one call (used after running the sequential
 * algorithm over a full set of new photos). The last batch in the array is
 * treated as the "current open batch" for the next session.
 */
export async function saveBatchResults(batches: PersistedBatch[]): Promise<void> {
  if (batches.length === 0) return;
  await ensureLoaded();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const isLast = i === batches.length - 1;

    batchById.set(batch.id, batch);
    for (const photoId of batch.photoIds) {
      batchIdByPhotoId.set(photoId, batch.id);
    }

    if (isLast) {
      lastOpenBatchId = batch.id;
    }
  }

  // Single disk flush for all batches
  scheduleFlush();
  console.log(`[BatchPersistence] Saved ${batches.length} new batch(es) to disk.`);
}

/**
 * Updates an existing persisted batch record (e.g. when lastPhotoHash or bestShotPhotoId changes).
 */
export async function updateBatch(batch: PersistedBatch): Promise<void> {
  await ensureLoaded();
  batchById.set(batch.id, batch);
  for (const photoId of batch.photoIds) {
    batchIdByPhotoId.set(photoId, batch.id);
  }
  scheduleFlush();
}

/**
 * Returns all persisted batches, ordered by startTime ascending.
 * Used to reconstruct the complete batch layout on app restart.
 */
export async function getAllPersistedBatches(): Promise<PersistedBatch[]> {
  await ensureLoaded();
  const all = Array.from(batchById.values());
  return all.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * Migration/repair pass: finds all persisted batches where `provisional === true`
 * or `representativeHash` is null/undefined, calls the provided `resolveSignature`
 * callback for each, and backfills real values when the callback returns them.
 *
 * This should be called once at the start of each session, BEFORE the sequential
 * batching algorithm runs, so that subsequent comparisons use real hash data.
 *
 * The callback receives the stable ID of the batch's REPRESENTATIVE photo (the
 * first photo in `batch.photoIds`) and must return:
 *   `{ hash: string | null; faceCount: number | null; lastHash: string | null }`
 * or `null` if real analysis data is not yet available for that photo.
 *
 * @param resolveSignature - Async function that looks up real analysis data
 *                           for a given stable photo ID
 * @returns Number of batches successfully repaired in this pass
 */
export async function repairProvisionalBatches(
  resolveSignature: (stablePhotoId: string) => Promise<{
    hash: string | null;
    faceCount: number | null;
    lastHash: string | null;
  } | null>,
): Promise<number> {
  await ensureLoaded();

  const provisionalBatches = Array.from(batchById.values()).filter(
    b => b.provisional === true || b.representativeHash == null,
  );

  if (provisionalBatches.length === 0) {
    return 0;
  }

  console.log(
    `[BatchPersistence] Running provisional batch repair on ${provisionalBatches.length} batch(es)...`,
  );

  let repairedCount = 0;
  for (const batch of provisionalBatches) {
    const repPhotoId = batch.photoIds[0];
    if (!repPhotoId) continue;

    const resolved = await resolveSignature(repPhotoId);
    if (resolved === null) {
      // Analysis still not available — leave provisional, retry next session
      console.log(
        `[BatchPersistence] Provisional batch ${batch.id}: analysis not ready for rep photo ${repPhotoId}, deferring repair`,
      );
      continue;
    }

    batch.representativeHash = resolved.hash;
    batch.representativeFaceCount = resolved.faceCount;
    batch.lastPhotoHash = resolved.lastHash;
    batch.provisional = false;
    repairedCount++;
  }

  if (repairedCount > 0) {
    scheduleFlush();
    console.log(
      `[BatchPersistence] Repaired ${repairedCount} provisional batch(es). Flushing to disk.`,
    );
  }

  return repairedCount;
}

/**
 * Returns true if any loaded batch is provisional (null hash — created before
 * analysis completed). This is an O(1) check once the cache is loaded.
 *
 * Use this as a fast early-exit guard before calling `repairProvisionalBatches()`:
 *
 *   if (hasProvisionalBatches()) {
 *     await repairProvisionalBatches(resolver);
 *   }
 */
export function hasProvisionalBatches(): boolean {
  // Note: this is synchronous — only valid after ensureLoaded() has been awaited
  for (const batch of batchById.values()) {
    if (batch.provisional === true || batch.representativeHash == null) {
      return true;
    }
  }
  return false;
}
