import { Image } from 'react-native';
import * as Device from 'expo-device';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import FaceDetection from '@react-native-ml-kit/face-detection';
import {
  Skia,
  TileMode,
  SkData,
  SkImage,
  SkSurface,
  SkPaint,
  SkColorFilter,
  SkImageFilter,
} from '@shopify/react-native-skia';

export interface PhotoQualityResult {
  blur: boolean;
  face: boolean;
  overExposure: boolean;
  eyesOpen: boolean;

  // Diagnostic detail, not just booleans — needed for a "needs review" UI later
  sharpnessScore?: number;
  exposureScore?: number;
  faceCount?: number;
  closedEyeCount?: number;
  confidence?: number;

  /**
   * 64-bit difference perceptual hash (dHash) stored as a 16-char hexadecimal string.
   * Used for real visual similarity comparison between consecutive photos.
   */
  pHash?: string;

  /**
   * Diagnostic per-stage timing breakdown (Step 1).
   */
  _perf?: {
    t_resize: number;
    t_face: number;
    t_decode: number;
    t_small: number;
    t_blur: number;
    t_exposure: number;
    t_pHash: number;
    t_analysis_total: number;
  };
}

// ── CALIBRATION CONSTANTS ──────────────────────────────────────────────────
// Threshold for eye-open classification (0.0 = fully closed, 1.0 = fully open)
const EYE_OPEN_THRESHOLD = 0.5;

// Downscale target for analysis (longest edge in pixels)
const TARGET_LONGEST_EDGE = 1280;

/**
 * VISUAL_SIMILARITY_HAMMING_THRESHOLD: Maximum number of differing bits (out of 64)
 * between two dHash strings for them to be considered visually similar composition/pose.
 *
 * Recalibrated (Part A Step 1): Raised from 10 → 15 based on empirical device logs.
 *
 * Interpretation:
 * - 0–8:   Near-identical burst shots / micro-jitter (same pose, tiny hand/camera movement)
 * - 9–15:  Same subject / pose with natural between-shot variation (arm movement, minor expression change)
 * - 16–26: Noticeable pose change / framing adjustment / different grouping
 * - >26:   Completely different scene / subjects
 *
 * Trade-off note: A threshold of 15 reduces fragmentation by grouping natural variations
 * of the same setup into a single batch, while still separating distinct scene changes (dist > 18).
 */
export const VISUAL_SIMILARITY_HAMMING_THRESHOLD = 15;

/**
 * BLUR_THRESHOLD: Laplacian variance threshold below which an image is considered blurry.
 * NOTE: This is an initial heuristic value that requires empirical calibration (Step 8)
 * with real camera photos across different sensors, lenses, and lighting conditions rather
 * than being trusted as-is out of the box.
 */
export const BLUR_THRESHOLD = 100.0;

/**
 * HIGH_LUMINANCE_CLIPPING_VALUE: Pixel brightness threshold on a 0-255 scale representing clipped highlights.
 */
export const HIGH_LUMINANCE_CLIPPING_VALUE = 250;

/**
 * EXPOSURE_THRESHOLD: Percentage of clipped highlight pixels (0-100%) above which an image is marked overexposed.
 * NOTE: A white wedding dress, bright backdrop wall, or direct flash reflection can legitimately
 * produce many bright pixels without the entire photo being ruined. This threshold needs real-photo
 * calibration (Step 8), rather than a naive "any white pixels = bad" rule.
 */
export const EXPOSURE_THRESHOLD = 12.0;

/**
 * Step 4 — Adaptive Concurrency based on Device Hardware Tier:
 *
 * On low-end devices (<3.5GB RAM, e.g. 2GB–3GB Android devices), running 4 concurrent
 * decode + ML Kit + Skia operations causes memory thrashing and CPU core contention,
 * making EACH analysis significantly slower.
 *
 * Tier breakdown:
 * - Low-end (<3.5 GB RAM): concurrency = 2 (reduces contention, paradoxical throughput gain)
 * - Mid-tier (3.5 GB – 5.5 GB RAM): concurrency = 3
 * - High-end (>= 5.5 GB RAM): concurrency = 4
 */
let _concurrencyOverride: number | null = null;

