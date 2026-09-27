import { Asset, Album } from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import {
  compressToTargetSize,
  cleanupTempFile,
  getFileSizeBytes,
  SKIP_COMPRESSION_BYTES,
  TARGET_MAX_BYTES,
} from './imageCompressionService';
import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import { PHOTO_ALBUM_NAME } from '@/config/photo.config';

// ── Types ──────────────────────────────────────────────────────────────────

export type SupportedImageFormat = 'jpeg' | 'png' | 'heic' | 'webp' | 'raw' | 'unknown';

export interface PhotoComplianceResult {
  isCompliant: boolean;
  isJpeg: boolean;
  sizeBytes: number;
  format: SupportedImageFormat;
  mimeType: string;
}

export interface PhotoReplacementResult {
  success: boolean;
  status: 'skipped' | 'replaced' | 'declined' | 'failed';
  originalPhotoId: string;
  newPhotoId?: string;
  newUri?: string;
  newFilename?: string;
  compressedSizeBytes?: number;
  originalSizeBytes?: number;
  quality?: number;
  error?: string;
}

// ── Step 1: Real Magic Bytes / Format & Compliance Detection ────────────────

/**
 * Reads the first 32 bytes of a file to check the real file signature (magic bytes).
 * Avoids relying solely on file extensions which can be misleading or missing.
 */
export async function detectPhotoFormatAndCompliance(
  fileUri: string,
): Promise<PhotoComplianceResult> {
  let sizeBytes = await getFileSizeBytes(fileUri);
  let format: SupportedImageFormat = 'unknown';
  let mimeType = 'application/octet-stream';

  try {
    // Read the first 32 bytes as Base64 to inspect magic bytes header
    let base64Header = '';
    try {
      base64Header = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: 32,
      });
    } catch {
      // Fallback: If position/length is not supported on certain content URIs, read a small slice via File API
      try {
        const file = new File(fileUri);
        if (file.exists) {
          const bytes = await file.bytes();
          const sub = bytes.subarray(0, 32);
          base64Header = btoa(String.fromCharCode.apply(null, Array.from(sub)));
          if (sizeBytes <= 0 && 'size' in file) {
            sizeBytes = (file as any).size ?? 0;
          }
        }
      } catch {}
    }

    if (base64Header) {
      const binaryString = atob(base64Header);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 1. Check JPEG: 0xFF, 0xD8, 0xFF
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        format = 'jpeg';
        mimeType = 'image/jpeg';
      }
      // 2. Check PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
      else if (
        bytes.length >= 4 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      ) {
        format = 'png';
        mimeType = 'image/png';
      }
      // 3. Check WEBP: "RIFF" (bytes 0-3) and "WEBP" (bytes 8-11)
      else if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      ) {
        format = 'webp';
        mimeType = 'image/webp';
      }
      // 4. Check HEIC/HEIF / CR3: offset 4 contains "ftyp" (0x66 0x74 0x79 0x70)
      else if (
        bytes.length >= 12 &&
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70
      ) {
        const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
        if (brand.includes('crx')) {
          format = 'raw';
          mimeType = 'image/x-canon-cr3';
        } else {
          format = 'heic';
          mimeType = 'image/heic';
        }
      }
      // 5. Check TIFF / Camera RAW (DNG, ARW, NEF, CR2): "II*\0" (0x49 0x49 0x2A 0x00) or "MM\0*" (0x4D 0x4D 0x00 0x2A)
      else if (
        bytes.length >= 4 &&
        ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
          (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
      ) {
        format = 'raw';
        mimeType = 'image/x-camera-raw';
      }
    }
  } catch (err) {
    console.warn(
      '[MediaReplacement] Magic bytes detection fallback to extension for:',
      fileUri,
      err,
    );
  }

  // Fallback to extension check if magic bytes were inconclusive
  if (format === 'unknown') {
    const lower = fileUri.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      format = 'jpeg';
      mimeType = 'image/jpeg';
    } else if (lower.endsWith('.png')) {
      format = 'png';
      mimeType = 'image/png';
    } else if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
      format = 'heic';
      mimeType = 'image/heic';
    } else if (lower.endsWith('.webp')) {
      format = 'webp';
      mimeType = 'image/webp';
    } else if (
      lower.endsWith('.arw') ||
      lower.endsWith('.cr2') ||
      lower.endsWith('.cr3') ||
      lower.endsWith('.nef') ||
      lower.endsWith('.dng')
    ) {
      format = 'raw';
      mimeType = 'image/x-camera-raw';
    }
  }

  const isJpeg = format === 'jpeg';
  // Step 1 criteria: If already JPEG and under 4MB (SKIP_COMPRESSION_BYTES), it is compliant
  const isCompliant = isJpeg && sizeBytes > 0 && sizeBytes <= SKIP_COMPRESSION_BYTES;

  return {
    isCompliant,
    isJpeg,
    sizeBytes,
    format,
    mimeType,
  };
}

