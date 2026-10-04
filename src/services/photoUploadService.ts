import * as FileSystem from 'expo-file-system/legacy';
import { ENV, API_ENDPOINTS } from '../config/api.config';
import { GalleryPhotoItem } from '../screens/Gallery/PhotoSelectionGalleryScreen';
import {
  compressToTargetSize,
  cleanupTempFile,
  TARGET_UPLOAD_BYTES,
} from './imageCompressionService';

export interface UploadPhotoResponse {
  images_uploaded?: number;
  total_faces_detected?: number;
  images_without_face?: number;
  images_not_uploaded?: number;
  reason_why_not_uploaded?: { filename?: string; reason?: string }[];
  data?: {
    image_name?: string;
    event_id?: string;
    folder_id?: string | null;
    image_id?: number;
    face?: boolean | null;
    has_face?: boolean | null;
    face_count?: number;
    queued_for_processing?: boolean;
    [key: string]: any;
  }[];
  [key: string]: any;
}

/** Regex for a 24-char lowercase hex MongoDB ObjectId. */
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isValidObjectId(id?: string | null): boolean {
  if (!id) return false;
  return OBJECT_ID_RE.test(id.trim());
}

/** Max file size accepted by Django backend (25 MB default). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Allowed MIME types supported by backend PIL image validator. */
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Custom error thrown when an upload is aborted by caller request.
 */
export class UploadCancelledError extends Error {
  constructor(message = 'Upload was cancelled') {
    super(message);
    this.name = 'UploadCancelledError';
  }
}

/**
 * Helper to identify whether an error resulted from an intentional upload cancellation.
 */
export function isUploadCancelledError(error: any): boolean {
  if (!error) return false;
  if (error instanceof UploadCancelledError || error?.name === 'UploadCancelledError') {
    return true;
  }
  const msg = String(error?.message || error).toLowerCase();
  return (
    msg.includes('upload was cancelled') ||
    msg.includes('network task cancelled') ||
    msg.includes('canceled') ||
    msg.includes('cancelled')
  );
}

/**
 * Small cancellation control abstraction that bridges the caller and the active FileSystem.UploadTask.
 */
export class UploadCancellationControl {
  private _isCancelled = false;
  private _uploadTask: FileSystem.UploadTask | null = null;

  /** True if cancellation has been requested. */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /** The active UploadTask instance once created. */
  get uploadTask(): FileSystem.UploadTask | null {
    return this._uploadTask;
  }

  /** Called internally by uploadSinglePhoto once the task is created. */
  setUploadTask(task: FileSystem.UploadTask | null): void {
    this._uploadTask = task;
    if (this._isCancelled && task) {
      task.cancelAsync().catch(err => {
        console.warn('[UploadCancellationControl] Error cancelling late-registered task:', err);
      });
    }
  }

  /** Request cancellation of the upload. */
  async cancel(): Promise<void> {
    if (this._isCancelled) return;
    this._isCancelled = true;
    if (this._uploadTask) {
      try {
        await this._uploadTask.cancelAsync();
      } catch (err) {
        console.warn('[UploadCancellationControl] Error calling cancelAsync on task:', err);
      }
    }
  }
}

/**
 * Returns the MIME type based on file extension.
 */
function getMimeTypeFromFilename(filename?: string): string {
  if (!filename) return 'image/jpeg';
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  if (
    lower.endsWith('.arw') ||
    lower.endsWith('.cr2') ||
    lower.endsWith('.cr3') ||
    lower.endsWith('.nef') ||
    lower.endsWith('.dng') ||
    lower.endsWith('.raf') ||
    lower.endsWith('.orf') ||
    lower.endsWith('.rw2')
  ) {
    return 'image/x-raw';
  }
  return 'application/octet-stream';
}

/**
 * Uploads a single photo to POST /api/upload-images/ with lossy pre-compression to ~2MB.
 * Supports optional UploadCancellationControl to allow immediate abort of compression and network upload.
 */