export function getAdaptiveConcurrency(): number {
  try {
    const totalMem = Device.totalMemory;
    if (typeof totalMem === 'number' && totalMem > 0) {
      const memGB = totalMem / (1024 * 1024 * 1024);
      if (memGB < 3.5) {
        return 2;
      }
      if (memGB < 5.5) {
        return 3;
      }
      return 4;
    }
  } catch {
    // Fallback if native module query fails
  }
  return 3;
}

export function setConcurrencyOverride(limit: number | null): void {
  _concurrencyOverride = limit;
}

export function getMaxConcurrentAnalyses(): number {
  if (_concurrencyOverride !== null && _concurrencyOverride > 0) {
    return _concurrencyOverride;
  }
  return getAdaptiveConcurrency();
}

export const MAX_CONCURRENT_ANALYSES = getMaxConcurrentAnalyses();

// Standard ITU-R BT.709 luminance coefficients matrix for converting RGB to Grayscale
const GRAYSCALE_COLOR_MATRIX = [
  0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0, 0, 0,
  1, 0,
];

// 3x3 Discrete Laplacian Kernel for 2nd-order spatial edge detection
const LAPLACIAN_KERNEL_3X3 = [0, 1, 0, 1, -4, 1, 0, 1, 0];

/**
 * Width (in pixels) of the small intermediate surface used for blur + exposure analysis.
 *
 * PART B OPT (Step 8): All three analysis passes (blur Laplacian, exposure histogram,
 * dHash) now share a SINGLE decode of the 1280px image into this 256×H surface.
 * This reduces total GPU→CPU data transfer from ~9.8 MB to ~400 KB per photo (24×).
 *
 * 256px is well above the minimum for accurate blur/exposure statistics:
 * - OpenCV's blur detection standard target is 400×300
 * - The dHash algorithm internally uses 9×8 anyway
 * - Exposure histograms are statistically valid at any size > 64px
 *
 * CALIBRATION NOTE: The Laplacian variance at 256px will produce lower absolute
 * values than at 1280px (downsampling is itself a mild low-pass filter). The
 * BLUR_THRESHOLD constant may need recalibration once [Perf] logs from the
 * optimized build confirm the new variance range on real photos.
 */
const ANALYSIS_SMALL_W = 256;

/**
 * Gets the dimensions of an image URI safely.
 */
function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: TARGET_LONGEST_EDGE, height: TARGET_LONGEST_EDGE }),
    );
  });
}

/**
 * Resizes the image to ~1280px on its longest edge to optimize analysis speed and memory.
 */
async function resizeForAnalysis(photoUri: string): Promise<string> {
  const { width, height } = await getImageSize(photoUri);
  const isLandscape = width >= height;

  const resizeAction = isLandscape
    ? { width: Math.min(width, TARGET_LONGEST_EDGE) }
    : { height: Math.min(height, TARGET_LONGEST_EDGE) };

  const manipResult = await manipulateAsync(photoUri, [{ resize: resizeAction }], {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });

  return manipResult.uri;
}

/**
 * Safely deletes a temporary file from cache storage.
 */
async function cleanupTempFile(fileUri: string): Promise<void> {
  try {
    const file = new File(fileUri);
    if (file.exists) {
      file.delete();
    }
  } catch (err) {
    console.warn('[PhotoQualityService] Failed to clean up temp file:', fileUri, err);
  }
}

/**
 * Performs face and eye-open detection using ML Kit.
 */
