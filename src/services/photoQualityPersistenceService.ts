import * as FileSystem from 'expo-file-system/legacy';
import { PhotoQualityResult } from './photoQualityService';

// ── Storage ────────────────────────────────────────────────────────────────

/** Flat JSON file: { [cacheKey]: PhotoQualityResult } */
const QUALITY_CACHE_PATH = `${FileSystem.documentDirectory}ente_quality_cache.json`;

// ── In-memory layer ────────────────────────────────────────────────────────

/**
 * In-memory Map used for O(1) reads without disk I/O on every analysis check.
 * Populated once from disk on first access via ensureLoaded().
 */
const memoryCache = new Map<string, PhotoQualityResult>();
let isLoaded = false;
let loadPromise: Promise<void> | null = null;

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Loads persisted quality results from disk into the in-memory map.
 * Safe to call concurrently — subsequent calls await the same promise.
 */
async function ensureLoaded(): Promise<void> {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(QUALITY_CACHE_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(QUALITY_CACHE_PATH, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const parsed: Record<string, PhotoQualityResult> = JSON.parse(raw);
        for (const [key, value] of Object.entries(parsed)) {
          memoryCache.set(key, value);
        }
        console.log(
          `[QualityPersistence] Loaded ${memoryCache.size} cached quality results from disk.`,
        );
      }
    } catch (err) {
      console.warn('[QualityPersistence] Failed to load cache from disk — starting fresh:', err);
    } finally {
      isLoaded = true;
    }
  })();

  return loadPromise;
}

/**
 * Serialises the in-memory map to the JSON file.
 * Fire-and-forget: errors are logged but not thrown.
 */
async function flushToDisk(): Promise<void> {
  try {
    const obj: Record<string, PhotoQualityResult> = {};
    for (const [key, value] of memoryCache.entries()) {
      obj[key] = value;
    }
    await FileSystem.writeAsStringAsync(QUALITY_CACHE_PATH, JSON.stringify(obj), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    console.warn('[QualityPersistence] Failed to flush cache to disk:', err);
  }
}

/**
 * Derives the cache key from a filename or URI.
 *
 * Strategy: extract the basename so the key remains stable regardless of
 * whether the caller passes a full file:// URI or just the filename. Since
 * every photo in DCIM/Entephoto has a unique filename assigned by the camera,
 * the basename is a reliable cross-session identifier.
 */
function cacheKey(filenameOrUri: string): string {
  const normalized = filenameOrUri.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filenameOrUri;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the persisted quality analysis result for the given photo.
 * Pass either the original filename (e.g. `IMG_1234.jpg`) or the full
 * `file://` URI — the cache key is derived from the basename in both cases.
 *
 * Returns `null` on a cache miss.
 */
export async function loadQualityResult(filenameOrUri: string): Promise<PhotoQualityResult | null> {
  await ensureLoaded();
  return memoryCache.get(cacheKey(filenameOrUri)) ?? null;
}

/**
 * Returns all persisted quality results as a Map (filename -> PhotoQualityResult).
 * Used during directory scanning for instant cross-session hydration.
 */
export async function loadAllQualityResults(): Promise<Map<string, PhotoQualityResult>> {
  await ensureLoaded();
  return new Map(memoryCache);
}

/**
 * Persists a quality analysis result for the given photo.
 *
 * Writes to the in-memory map immediately (so subsequent `loadQualityResult`
 * calls within the same session are instant), then flushes to disk
 * asynchronously without blocking the caller.
 */
export async function saveQualityResult(
  filenameOrUri: string,
  result: PhotoQualityResult,
): Promise<void> {
  await ensureLoaded();
  memoryCache.set(cacheKey(filenameOrUri), result);
  // Non-blocking disk write — pipeline is not delayed by I/O
  flushToDisk().catch(() => {});
}

/**
 * Clears all persisted quality results from both memory and disk.
 *
 * Useful if quality thresholds (BLUR_THRESHOLD, EXPOSURE_THRESHOLD) change
 * and all photos need to be re-analysed on the next app launch.
 */
export async function clearAllQualityResults(): Promise<void> {
  memoryCache.clear();
  isLoaded = false;
  loadPromise = null;
  try {
    await FileSystem.deleteAsync(QUALITY_CACHE_PATH, { idempotent: true });
    console.log('[QualityPersistence] All cached quality results cleared.');
  } catch (err) {
    console.warn('[QualityPersistence] Failed to clear disk cache:', err);
  }
}