export async function uploadSinglePhoto(
  eventId: string,
  photo: GalleryPhotoItem,
  folderId?: string | null,
  onProgress?: (progress: number) => void,
  cancelControl?: UploadCancellationControl,
): Promise<UploadPhotoResponse> {
  // Early cancellation check before starting work
  if (cancelControl?.isCancelled) {
    throw new UploadCancelledError('Upload was cancelled before starting.');
  }

  // 1. Validate eventId (24-char hex)
  if (!isValidObjectId(eventId)) {
    const msg = `[photoUploadService] Invalid eventId: "${eventId}". Must be a 24-character hex MongoDB ObjectId.`;
    console.error(msg);
    throw new Error(msg);
  }

  const filename =
    photo.filename && photo.filename.trim() ? photo.filename.trim() : `photo_${Date.now()}.jpg`;

  // 2. Client-side pre-checks: MIME type / file format
  const mimeType = getMimeTypeFromFilename(filename);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    if (mimeType === 'image/heic') {
      throw new Error(
        `Unsupported format (HEIC/HEIF) for "${filename}". The server only accepts JPEG, PNG, and WebP images.`,
      );
    }
    if (mimeType === 'image/x-raw') {
      throw new Error(
        `Unsupported RAW format for "${filename}". Please convert RAW files to JPEG before uploading.`,
      );
    }
    throw new Error(
      `Unsupported file format for "${filename}". The server accepts only JPEG, PNG, and WebP images.`,
    );
  }

  // 3. Source URI — always the original on-disk file; never a pre-compressed copy
  const sourceUri =
    photo.uri.startsWith('content://') || photo.uri.startsWith('file://')
      ? photo.uri
      : `file://${photo.uri}`;

  /** Temp files created during compression / rename that must be cleaned up after upload. */
  const tempUrisToCleanup: string[] = [];

  try {
    // 4. Compress at upload time (target: 2–3 MB).
    // compressToTargetSize skips encoding for JPEG files already ≤ 4 MB;
    // otherwise iteratively reduces quality, always outputting JPEG.
    const compressionResult = await compressToTargetSize(sourceUri, TARGET_UPLOAD_BYTES);

    // Cancellation check after compression finishes
    if (cancelControl?.isCancelled) {
      throw new UploadCancelledError('Upload was cancelled during compression.');
    }

    let finalUploadUri = compressionResult.uri;
    const finalSizeBytes = compressionResult.sizeBytes;

    // MIME type: compression always outputs JPEG when it ran; keep original type if skipped.
    const finalMime = compressionResult.skipped ? mimeType : 'image/jpeg';

    const initialSizeMb = (
      (compressionResult.originalSizeBytes ?? finalSizeBytes) /
      (1024 * 1024)
    ).toFixed(2);
    const finalSizeMb = (finalSizeBytes / (1024 * 1024)).toFixed(2);

    if (!compressionResult.skipped) {
      console.log('[photoUploadService] Pre-upload Compression Stats:', {
        filename,
        originalSize: `${initialSizeMb} MB`,
        compressedSize: `${finalSizeMb} MB`,
        dimensions: `${compressionResult.width}x${compressionResult.height}`,
        quality: compressionResult.quality,
        iterations: compressionResult.iterations,
        hitFloor: compressionResult.hitFloor,
      });

      // Rename the temp file to the original camera filename.
      // FileSystem.uploadAsync derives the multipart Content-Disposition filename from the
      // fileUri basename, so we must give it the correct name before uploading.
      const renamedUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.moveAsync({ from: finalUploadUri, to: renamedUri });
      finalUploadUri = renamedUri;
      tempUrisToCleanup.push(renamedUri); // cleaned up in finally
    } else {
      console.log(
        `[photoUploadService] Skipped compression (≤4 MB JPEG): ${filename} (${finalSizeMb} MB)`,
      );
    }

    // Cancellation check after file rename/move
    if (cancelControl?.isCancelled) {
      throw new UploadCancelledError('Upload was cancelled before network request.');
    }

    // 5. Client-side size guard (25 MB Django default).
    if (finalSizeBytes > MAX_UPLOAD_BYTES) {
      const sizeMb = (finalSizeBytes / (1024 * 1024)).toFixed(1);
      throw new Error(
        `File size (${sizeMb} MB) for "${filename}" exceeds the 25 MB server upload limit.`,
      );
    }

    const uploadUrl = `${ENV.API_BASE_URL}${API_ENDPOINTS.PHOTOS.UPLOAD}`;

    // Additional multipart form fields (event_id, optional folder_id)
    const additionalParams: Record<string, string> = { event_id: eventId.trim() };
    if (folderId != null && folderId !== '') {
      additionalParams.folder_id = folderId.trim();
    }

    console.log('[photoUploadService] Starting upload:', {
      url: uploadUrl,
      file: { name: filename, mimeType: finalMime, sizeBytes: finalSizeBytes },
      event_id: eventId.trim(),
      ...(additionalParams.folder_id ? { folder_id: additionalParams.folder_id } : {}),
    });

    // 6. Upload via FileSystem.createUploadTask to support byte-level progress and cancellation
    let uploadResult: FileSystem.FileSystemUploadResult;
    try {
      const uploadTask = FileSystem.createUploadTask(
        uploadUrl,
        finalUploadUri,
        {
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          httpMethod: 'POST',
          fieldName: 'images',
          mimeType: finalMime,
          parameters: additionalParams,
          headers: { Accept: 'application/json' },
        },
        data => {
          if (onProgress && data.totalBytesExpectedToSend > 0) {
            const percentage = (data.totalBytesSent / data.totalBytesExpectedToSend) * 100;
            // Never report 100% until the server actually responds successfully
            onProgress(Math.min(99.9, Math.max(0, percentage)));
          }
        },
      );

      // Connect the created task to the cancellation control
      cancelControl?.setUploadTask(uploadTask);

      // Check if cancellation was triggered right as task was created
      if (cancelControl?.isCancelled) {
        await uploadTask.cancelAsync().catch(() => {});
        throw new UploadCancelledError('Upload was cancelled before starting network transfer.');
      }

      const result = await uploadTask.uploadAsync();
      if (!result) {
        if (cancelControl?.isCancelled) {
          throw new UploadCancelledError('Upload task was cancelled.');
        }
        throw new Error('Upload task returned null result.');
      }
      uploadResult = result;
    } catch (networkErr: any) {
      if (cancelControl?.isCancelled || isUploadCancelledError(networkErr)) {
        throw new UploadCancelledError('Upload was cancelled during network transfer.');
      }
      console.error(
        '[photoUploadService] uploadAsync network failure:',
        networkErr?.message ?? networkErr,
      );
      throw networkErr;
    }

    console.log(`[photoUploadService] HTTP ${uploadResult.status} received for "${filename}"`);

    // 7. Parse response body.
    const responseText = uploadResult.body ?? '';
    let responseData: UploadPhotoResponse;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      throw new Error(
        `[photoUploadService] Non-JSON response (HTTP ${uploadResult.status}): ${responseText.slice(0, 300)}`,
      );
    }

    // 8. Handle HTTP error status codes.
    const httpOk = uploadResult.status >= 200 && uploadResult.status < 300;
    if (!httpOk) {
      console.error(
        `[photoUploadService] Upload failed HTTP ${uploadResult.status}:`,
        responseData,
      );
      if (uploadResult.status === 400) {
        const details = responseData.details
          ? typeof responseData.details === 'string'
            ? responseData.details
            : JSON.stringify(responseData.details)
          : responseData.error || JSON.stringify(responseData);
        throw new Error(`Upload failed (Bad Request): ${details}`);
      }
      if (uploadResult.status === 401 || uploadResult.status === 403) {
        throw new Error('Upload failed: Authentication error. Please sign in again.');
      }
      if (uploadResult.status === 404) {
        throw new Error(`Event not found (ID: ${eventId}). Please verify the event still exists.`);
      }
      if (uploadResult.status === 413) {
        throw new Error('Upload failed: File exceeds maximum allowed size on server (413).');
      }
      if (uploadResult.status === 415) {
        throw new Error('Upload failed: Unsupported media type (415).');
      }
      throw new Error(
        `Upload failed: HTTP ${uploadResult.status} — ${responseData.error || JSON.stringify(responseData)}`,
      );
    }

    // 9. Backend returned 2xx — verify the photo was actually stored.
    if ((responseData.images_uploaded ?? 0) < 1) {
      const reasons = responseData.reason_why_not_uploaded;
      if (Array.isArray(reasons) && reasons.length > 0) {
        const firstReason =
          reasons[0]?.reason || reasons[0]?.filename || 'Image rejected by server';
        throw new Error(`Upload failed: ${firstReason}`);
      }
      if ((responseData.images_not_uploaded ?? 0) > 0) {
        throw new Error(`Upload failed: Photo "${filename}" was rejected or already uploaded.`);
      }
    }

    console.log(`[photoUploadService] ✅ Uploaded ${filename} successfully:`, {
      images_uploaded: responseData.images_uploaded,
      total_faces_detected: responseData.total_faces_detected,
    });
    return responseData;
  } finally {
    // Disconnect task from control
    cancelControl?.setUploadTask(null);

    // 10. Clean up all temp files (compressed output + renamed copy) after upload finishes or cancels.
    for (const tempUri of tempUrisToCleanup) {
      await cleanupTempFile(tempUri);
    }
  }
}