async function detectFacesAndEyes(imageUri: string): Promise<{
  hasFace: boolean;
  faceCount: number;
  closedEyeCount: number;
  eyesOpen: boolean;
  _t_face: number;
}> {
  const t_start = performance.now();
  try {
    const faces = await FaceDetection.detect(imageUri, {
      performanceMode: 'fast',
      classificationMode: 'all',
      landmarkMode: 'none',
      contourMode: 'none',
    });

    const faceCount = faces.length;
    const hasFace = faceCount > 0;

    let closedEyeCount = 0;

    for (const face of faces) {
      const leftEye = face.leftEyeOpenProbability;
      const rightEye = face.rightEyeOpenProbability;

      // If either eye probability is provided and below threshold, count as closed
      const isLeftClosed = typeof leftEye === 'number' && leftEye < EYE_OPEN_THRESHOLD;
      const isRightClosed = typeof rightEye === 'number' && rightEye < EYE_OPEN_THRESHOLD;

      if (isLeftClosed || isRightClosed) {
        closedEyeCount++;
      }
    }

    // Top-level eyesOpen boolean: true if no closed eyes detected among any detected faces
    const eyesOpen = closedEyeCount === 0;
    const _t_face = performance.now() - t_start;

    return {
      hasFace,
      faceCount,
      closedEyeCount,
      eyesOpen,
      _t_face,
    };
  } catch (error) {
    const _t_face = performance.now() - t_start;
    console.warn('[PhotoQualityService] ML Kit face detection failed or not linked:', error);
    return {
      hasFace: false,
      faceCount: 0,
      closedEyeCount: 0,
      eyesOpen: true,
      _t_face,
    };
  }
}

/**
 * Computes a 64-bit difference perceptual hash (dHash) from a Skia image.
 *
 * Algorithm:
 * 1. Downscales image to a fixed 9x8 grid on a Skia Surface.
 * 2. Reads the 9x8 pixels (72 pixels in total).
 * 3. Converts to grayscale luminance: 0.299*R + 0.587*G + 0.114*B.
 * 4. For each of the 8 rows, compares pixel(x, y) > pixel(x+1, y) to produce 8 bits per row (64 bits total).
 * 5. Returns a 16-character hexadecimal string representation (e.g. "a3f501c890e4bb21").
 */
