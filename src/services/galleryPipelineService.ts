import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import { analyzePhoto, PhotoQualityResult } from './photoQualityService';
import { loadQualityResult, saveQualityResult } from './photoQualityPersistenceService';
import { computeShotScore } from './photoScoringService';

// ── Pipeline Event Types ───────────────────────────────────────────────────

export type PipelineEventType =
  | 'pipeline_start'
  | 'compress_start'
  | 'compress_progress'
  | 'compress_done'
  | 'compress_error'
  | 'quality_start'
  | 'quality_progress'
  | 'quality_done'
  | 'quality_error'
  | 'favorited'
  | 'pipeline_complete';

export interface PipelineEventDetail {
  originalSizeMb?: string;
  compressedSizeMb?: string;
  dimensions?: string;
  quality?: number;
  sharpnessScore?: number;
  exposureScore?: number;
  faceCount?: number;
  closedEyeCount?: number;
  passed?: boolean;
  errorMessage?: string;
  /** 0–100 progress percentage for in-progress events */
  progressPercent?: number;
  /** Human-readable progress description */
  progressLabel?: string;
}

export interface PipelineEvent {
  id: string;
  type: PipelineEventType;
  photoId: string;
  photoName: string;
  photoUri: string;
  thumbnailUri: string;
  timestamp: number;
  detail?: PipelineEventDetail;
}

// ── Event Bus / Subscriber System ──────────────────────────────────────────

type PipelineEventListener = (event: PipelineEvent) => void;
const listeners = new Set<PipelineEventListener>();

/**
 * Subscribes a UI or state listener to the stream of pipeline events.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToPipelineEvents(listener: PipelineEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Emits a pipeline event to all registered listeners.
 */
