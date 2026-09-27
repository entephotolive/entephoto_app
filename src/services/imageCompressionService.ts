import { Image } from 'react-native';
import { manipulateAsync, SaveFormat, Action } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';

export interface CompressionResult {
  uri: string;
  sizeBytes: number;
  width: number;
  height: number;
  quality: number; // final JPEG quality used, 0–1
  hitFloor?: boolean;
  iterations?: number;
  originalSizeBytes?: number;
  /** True when the file was already small enough — no compression was performed */
  skipped?: boolean;
}

// ── Compression Configuration ──────────────────────────────────────────────

const SKIP_COMPRESSION_BYTES = 4 * 1024 * 1024; // 4 MB gate

/**
 * Target output range: stop as soon as the result lands ANYWHERE in [2 MB, 3 MB].
 * This prevents over-compressing a file that hit 2.9 MB early when a lower-quality
 * pass reaching 2.0 MB would have been unnecessary.
 */
const TARGET_MIN_BYTES = 2 * 1024 * 1024; // 2 MB floor of acceptable range
const TARGET_MAX_BYTES = 3 * 1024 * 1024; // 3 MB ceiling of acceptable range

/** Legacy single constant kept for call-sites that pass targetBytes directly */
export const TARGET_UPLOAD_BYTES = TARGET_MAX_BYTES;

const INITIAL_QUALITY = 0.85;
const QUALITY_STEP = 0.1;
const QUALITY_FLOOR = 0.4;
const MAX_QUALITY_ITERATIONS = 6;

// Dimension reduction floors (longest edge) for very high-megapixel files
const DIMENSION_STEPS = [4000, 3200, 2400, 1800, 1600];
const MIN_LONGEST_EDGE_FLOOR = 1600;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Retrieves the dimensions of an image safely.
 */
function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 }),
    );
  });
}

/**
 * Gets file size in bytes via expo-file-system's FileSystem.getInfoAsync,
 * which works on both file:// URIs and content:// URIs (Android MediaStore).
 */
async function getFileSizeBytes(fileUri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists && 'size' in info) {
      return (info as any).size ?? 0;
    }
    return 0;
  } catch (err) {
    console.warn('[ImageCompression] getFileSizeBytes failed for', fileUri, err);
    return 0;
  }
}

/**
 * Synchronous size helper for already-local file:// URIs using the File class.
 * Kept for places that cannot await (e.g. inside sync helpers).
 */
function getFileSizeInBytes(fileUri: string): number {
  try {
    const rawUri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
    const file = new File(rawUri);
    return (file as any).size ?? 0;
  } catch (err) {
    console.warn('[ImageCompression] Failed to get file size:', fileUri, err);
    return 0;
  }
}

/**
 * Safely removes a temporary cache file if it exists.
 */
export async function cleanupTempFile(fileUri: string): Promise<void> {
  try {
    const rawUri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
    const file = new File(rawUri);
    if (file.exists) {
      file.delete();
    }
  } catch (err) {
    console.warn('[ImageCompression] Failed to delete temp file:', fileUri, err);
  }
}

// ── Core compression function ──────────────────────────────────────────────

/**
 * Compresses a photo to land in the 2–3 MB range using lossy JPEG compression.
 *
 * PIPELINE:
 * 1. Size gate: files ≤ 4 MB are returned immediately as-is (skipped = true).
 * 2. Quality loop: iteratively reduces JPEG quality (0.85 → 0.75 → 0.65 → …)
 *    and stops as soon as the result is anywhere in [2 MB, 3 MB] — avoiding
 *    over-compression past 2 MB when a slightly larger file is already fine.
 * 3. Dimension fallback: if quality floor (0.4) can't reach the target range,
 *    steps down the longest edge (4000 → 3200 → … → 1600 px) and retries.
 * 4. Cleanup: every intermediate temp file that isn't the winner is deleted.
 *
 * Output format is always JPEG regardless of the source format (PNG, HEIC, …).
 */