export function computeDHashFromSkImage(skImage: SkImage): string | null {
  let smallSurface: SkSurface | null = null;
  let smallSnapshot: SkImage | null = null;

  try {
    smallSurface = Skia.Surface.Make(9, 8);
    if (!smallSurface) return null;

    const canvas = smallSurface.getCanvas();
    const srcRect = { x: 0, y: 0, width: skImage.width(), height: skImage.height() };
    const dstRect = { x: 0, y: 0, width: 9, height: 8 };

    canvas.drawImageRect(skImage, srcRect, dstRect, Skia.Paint());
    smallSurface.flush();

    smallSnapshot = smallSurface.makeImageSnapshot();
    const pixels = smallSnapshot.readPixels();
    if (!pixels || pixels.length < 9 * 8 * 4) return null;

    // Convert pixels to 9x8 luminance matrix
    const lum: number[][] = [];
    for (let y = 0; y < 8; y++) {
      lum[y] = [];
      for (let x = 0; x < 9; x++) {
        const idx = (y * 9 + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        lum[y][x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }

    // Build 64-bit hash (16 hex chars)
    let hexHash = '';
    for (let y = 0; y < 8; y++) {
      let rowByte = 0;
      for (let x = 0; x < 8; x++) {
        const bit = lum[y][x] > lum[y][x + 1] ? 1 : 0;
        rowByte = (rowByte << 1) | bit;
      }
      hexHash += rowByte.toString(16).padStart(2, '0');
    }

    return hexHash;
  } catch (err) {
    console.warn('[PhotoQualityService] Failed to compute dHash:', err);
    return null;
  } finally {
    try {
      smallSnapshot?.dispose?.();
      smallSurface?.dispose?.();
    } catch {}
  }
}

/**
 * Computes the Hamming distance (number of differing bits) between two 64-bit hex hash strings.
 * Returns a value between 0 (identical) and 64 (completely inverted).
 */
export function computeHammingDistance(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== 16 || hashB.length !== 16) {
    return 64; // Maximum distance if malformed/missing
  }

  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const valA = parseInt(hashA[i], 16);
    const valB = parseInt(hashB[i], 16);
    if (isNaN(valA) || isNaN(valB)) return 64;
    let xor = valA ^ valB;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }

  return distance;
}

/**
 * Computes sharpness (Laplacian variance), exposure score, and dHash using Skia.
 *
 * PART B OPTIMIZATION (Step 8 — shared small buffer):
 * Previously: two separate readPixels() calls at 1280×960 = ~9.8 MB GPU→CPU per photo.
 * Now: one 256×H intermediate surface shared by blur, exposure, and hash = ~400 KB.
 *
 * Pass ordering:
 *   1. Decode 1280px JPEG → skImage (SkImage, stays on GPU)
 *   2. Draw skImage → rawSmallSurface (256×H, plain downsample, no filter)
 *   3. rawSmallSnapshot.readPixels() → CPU buffer → exposure histogram
 *   4. Draw rawSmallSnapshot → lapSurface with grayscale+Laplacian paint
 *   5. lapSnapshot.readPixels() → CPU buffer → Laplacian variance (blur score)
 *   6. computeDHashFromSkImage(rawSmallSnapshot) → 9×8 hash (from small, not full-res)
 *
 * GPU→CPU transfers: 2 × (256×192×4) ≈ 400 KB  (was 2 × 4.9 MB = 9.8 MB)
 * Explicitly disposes all native Skia C++/GPU resources after analysis.
 */
async function analyzeBlurAndExposureWithSkia(imageUri: string): Promise<{
  sharpnessScore: number;
  isBlur: boolean;
  exposureScore: number;
  isOverExposed: boolean;
  pHash?: string;
  _t_decode: number;
  _t_small: number; // time to build the shared 256×H intermediate surface
  _t_blur: number;
  _t_exposure: number;
  _t_pHash: number;
}> {
  let data: SkData | null = null;
  let skImage: SkImage | null = null;
  let rawSmallSurface: SkSurface | null = null;
  let rawSmallSnapshot: SkImage | null = null;
  let lapSurface: SkSurface | null = null;
  let lapSnapshot: SkImage | null = null;
  let grayscaleFilter: SkColorFilter | null = null;
  let laplacianFilter: SkImageFilter | null = null;
  let filterPaint: SkPaint | null = null;

  const t0 = performance.now();

  try {
    // ── Decode the 1280px JPEG into a Skia image (GPU-resident) ───────────────
    data = await Skia.Data.fromURI(imageUri);
    skImage = Skia.Image.MakeImageFromEncoded(data);
    const t_decode = performance.now() - t0;

    if (!skImage) {
      console.warn('[PhotoQualityService] Could not decode image in Skia:', imageUri);
      return {
        sharpnessScore: BLUR_THRESHOLD,
        isBlur: false,
        exposureScore: 0,
        isOverExposed: false,
        _t_decode: t_decode,
        _t_small: 0,
        _t_blur: 0,
        _t_exposure: 0,
        _t_pHash: 0,
      };
    }

    const srcW = skImage.width();
    const srcH = skImage.height();

    // ── Build the shared small surface (Step 8: one downsample, reused by all passes) ─
    const t_small_start = performance.now();
    const bw = Math.min(srcW, ANALYSIS_SMALL_W);
    const bh = Math.max(1, Math.round((bw / srcW) * srcH));

    rawSmallSurface = Skia.Surface.Make(bw, bh);
    if (rawSmallSurface) {
      const canvas = rawSmallSurface.getCanvas();
      const srcRect = { x: 0, y: 0, width: srcW, height: srcH };
      const dstRect = { x: 0, y: 0, width: bw, height: bh };
      canvas.drawImageRect(skImage, srcRect, dstRect, Skia.Paint());
      rawSmallSurface.flush();
      rawSmallSnapshot = rawSmallSurface.makeImageSnapshot();
    }
    const t_small = performance.now() - t_small_start;

    // ── 1. EXPOSURE ANALYSIS — from raw small pixels (no convolution needed) ─
    //    GPU→CPU: bw×bh×4 ≈ 200 KB  (was skImage.readPixels() = 4.9 MB)
    const t_exposure_start = performance.now();
    let exposureScore = 0;
    let isOverExposed = false;

    if (rawSmallSnapshot) {
      const rawPixels = rawSmallSnapshot.readPixels();
      if (rawPixels) {
        let clippedPixelCount = 0;
        const totalPixels = rawPixels.length / 4;
        for (let i = 0; i < rawPixels.length; i += 4) {
          const luminance =
            0.2126 * rawPixels[i] + 0.7152 * rawPixels[i + 1] + 0.0722 * rawPixels[i + 2];
          if (luminance >= HIGH_LUMINANCE_CLIPPING_VALUE) clippedPixelCount++;
        }
        exposureScore =
          totalPixels > 0 ? Math.round((clippedPixelCount / totalPixels) * 10000) / 100 : 0;
        isOverExposed = exposureScore > EXPOSURE_THRESHOLD;
      }
    }
    const t_exposure = performance.now() - t_exposure_start;

    // ── 2. BLUR ANALYSIS — Laplacian on the small snapshot ───────────────────
    //    GPU→CPU: bw×bh×4 ≈ 200 KB  (was Surface.Make(1280,960) = 4.9 MB)
    const t_blur_start = performance.now();
    let sharpnessScore = BLUR_THRESHOLD;
    let isBlur = false;

    if (rawSmallSnapshot) {
      lapSurface = Skia.Surface.Make(bw, bh);
      if (lapSurface) {
        const lapCanvas = lapSurface.getCanvas();
        grayscaleFilter = Skia.ColorFilter.MakeMatrix(GRAYSCALE_COLOR_MATRIX);
        laplacianFilter = Skia.ImageFilter.MakeMatrixConvolution(
          3,
          3,
          LAPLACIAN_KERNEL_3X3,
          1.0,
          0.0,
          1,
          1,
          TileMode.Clamp,
          false,
        );
        filterPaint = Skia.Paint();
        filterPaint.setColorFilter(grayscaleFilter);
        filterPaint.setImageFilter(laplacianFilter);

        lapCanvas.drawImage(rawSmallSnapshot, 0, 0, filterPaint);
        lapSurface.flush();

        lapSnapshot = lapSurface.makeImageSnapshot();
        const convolvedPixels = lapSnapshot.readPixels();

        if (convolvedPixels) {
          let sum = 0;
          let sumSq = 0;
          const totalPixels = convolvedPixels.length / 4;
          for (let i = 0; i < convolvedPixels.length; i += 4) {
            const val = convolvedPixels[i]; // R channel = grayscale response
            sum += val;
            sumSq += val * val;
          }
          const mean = sum / totalPixels;
          const variance = sumSq / totalPixels - mean * mean;
          sharpnessScore = Math.max(0, Math.round(variance * 100) / 100);
          isBlur = sharpnessScore < BLUR_THRESHOLD;
        }
      }
    }
    const t_blur = performance.now() - t_blur_start;

    // ── 3. PERCEPTUAL HASH — from small snapshot (Step 11) ───────────────────
    //    drawImageRect inside computeDHashFromSkImage now scales 256×H → 9×8
    //    instead of 1280×960 → 9×8 (smaller source, same output)
    const t_pHash_start = performance.now();
    const pHash = rawSmallSnapshot
      ? computeDHashFromSkImage(rawSmallSnapshot) || undefined
      : undefined;
    const t_pHash = performance.now() - t_pHash_start;

    return {
      sharpnessScore,
      isBlur,
      exposureScore,
      isOverExposed,
      pHash,
      _t_decode: t_decode,
      _t_small: t_small,
      _t_blur: t_blur,
      _t_exposure: t_exposure,
      _t_pHash: t_pHash,
    };
  } catch (error) {
    console.warn('[PhotoQualityService] Skia analysis error:', error);
    return {
      sharpnessScore: BLUR_THRESHOLD,
      isBlur: false,
      exposureScore: 0,
      isOverExposed: false,
      _t_decode: 0,
      _t_small: 0,
      _t_blur: 0,
      _t_exposure: 0,
      _t_pHash: 0,
    };
  } finally {
    // Dispose all native Skia objects immediately — order: snapshot before surface
    try {
      lapSnapshot?.dispose?.();
      lapSurface?.dispose?.();
      rawSmallSnapshot?.dispose?.();
      rawSmallSurface?.dispose?.();
      filterPaint?.dispose?.();
      grayscaleFilter?.dispose?.();
      laplacianFilter?.dispose?.();
      skImage?.dispose?.();
      data?.dispose?.();
    } catch (disposeError) {
      console.warn('[PhotoQualityService] Error disposing Skia resources:', disposeError);
    }
  }
}

// ── Per-session timing accumulator (Step 1 profiling) ──────────────────────────
const _perfAccum = {
  photoCount: 0,
  t_resize: 0,
  t_decode: 0,
  t_small: 0,
  t_blur: 0,
  t_exposure: 0,
  t_pHash: 0,
  t_total: 0,
  worstTotal: 0,
  worstName: '',
};

/**
 * Internal single-photo execution pipeline.
 */
async function runSinglePhotoAnalysis(
  photoUri: string,
  _photoName?: string,
  onHashReady?: (pHash: string) => void,
): Promise<PhotoQualityResult> {
  const name = _photoName || photoUri.split('/').pop() || photoUri;
  let tempResizedUri: string | null = null;
  const T_total_start = performance.now();

  try {
    // Step 1: Resize to ~1280px longest edge
    const t_resize_start = performance.now();
    tempResizedUri = await resizeForAnalysis(photoUri);
    const t_resize = performance.now() - t_resize_start;

    // Step 2: Run Skia analysis and Face Detection (ML Kit) in PARALLEL.
    // Decoupled batching: Skia computes pHash in ~1-15ms, notifying onHashReady immediately
    // so batching can form the visual batch without waiting for ML Kit face detection (~100-140ms).
    const t_face_start = performance.now();

    const skiaPromise = analyzeBlurAndExposureWithSkia(tempResizedUri).then(skiaRes => {
      if (skiaRes.pHash && onHashReady) {
        try {
          onHashReady(skiaRes.pHash);
        } catch (cbErr) {
          console.warn('[PhotoQualityService] Error in onHashReady callback:', cbErr);
        }
      }
      return skiaRes;
    });

    const facePromise = detectFacesAndEyes(tempResizedUri);

    const [skiaAnalysis, faceAnalysis] = await Promise.all([skiaPromise, facePromise]);

    // Note: face and skia run in parallel, so we measure them from shared start
    const t_face = performance.now() - t_face_start; // wall time (dominated by the longer of the two)
    const t_total = performance.now() - T_total_start;

    // ── Per-stage log ──────────────────────────────────────────────────────
    console.log(
      `[Perf] ${name}:\n` +
        `  resize (manipulateAsync):         ${t_resize.toFixed(0)}ms\n` +
        `  skia.decode (Skia.Data.fromURI):  ${skiaAnalysis._t_decode.toFixed(0)}ms\n` +
        `  small surface 256×H (shared):     ${skiaAnalysis._t_small.toFixed(0)}ms\n` +
        `  exposureAnalysis (readPixels):    ${skiaAnalysis._t_exposure.toFixed(0)}ms  [was ~200-400ms at 1280×960]\n` +
        `  blurAnalysis (Laplacian 256×H):   ${skiaAnalysis._t_blur.toFixed(0)}ms  [was ~200-600ms at 1280×960]\n` +
        `  perceptualHash (9×8 from small):  ${skiaAnalysis._t_pHash.toFixed(0)}ms\n` +
        `  faceDetection (ML Kit, parallel): (parallel with Skia)\n` +
        `  [ML Kit + Skia wall time]:        ${t_face.toFixed(0)}ms\n` +
        `  TOTAL:                            ${t_total.toFixed(0)}ms`,
    );

    // ── Accumulate session stats ───────────────────────────────────────────
    _perfAccum.photoCount++;
    _perfAccum.t_resize += t_resize;
    _perfAccum.t_decode += skiaAnalysis._t_decode;
    _perfAccum.t_small += skiaAnalysis._t_small;
    _perfAccum.t_blur += skiaAnalysis._t_blur;
    _perfAccum.t_exposure += skiaAnalysis._t_exposure;
    _perfAccum.t_pHash += skiaAnalysis._t_pHash;
    _perfAccum.t_total += t_total;
    if (t_total > _perfAccum.worstTotal) {
      _perfAccum.worstTotal = t_total;
      _perfAccum.worstName = name;
    }

    // Print running average every 10 photos
    if (_perfAccum.photoCount % 10 === 0) {
      const n = _perfAccum.photoCount;
      console.log(
        `[Perf] ── Running average after ${n} photos (OPTIMIZED build) ──\n` +
          `  avg resize:         ${(_perfAccum.t_resize / n).toFixed(0)}ms\n` +
          `  avg skia.decode:    ${(_perfAccum.t_decode / n).toFixed(0)}ms\n` +
          `  avg small surface:  ${(_perfAccum.t_small / n).toFixed(0)}ms  (256×H shared downsample)\n` +
          `  avg exposure:       ${(_perfAccum.t_exposure / n).toFixed(0)}ms  (readPixels 256×H, ~200KB)\n` +
          `  avg blur:           ${(_perfAccum.t_blur / n).toFixed(0)}ms  (Laplacian 256×H)\n` +
          `  avg pHash:          ${(_perfAccum.t_pHash / n).toFixed(0)}ms\n` +
          `  avg TOTAL:          ${(_perfAccum.t_total / n).toFixed(0)}ms\n` +
          `  worst photo:        ${_perfAccum.worstName} (${_perfAccum.worstTotal.toFixed(0)}ms)\n` +
          `  active workers:     ${activeWorkers}/${getMaxConcurrentAnalyses()}  (adaptive limit)`,
      );
    }

    return {
      blur: skiaAnalysis.isBlur,
      face: faceAnalysis.hasFace,
      overExposure: skiaAnalysis.isOverExposed,
      eyesOpen: faceAnalysis.eyesOpen,
      faceCount: faceAnalysis.faceCount,
      closedEyeCount: faceAnalysis.closedEyeCount,
      sharpnessScore: skiaAnalysis.sharpnessScore,
      exposureScore: skiaAnalysis.exposureScore,
      pHash: skiaAnalysis.pHash,
      confidence: 1.0,
      _perf: {
        t_resize,
        t_face: faceAnalysis._t_face,
        t_decode: skiaAnalysis._t_decode,
        t_small: skiaAnalysis._t_small,
        t_blur: skiaAnalysis._t_blur,
        t_exposure: skiaAnalysis._t_exposure,
        t_pHash: skiaAnalysis._t_pHash,
        t_analysis_total: t_total,
      },
    };
  } catch (error) {
    console.error('[PhotoQualityService] Analysis failed for photo:', photoUri, error);
    return {
      blur: false,
      face: false,
      overExposure: false,
      eyesOpen: true,
      faceCount: 0,
      closedEyeCount: 0,
    };
  } finally {
    if (tempResizedUri && tempResizedUri !== photoUri) {
      await cleanupTempFile(tempResizedUri);
    }
  }
}

// ── CONCURRENCY LIMITER QUEUE (Step 9) ─────────────────────────────────────
type QueueTask = {
  photoUri: string;
  photoName?: string;
  onHashReady?: (pHash: string) => void;
  resolve: (result: PhotoQualityResult) => void;
  reject: (error: any) => void;
};

const analysisQueue: QueueTask[] = [];
let activeWorkers = 0;

function processQueue(): void {
  const maxConcurrency = getMaxConcurrentAnalyses();
  if (activeWorkers >= maxConcurrency || analysisQueue.length === 0) {
    return;
  }

  const nextTask = analysisQueue.shift();
  if (!nextTask) return;

  activeWorkers++;

  runSinglePhotoAnalysis(nextTask.photoUri, nextTask.photoName, nextTask.onHashReady)
    .then(nextTask.resolve)
    .catch(nextTask.reject)
    .finally(() => {
      activeWorkers--;
      processQueue();
    });
}

/**
 * Analyzes local photo quality with concurrency bounded dynamically to device tier limit.
 * Safe for burst loads of 20+ photos without spiking RAM, GPU, or CPU.
 * Accepts optional onHashReady callback that fires as soon as Skia computes pHash (~15ms),
 * decoupling visual batching from the slower ML Kit face detection pass (~140ms).
 */
export function analyzePhoto(
  photoUri: string,
  photoName?: string,
  onHashReady?: (pHash: string) => void,
): Promise<PhotoQualityResult> {
  return new Promise((resolve, reject) => {
    analysisQueue.push({ photoUri, photoName, onHashReady, resolve, reject });
    processQueue();
  });
}

/**
 * Returns the current session-level timing summary.
 * Call from dev tooling or an in-app debug panel to inspect cumulative perf data.
 */
export function getPerfSummary(): typeof _perfAccum {
  return { ..._perfAccum };
}