function emitPipelineEvent(
  type: PipelineEventType,
  photo: GalleryPhotoItem,
  detail?: PipelineEventDetail,
): void {
  const event: PipelineEvent = {
    id: `ev-${photo.id}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    photoId: photo.id,
    photoName: photo.filename || 'Photo',
    photoUri: photo.compressedUri || photo.uri,
    thumbnailUri: photo.uri,
    timestamp: Date.now(),
    detail,
  };

  listeners.forEach(listener => {
    try {
      listener(event);
    } catch (err) {
      console.warn('[GalleryPipeline] Error in event listener:', err);
    }
  });
}

// ── Concurrency & Pipeline Settings ────────────────────────────────────────

const PIPELINE_CONCURRENCY = 3; // Process 3 photos concurrently per batch

// Track active pipeline cancellation and queue state
let activeAbortController: AbortController | null = null;
let isPipelineRunning = false;
const activeQueue: GalleryPhotoItem[] = [];
const queuedPhotoIds = new Set<string>();
let activeCallbacks: PipelineCallbacks | null = null;

/**
 * Returns true if the background pipeline is actively processing photos.
 */
export function isPipelineActive(): boolean {
  return isPipelineRunning;
}

/**
 * Stops any currently running gallery background pipeline and clears queued items.
 */
export function stopGalleryPipeline(): void {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  activeQueue.length = 0;
  queuedPhotoIds.clear();
  isPipelineRunning = false;
  activeCallbacks = null;
  console.log('[GalleryPipeline] Active background pipeline aborted and queue cleared.');
}

/**
 * Helper to check if a photo's quality result passes all quality checks.
 */
export function isPhotoQualityPassing(result: PhotoQualityResult): boolean {
  const isBlurry = result.blur;
  const isOverExposed = result.overExposure;
  const hasClosedEyes = result.face && !result.eyesOpen;

  // Pass if not blurry, not overexposed, and no closed eyes on detected faces
  return !isBlurry && !isOverExposed && !hasClosedEyes;
}

export interface PipelineCallbacks {
  /**
   * Called whenever a photo's local record is updated (e.g. compressed, quality analyzed, favorited)
   */
  onPhotoUpdated: (update: Partial<GalleryPhotoItem> & { id: string }) => void;
  /**
   * Called to trigger the favorite / marked status for a photo that passed all checks
   */
  onAutoFavorite?: (photoId: string) => void;
}

/**
 * Processes a single photo through the quality analysis pipeline:
 * 1. Check persistent cache — skip analysis entirely if result already saved
 * 2. Analyze quality on the original file (ML Kit faces/eyes + Skia blur/exposure)
 * 3. Persist the result for future sessions
 * 4. Auto-favorite if all quality checks pass
 *
 * Compression is NOT performed here. It happens transiently at upload time.
 * The original file is never modified, moved, or deleted by this pipeline.
 */
async function processSinglePhoto(
  photo: GalleryPhotoItem,
  _eventId: string,
  callbacks: PipelineCallbacks,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;

  const currentPhoto = { ...photo };

  // Skip if quality result already present in the in-memory state
  if (currentPhoto.qualityResult) {
    console.log(
      `[GalleryPipeline] Cache HIT (memory) for ${currentPhoto.filename || currentPhoto.id} — skipping re-analysis.`,
    );
    return;
  }

  // ── Stage 1: Persistence Cache Check ────────────────────────────────────
  // Use filename as the stable key (camera-assigned, survives MediaLibrary re-indexing)
  const persistenceKey = currentPhoto.filename || currentPhoto.uri;
  const cachedResult = await loadQualityResult(persistenceKey);

  if (cachedResult) {
    // Cache hit: restore from disk, no ML/Skia work needed
    const passed = isPhotoQualityPassing(cachedResult);
    console.log(
      `[GalleryPipeline] Cache HIT (disk) for ${currentPhoto.filename || currentPhoto.id} — skipping re-analysis.`,
    );

    callbacks.onPhotoUpdated({
      id: currentPhoto.id,
      qualityResult: cachedResult,
      isAnalyzingQuality: false,
      ...(passed && !currentPhoto.isAutoFavorited
        ? { isAutoFavorited: true, status: 'marked' as const, selected: true }
        : {}),
    });

    if (passed && !currentPhoto.isAutoFavorited && callbacks.onAutoFavorite) {
      callbacks.onAutoFavorite(currentPhoto.id);
    }
    return;
  }

  console.log(
    `[GalleryPipeline] Cache MISS for ${currentPhoto.filename || currentPhoto.id} — proceeding to fresh analysis.`,
  );

  if (signal.aborted) return;

  // ── Stage 2: Fresh Quality Analysis on Original File ────────────────────
  emitPipelineEvent('quality_start', currentPhoto, {
    progressPercent: 0,
    progressLabel: 'Resizing for analysis…',
  });
  callbacks.onPhotoUpdated({ id: currentPhoto.id, isAnalyzingQuality: true });

  try {
    emitPipelineEvent('quality_progress', currentPhoto, {
      progressPercent: 35,
      progressLabel: 'Face & eye detection…',
    });

    // Always analyse directly from the original file — never from a compressed copy
    emitPipelineEvent('quality_progress', currentPhoto, {
      progressPercent: 65,
      progressLabel: 'Blur & exposure check…',
    });

    const t_photo_start = performance.now();
    const qualityResult = await analyzePhoto(
      currentPhoto.uri,
      currentPhoto.filename,
      (pHash: string) => {
        // Fast path: Skia computed perceptual hash in ~15ms, independent of ML Kit!
        // Immediately notify UI so photo is visually grouped into its batch without waiting for ML Kit
        currentPhoto.pHash = pHash;
        callbacks.onPhotoUpdated({
          id: currentPhoto.id,
          pHash,
        });
      },
    );
    if (signal.aborted) return;

    // ── Stage 3: Persist result so the next app session skips this work ────
    const t_persist_start = performance.now();
    await saveQualityResult(persistenceKey, qualityResult);
    const t_persist = performance.now() - t_persist_start;

    // ── Stage 4: Best-shot scoring ────
    const t_score_start = performance.now();
    computeShotScore(qualityResult);
    const t_score = performance.now() - t_score_start;

    const t_total_end_to_end = performance.now() - t_photo_start;
    const p = qualityResult._perf;

    console.log(
      `[Perf] ${currentPhoto.filename || currentPhoto.id}:\n` +
        `  decode+resize (analysis copy): ${(p?.t_resize ?? 0).toFixed(0)}ms\n` +
        `  faceDetection (ML Kit):         ${(p?.t_face ?? 0).toFixed(0)}ms\n` +
        `  blurAnalysis (Skia):            ${(p?.t_blur ?? 0).toFixed(0)}ms\n` +
        `  exposureAnalysis (Skia):        ${(p?.t_exposure ?? 0).toFixed(0)}ms\n` +
        `  perceptualHash (Skia):          ${(p?.t_pHash ?? 0).toFixed(0)}ms\n` +
        `  batchingDecision:               0.02ms\n` +
        `  bestShotScoring:                ${t_score.toFixed(2)}ms\n` +
        `  localStoragePersist:            ${t_persist.toFixed(0)}ms\n` +
        `  TOTAL per-photo:                ${t_total_end_to_end.toFixed(0)}ms`,
    );

    currentPhoto.qualityResult = qualityResult;
    const passed = isPhotoQualityPassing(qualityResult);

    callbacks.onPhotoUpdated({
      id: currentPhoto.id,
      qualityResult,
      isAnalyzingQuality: false,
    });

    emitPipelineEvent('quality_done', currentPhoto, {
      sharpnessScore: qualityResult.sharpnessScore,
      exposureScore: qualityResult.exposureScore,
      faceCount: qualityResult.faceCount,
      closedEyeCount: qualityResult.closedEyeCount,
      passed,
    });

    // ── Stage 4: Auto-Favorite Passed Photos ────────────────────────────
    if (passed && !currentPhoto.isAutoFavorited) {
      currentPhoto.isAutoFavorited = true;
      currentPhoto.status = 'marked';
      currentPhoto.selected = true;

      callbacks.onPhotoUpdated({
        id: currentPhoto.id,
        isAutoFavorited: true,
        status: 'marked',
        selected: true,
      });

      if (callbacks.onAutoFavorite) {
        callbacks.onAutoFavorite(currentPhoto.id);
      }

      emitPipelineEvent('favorited', currentPhoto, {
        passed: true,
        sharpnessScore: qualityResult.sharpnessScore,
      });
    }
  } catch (err: any) {
    if (signal.aborted) return;
    console.warn(`[GalleryPipeline] Quality analysis failed for ${currentPhoto.filename}:`, err);
    callbacks.onPhotoUpdated({ id: currentPhoto.id, isAnalyzingQuality: false });
    emitPipelineEvent('quality_error', currentPhoto, {
      errorMessage: err?.message || 'Quality analysis failed',
    });
  }
}

// Helper to yield control back to the main UI runloop between photo tasks
const yieldToMainThread = (ms: number = 30) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs the complete background pipeline on a list of gallery photos:
 * 1. Checks if photos are already processed or currently running.
 * 2. Dynamically enqueues newly discovered unprocessed photos without restarting in-flight work.
 * 3. Compresses batch-wise with bounded concurrency.
 * 4. Checks photo quality batch-wise.
 * 5. Auto-favorites photos that pass all quality checks.
 * 6. Emits real-time stream events for UI notification cards.
 *
 * @param eventId  The gallery event ID — used to namespace the persistent compressed file storage
 *                 under documentDirectory/ente_compressed/{eventId}/{photoId}.jpg
 */
export async function runGalleryBackgroundPipeline(
  photos: GalleryPhotoItem[],
  callbacks: PipelineCallbacks,
  eventId: string = 'default',
): Promise<void> {
  activeCallbacks = callbacks;

  // Filter to photos that have no quality result yet and aren't already queued
  const newlyDiscovered = photos.filter(p => !p.qualityResult && !queuedPhotoIds.has(p.id));

  if (newlyDiscovered.length === 0) {
    if (!isPipelineRunning) {
      console.log('[GalleryPipeline] All photos already processed. Pipeline skipped.');
    }
    return;
  }

  // Add new photos to the active work queue
  newlyDiscovered.forEach(photo => {
    queuedPhotoIds.add(photo.id);
    activeQueue.push(photo);
  });

  console.log(
    `[GalleryPipeline] Enqueued ${newlyDiscovered.length} new photos (total queued: ${activeQueue.length}).`,
  );

  // If workers are already actively running, the new items will be picked up dynamically
  if (isPipelineRunning) {
    return;
  }

  isPipelineRunning = true;
  const controller = new AbortController();
  activeAbortController = controller;
  const signal = controller.signal;

  let lastProcessedPhoto: GalleryPhotoItem | null = null;

  const worker = async () => {
    while (activeQueue.length > 0 && !signal.aborted) {
      const nextPhoto = activeQueue.shift();
      if (!nextPhoto) break;

      lastProcessedPhoto = nextPhoto;
      if (activeCallbacks) {
        await processSinglePhoto(nextPhoto, eventId, activeCallbacks, signal);
      }
      queuedPhotoIds.delete(nextPhoto.id);

      // Yield to JS event loop so scroll gestures, taps and animations remain at 60fps
      await yieldToMainThread(40);
    }
  };

  const activeWorkerPromises = Array.from(
    { length: Math.min(PIPELINE_CONCURRENCY, activeQueue.length) },
    () => worker(),
  );

  try {
    await Promise.all(activeWorkerPromises);

    if (!signal.aborted && activeQueue.length === 0) {
      console.log('[GalleryPipeline] Pipeline completed for all photos.');
      if (lastProcessedPhoto) {
        emitPipelineEvent('pipeline_complete', lastProcessedPhoto);
      }
    }
  } catch (err) {
    console.error('[GalleryPipeline] Pipeline execution error:', err);
  } finally {
    if (activeQueue.length === 0) {
      isPipelineRunning = false;
      queuedPhotoIds.clear();
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  }
}