// ── Step 2: Compress to Temporary File Named Like Original ──────────────────

/**
 * Creates a sanitized JPEG filename from the original filename.
 * e.g. "DSC_0042.HEIC" -> "DSC_0042.jpg", "wedding_1.png" -> "wedding_1.jpg"
 */
export function sanitizeJpegFilename(originalName: string): string {
  const cleanName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseName = cleanName.replace(/\.[^/.]+$/, '');
  return `${baseName || 'photo'}.jpg`;
}

/**
 * Compresses an image to the 2–3MB range and saves it to a designated cache file
 * named exactly like the original photo (with a .jpg extension).
 */
export async function compressToNamedTempFile(
  sourceUri: string,
  originalFilename: string,
): Promise<{
  namedTempUri: string;
  sizeBytes: number;
  width: number;
  height: number;
  quality: number;
  originalSizeBytes: number;
  hitFloor?: boolean;
}> {
  // Run iterative compression (quality loop 0.85 -> 0.40, dimension reduction fallback)
  const compResult = await compressToTargetSize(sourceUri, TARGET_MAX_BYTES);

  // Target filename based on original
  const targetFilename = sanitizeJpegFilename(originalFilename);
  const cacheDir = `${FileSystem.cacheDirectory}gallery_replacements/`;
  await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });

  const namedTempUri = `${cacheDir}${Date.now()}_${targetFilename}`;

  // Move or copy the compressed output to the named cache path
  await FileSystem.copyAsync({
    from: compResult.uri,
    to: namedTempUri,
  });

  // Clean up the initial anonymous intermediate temp file
  if (compResult.uri !== namedTempUri && compResult.uri !== sourceUri) {
    await cleanupTempFile(compResult.uri);
  }

  // Verify the named temp file
  const info = await FileSystem.getInfoAsync(namedTempUri);
  const sizeBytes =
    info.exists && 'size' in info
      ? ((info as any).size ?? compResult.sizeBytes)
      : compResult.sizeBytes;

  if (sizeBytes === 0) {
    throw new Error(`[MediaReplacement] Compressed file is 0 bytes: ${namedTempUri}`);
  }

  return {
    namedTempUri,
    sizeBytes,
    width: compResult.width,
    height: compResult.height,
    quality: compResult.quality,
    originalSizeBytes: compResult.originalSizeBytes ?? sizeBytes,
    hitFloor: compResult.hitFloor,
  };
}

// ── Step 3: Record Original Asset Album Placement ───────────────────────────

/**
 * Looks up which album(s) the original asset belongs to so the replacement asset
 * can be inserted directly back into the same album.
 */