export async function compressToTargetSize(
  originalUri: string,
  _targetBytes: number = TARGET_MAX_BYTES, // ignored — target is now the [min,max] range
): Promise<CompressionResult> {
  // ── Step 1: Size-check gate ──────────────────────────────────────────────
  const initialSizeBytes = await getFileSizeBytes(originalUri);
  const initialDimensions = await getImageDimensions(originalUri);

  if (initialSizeBytes > 0 && initialSizeBytes <= SKIP_COMPRESSION_BYTES) {
    console.log(
      `[ImageCompression] ≤4 MB (${(initialSizeBytes / (1024 * 1024)).toFixed(2)} MB) — skipping compression.`,
    );
    return {
      uri: originalUri,
      sizeBytes: initialSizeBytes,
      width: initialDimensions.width,
      height: initialDimensions.height,
      quality: 1.0,
      hitFloor: false,
      iterations: 0,
      originalSizeBytes: initialSizeBytes,
      skipped: true,
    };
  }

  console.log(
    `[ImageCompression] Starting compression: ${(initialSizeBytes / (1024 * 1024)).toFixed(2)} MB ` +
      `(${initialDimensions.width}x${initialDimensions.height}). Target: 2–3 MB.`,
  );

  const intermediateTempUris: string[] = [];
  let currentQuality = INITIAL_QUALITY;
  let iterations = 0;
  // Tracks the best candidate that is still above the target ceiling (closest to 3 MB)
  let bestAboveRange: {
    uri: string;
    sizeBytes: number;
    width: number;
    height: number;
    quality: number;
  } | null = null;

  /**
   * Returns true when a given file size is within the acceptable 2–3 MB range.
   * The lower bound (2 MB) prevents stopping too early on tiny outputs.
   */
  const isInTargetRange = (bytes: number): boolean =>
    bytes >= TARGET_MIN_BYTES && bytes <= TARGET_MAX_BYTES;

  /**
   * Returns true when a size has gone BELOW the target floor (< 2 MB).
   * Reaching this means we've over-compressed; use the previous iteration.
   */
  const isBelowTargetFloor = (bytes: number): boolean => bytes < TARGET_MIN_BYTES;

  try {
    // ── Phase 1: Iterative Quality Reduction at Full Dimension ─────────────
    while (currentQuality >= QUALITY_FLOOR && iterations < MAX_QUALITY_ITERATIONS) {
      iterations++;

      const manipResult = await manipulateAsync(
        originalUri,
        [], // no resize — original dimensions
        {
          compress: currentQuality,
          format: SaveFormat.JPEG, // always output JPEG regardless of source format
        },
      );

      intermediateTempUris.push(manipResult.uri);
      const sizeBytes = getFileSizeInBytes(manipResult.uri);

      console.log(
        `[ImageCompression] Q-loop #${iterations}: quality=${currentQuality.toFixed(2)}, ` +
          `size=${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
      );

      if (isInTargetRange(sizeBytes)) {
        // ✅ Landed in 2–3 MB — this is the sweet spot, done
        await cleanupDiscardedTempFiles(intermediateTempUris, manipResult.uri);
        return {
          uri: manipResult.uri,
          sizeBytes,
          width: manipResult.width,
          height: manipResult.height,
          quality: currentQuality,
          hitFloor: false,
          iterations,
          originalSizeBytes: initialSizeBytes,
        };
      }

      if (isBelowTargetFloor(sizeBytes)) {
        // Went under 2 MB — over-compressed. Use the previous iteration if available.
        if (bestAboveRange) {
          console.log(
            `[ImageCompression] Went below 2 MB at quality=${currentQuality.toFixed(2)}. ` +
              `Using previous best: ${(bestAboveRange.sizeBytes / (1024 * 1024)).toFixed(2)} MB.`,
          );
          await cleanupDiscardedTempFiles(intermediateTempUris, bestAboveRange.uri);
          return {
            ...bestAboveRange,
            hitFloor: false,
            iterations,
            originalSizeBytes: initialSizeBytes,
          };
        }
        // No previous — this first pass already landed below 2 MB (very aggressive).
        // Return it rather than upscaling.
        await cleanupDiscardedTempFiles(intermediateTempUris, manipResult.uri);
        return {
          uri: manipResult.uri,
          sizeBytes,
          width: manipResult.width,
          height: manipResult.height,
          quality: currentQuality,
          hitFloor: false,
          iterations,
          originalSizeBytes: initialSizeBytes,
        };
      }

      // Still above 3 MB — record as latest best-above-range candidate
      bestAboveRange = {
        uri: manipResult.uri,
        sizeBytes,
        width: manipResult.width,
        height: manipResult.height,
        quality: currentQuality,
      };

      currentQuality = Math.round((currentQuality - QUALITY_STEP) * 100) / 100;
    }

    // ── Phase 2: Dimension Reduction Fallback ──────────────────────────────
    // Quality floor reached and still above 3 MB (very high megapixel files).
    console.log(
      `[ImageCompression] Quality floor (${QUALITY_FLOOR}) reached. ` +
        `Falling back to dimension scaling…`,
    );

    let originalLongestEdge = Math.max(initialDimensions.width, initialDimensions.height);
    if (originalLongestEdge === 0) originalLongestEdge = 4000;

    const applicableDimensions = DIMENSION_STEPS.filter(
      dim => dim < originalLongestEdge && dim >= MIN_LONGEST_EDGE_FLOOR,
    );
    if (!applicableDimensions.includes(MIN_LONGEST_EDGE_FLOOR)) {
      applicableDimensions.push(MIN_LONGEST_EDGE_FLOOR);
    }

    for (const targetLongestEdge of applicableDimensions) {
      const isLandscape = initialDimensions.width >= initialDimensions.height;
      const resizeAction: Action = isLandscape
        ? { resize: { width: targetLongestEdge } }
        : { resize: { height: targetLongestEdge } };

      // Re-test at a few quality levels on each reduced resolution
      for (const resQuality of [0.85, 0.75, 0.6, 0.5]) {
        iterations++;

        const manipResult = await manipulateAsync(originalUri, [resizeAction], {
          compress: resQuality,
          format: SaveFormat.JPEG, // always JPEG
        });

        intermediateTempUris.push(manipResult.uri);
        const sizeBytes = getFileSizeInBytes(manipResult.uri);

        console.log(
          `[ImageCompression] Dim-scale ${targetLongestEdge}px q=${resQuality}: ` +
            `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
        );

        if (isInTargetRange(sizeBytes)) {
          await cleanupDiscardedTempFiles(intermediateTempUris, manipResult.uri);
          return {
            uri: manipResult.uri,
            sizeBytes,
            width: manipResult.width,
            height: manipResult.height,
            quality: resQuality,
            hitFloor: false,
            iterations,
            originalSizeBytes: initialSizeBytes,
          };
        }

        if (isBelowTargetFloor(sizeBytes) && bestAboveRange) {
          // Over-compressed into <2 MB territory; use the best above-range candidate
          await cleanupDiscardedTempFiles(intermediateTempUris, bestAboveRange.uri);
          return {
            ...bestAboveRange,
            hitFloor: true,
            iterations,
            originalSizeBytes: initialSizeBytes,
          };
        }

        if (!isBelowTargetFloor(sizeBytes)) {
          bestAboveRange = {
            uri: manipResult.uri,
            sizeBytes,
            width: manipResult.width,
            height: manipResult.height,
            quality: resQuality,
          };
        }
      }
    }

    // Still couldn't reach range — return best achievable result
    const fallback = bestAboveRange;
    if (fallback) {
      console.warn(
        `[ImageCompression] Could not reach 2–3 MB range. ` +
          `Best: ${(fallback.sizeBytes / (1024 * 1024)).toFixed(2)} MB at ${fallback.width}x${fallback.height}`,
      );
      await cleanupDiscardedTempFiles(intermediateTempUris, fallback.uri);
      return {
        ...fallback,
        hitFloor: true,
        iterations,
        originalSizeBytes: initialSizeBytes,
      };
    }

    // Absolute last-resort — return original untouched
    return {
      uri: originalUri,
      sizeBytes: initialSizeBytes,
      width: initialDimensions.width,
      height: initialDimensions.height,
      quality: 1.0,
      hitFloor: true,
      iterations,
      originalSizeBytes: initialSizeBytes,
    };
  } catch (error) {
    console.error('[ImageCompression] Error during compression:', error);
    await cleanupDiscardedTempFiles(intermediateTempUris, null);
    return {
      uri: originalUri,
      sizeBytes: initialSizeBytes,
      width: initialDimensions.width,
      height: initialDimensions.height,
      quality: 1.0,
      hitFloor: false,
      iterations,
      originalSizeBytes: initialSizeBytes,
    };
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Removes all temporary files created during the search except the final retained one.
 */
async function cleanupDiscardedTempFiles(
  allTempUris: string[],
  retainedUri: string | null,
): Promise<void> {
  for (const uri of allTempUris) {
    if (uri !== retainedUri) {
      await cleanupTempFile(uri);
    }
  }
}