export async function getOriginalAssetAlbum(
  assetOrUriOrId: Asset | string,
  defaultAlbumName: string = PHOTO_ALBUM_NAME,
): Promise<Album | null> {
  try {
    // If we have an Asset instance or asset ID
    if (typeof assetOrUriOrId === 'object' && assetOrUriOrId instanceof Asset) {
      const albums = await assetOrUriOrId.getAlbums();
      if (albums && albums.length > 0) {
        return albums[0];
      }
    }

    // Try finding album by matching existing default or custom album names
    const allAlbums = await Album.getAll();
    if (allAlbums && allAlbums.length > 0) {
      // Look for configured album name or album name matching URI path
      const uriStr = typeof assetOrUriOrId === 'string' ? assetOrUriOrId : '';
      if (uriStr.includes(defaultAlbumName)) {
        const matchingAlbum = allAlbums.find(
          a => (a as any).title === defaultAlbumName || (a as any).name === defaultAlbumName,
        );
        if (matchingAlbum) return matchingAlbum;
      }

      const defaultAlbum = allAlbums.find(
        a => (a as any).title === defaultAlbumName || (a as any).name === defaultAlbumName,
      );
      if (defaultAlbum) return defaultAlbum;
    }

    // Attempt to query or get specific album
    const existing = await Album.get(defaultAlbumName);
    if (existing) return existing;
  } catch (err) {
    console.warn('[MediaReplacement] Failed to query albums, will use default fallback:', err);
  }

  return null;
}

// ── Helpers: Genuine MediaLibrary Asset Resolution & Validation ─────────────

/**
 * Checks if a string looks like a genuine MediaLibrary ID
 * (e.g. Android "content://media/external/images/media/1000000198", numeric ID, or iOS PHAsset localIdentifier).
 * Returns false for synthetic IDs ("dcim-...") and plain filesystem URIs ("file://...").
 */
export function isGenuineMediaLibraryId(id?: string | null): boolean {
  if (!id || typeof id !== 'string' || id.trim().length === 0) return false;
  if (id.startsWith('dcim-') || id.startsWith('file://')) return false;
  return true;
}

/**
 * Validates that an object is a genuine MediaLibrary Asset instance with a valid native ID.
 */
export function isGenuineMediaLibraryAsset(asset: any): asset is Asset {
  if (!asset || typeof asset !== 'object') return false;
  if (!isGenuineMediaLibraryId(asset.id)) return false;
  return typeof asset.delete === 'function' && typeof asset.getUri === 'function';
}

/**
 * Resolves a genuine expo-media-library Asset instance for a photo.
 * Ensures the asset has a real MediaStore / PHAsset ID rather than a synthetic
 * app-level ID (like "dcim-...") or a raw file:// URI.
 */
export async function resolveGenuineMediaAsset(photo: GalleryPhotoItem): Promise<Asset | null> {
  const filename = photo.filename || (photo.uri ? photo.uri.split('/').pop() : '');

  // 1. Check if photo.assetId is already a genuine MediaLibrary ID
  if (isGenuineMediaLibraryId(photo.assetId)) {
    try {
      const candidate = new Asset(photo.assetId!);
      const info = await candidate.getInfo();
      if (info && isGenuineMediaLibraryId(info.id)) {
        return candidate;
      }
    } catch {}
  }

  // 2. Check if photo.id is already a genuine MediaLibrary ID
  if (isGenuineMediaLibraryId(photo.id)) {
    try {
      const candidate = new Asset(photo.id);
      const info = await candidate.getInfo();
      if (info && isGenuineMediaLibraryId(info.id)) {
        return candidate;
      }
    } catch {}
  }

  // 3. Look up within the configured album
  try {
    const defaultAlbum = await Album.get(PHOTO_ALBUM_NAME);
    if (defaultAlbum) {
      const assets = await defaultAlbum.getAssets();
      for (const asset of assets) {
        if (!isGenuineMediaLibraryId(asset.id)) continue;
        const aName = await asset.getFilename();
        const aUri = await asset.getUri();
        if ((filename && aName === filename) || (photo.uri && aUri === photo.uri)) {
          return asset;
        }
      }
    }
  } catch (err) {
    console.warn(
      `[MediaReplacement] Error searching ${PHOTO_ALBUM_NAME} album for original asset:`,
      err,
    );
  }

  // 4. Look up across all device albums
  try {
    const allAlbums = await Album.getAll();
    for (const album of allAlbums) {
      const assets = await album.getAssets();
      for (const asset of assets) {
        if (!isGenuineMediaLibraryId(asset.id)) continue;
        const aName = await asset.getFilename();
        const aUri = await asset.getUri();
        if ((filename && aName === filename) || (photo.uri && aUri === photo.uri)) {
          return asset;
        }
      }
    }
  } catch (err) {
    console.warn('[MediaReplacement] Error searching all albums for original asset:', err);
  }

  return null;
}

// ── Steps 4, 5, 6: Pure Expo JS Create-Then-Delete Gallery Replacement ─────────

/**
 * Replaces a gallery photo using pure Expo JS APIs (create-new, verify, then delete-old):
 *
 * 1. Step 1: Check format & size. If compliant JPEG <= 4MB, skips replacement.
 * 2. Step 2: Compresses to named temporary JPEG file (2–3MB target).
 * 3. Step 3: Records original album placement.
 * 4. Step 4: Creates the new asset (`Asset.create`), assigns to original album, verifies creation.
 * 5. Step 5: Deletes original asset (`Asset.delete`). Handles user confirmation dialog gracefully.
 * 6. Step 6: Cleans up temporary cache file and returns updated asset info.
 */
export async function replaceGalleryPhotoPureJS(
  photo: GalleryPhotoItem,
  options: {
    albumName?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PhotoReplacementResult> {
  const { albumName = PHOTO_ALBUM_NAME, signal } = options;
  const originalFilename = photo.filename || 'photo.jpg';

  if (signal?.aborted) {
    return {
      success: false,
      status: 'failed',
      originalPhotoId: photo.id,
      error: 'Operation aborted',
    };
  }

  // ── Step 1: Check compliance on arrival ────────────────────────────────────
  const compliance = await detectPhotoFormatAndCompliance(photo.uri);
  if (compliance.isCompliant) {
    console.log(
      `[MediaReplacement] ${originalFilename} is already compliant JPEG (${(compliance.sizeBytes / (1024 * 1024)).toFixed(2)} MB). Skipping.`,
    );
    return {
      success: true,
      status: 'skipped',
      originalPhotoId: photo.id,
      newPhotoId: photo.id,
      newUri: photo.uri,
      newFilename: photo.filename,
      compressedSizeBytes: compliance.sizeBytes,
      originalSizeBytes: compliance.sizeBytes,
      quality: 1.0,
    };
  }

  let namedTempUri: string | null = null;
  let createdAsset: Asset | null = null;

  try {
    // ── Step 2: Compress to named temporary JPEG file ────────────────────────
    const compResult = await compressToNamedTempFile(photo.uri, originalFilename);
    namedTempUri = compResult.namedTempUri;

    if (signal?.aborted) {
      if (namedTempUri) await cleanupTempFile(namedTempUri);
      return {
        success: false,
        status: 'failed',
        originalPhotoId: photo.id,
        error: 'Operation aborted',
      };
    }

    // ── Step 3: Record album placement ───────────────────────────────────────
    let targetAlbum = await getOriginalAssetAlbum(photo.uri, albumName);

    // ── Step 4: Create the new compressed asset in Gallery ───────────────────
    if (targetAlbum) {
      try {
        createdAsset = await Asset.create(namedTempUri, targetAlbum);
      } catch (albumCreateErr) {
        console.warn(
          '[MediaReplacement] Asset.create with album failed, falling back to standard create:',
          albumCreateErr,
        );
        createdAsset = await Asset.create(namedTempUri);
        try {
          await targetAlbum.add(createdAsset);
        } catch {}
      }
    } else {
      createdAsset = await Asset.create(namedTempUri);
      // If album name is desired, create the album with this new asset
      try {
        targetAlbum = await Album.create(albumName, [createdAsset], false);
      } catch (albumErr) {
        console.warn(`[MediaReplacement] Could not create album ${albumName}:`, albumErr);
      }
    }

    // Safety Verification: Ensure new asset is valid before touching original
    if (!createdAsset || !createdAsset.id) {
      throw new Error(
        '[MediaReplacement] Failed to create new asset — null or missing asset returned',
      );
    }

    const newAssetUri = await createdAsset.getUri();
    const newAssetFilename = await createdAsset.getFilename();

    console.log(
      `[MediaReplacement] Verified new asset created: ID=${createdAsset.id}, URI=${newAssetUri}, File=${newAssetFilename}`,
    );

    if (signal?.aborted) {
      // Aborted before deletion: do not delete original
      return {
        success: true,
        status: 'replaced',
        originalPhotoId: photo.id,
        newPhotoId: createdAsset.id,
        newUri: newAssetUri,
        newFilename: newAssetFilename,
        compressedSizeBytes: compResult.sizeBytes,
        originalSizeBytes: compResult.originalSizeBytes,
        quality: compResult.quality,
      };
    }

    // ── Step 5: Delete the original asset ────────────────────────────────────
    let userDeclined = false;

    try {
      // Step 5a: Resolve the genuine MediaLibrary Asset reference
      const genuineOriginalAsset = await resolveGenuineMediaAsset(photo);

      // Step 5b: Log the full shape and validation status before calling native API
      console.log('[MediaReplacement] Deletion pre-check:', {
        incomingPhotoId: photo.id,
        incomingPhotoAssetId: photo.assetId,
        incomingPhotoUri: photo.uri,
        incomingPhotoFilename: photo.filename,
        hasGenuineAsset: !!genuineOriginalAsset,
        genuineAssetId: genuineOriginalAsset?.id,
        isGenuineAssetValid: isGenuineMediaLibraryAsset(genuineOriginalAsset),
      });

      if (genuineOriginalAsset && isGenuineMediaLibraryAsset(genuineOriginalAsset)) {
        // Genuine MediaLibrary asset found with real MediaStore/PHAsset ID
        console.log(
          `[MediaReplacement] Calling Asset.delete() on genuine MediaLibrary Asset ID: ${genuineOriginalAsset.id}`,
        );
        await genuineOriginalAsset.delete();
        console.log(
          `[MediaReplacement] Successfully deleted original MediaLibrary asset: ${genuineOriginalAsset.id}`,
        );
      } else {
        // No MediaStore index entry (raw filesystem file in DCIM folder)
        console.log(
          `[MediaReplacement] Photo not indexed in MediaStore (ID=${photo.id}). Performing direct filesystem cleanup on ${photo.uri}`,
        );
        const localFile = new File(photo.uri);
        if (localFile.exists) {
          localFile.delete();
          console.log(`[MediaReplacement] Successfully deleted unindexed DCIM file: ${photo.uri}`);
        }
      }
    } catch (delError: any) {
      const errMsg = String(delError?.message || delError).toLowerCase();
      console.warn(
        `[MediaReplacement] Deletion of original asset returned error/prompt result:`,
        delError,
      );

      if (
        errMsg.includes('denied') ||
        errMsg.includes('cancel') ||
        errMsg.includes('user') ||
        errMsg.includes('rejected')
      ) {
        userDeclined = true;
      }
      // Note: Even if deletion of the original is declined or fails, the new replacement asset exists.
    }

    // ── Step 6: Clean up temp cache file ────────────────────────────────────
    if (namedTempUri) {
      await cleanupTempFile(namedTempUri);
      namedTempUri = null;
    }

    return {
      success: true,
      status: userDeclined ? 'declined' : 'replaced',
      originalPhotoId: photo.id,
      newPhotoId: createdAsset.id,
      newUri: newAssetUri || photo.uri,
      newFilename: newAssetFilename || sanitizeJpegFilename(originalFilename),
      compressedSizeBytes: compResult.sizeBytes,
      originalSizeBytes: compResult.originalSizeBytes,
      quality: compResult.quality,
    };
  } catch (error: any) {
    console.error(`[MediaReplacement] Error replacing gallery photo ${originalFilename}:`, error);
    if (namedTempUri) {
      await cleanupTempFile(namedTempUri);
    }
    return {
      success: false,
      status: 'failed',
      originalPhotoId: photo.id,
      error: error?.message || 'Gallery photo replacement failed',
    };
  }
}
