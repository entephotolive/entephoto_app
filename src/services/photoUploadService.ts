import { File } from 'expo-file-system';
import { ENV, API_ENDPOINTS } from '../config/api.config';
import { GalleryPhotoItem } from '../screens/Gallery/PhotoSelectionGalleryScreen';

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
 * Returns the MIME type based on file extension.
 */
export function getMimeTypeFromFilename(filename?: string): string {
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
 * Uploads a single photo to POST /api/upload-images/.
 *
 * WHY expo-file-system's File instead of { uri, name, type }:
 * Expo SDK 57 replaces global fetch with its own WinterCG-compliant
 * implementation (expo/src/winter/runtime.native.ts:52). That fetch
 * serialises FormData via convertFormDataAsync(), which accepts only
 * strings, Blob instances, or objects with a bytes() method.
 * The plain { uri, name, type } object that React Native's XHR bridge
 * understands is NOT in that list and throws "Unsupported FormDataPart implementation".
 * expo-file-system's File class has bytes() and passes the check.
 */
export async function uploadSinglePhoto(
  eventId: string,
  photo: GalleryPhotoItem,
  folderId?: string | null,
): Promise<UploadPhotoResponse> {
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

  // 3. Normalise URI
  const rawUri = photo.uri ?? '';
  const uri =
    rawUri.startsWith('content://') || rawUri.startsWith('file://') ? rawUri : `file://${rawUri}`;

  // 4. Build expo-file-system File
  const expoFile = new File(uri);
  const nativeType: string = (expoFile as any).type ?? '';
  const finalMime = nativeType && ALLOWED_MIME_TYPES.has(nativeType) ? nativeType : mimeType;
  try {
    (expoFile as any).type = finalMime;
  } catch {
    // Non-writable getter fallback
  }

  // 5. Client-side pre-check: File size limit (25 MB)
  const fileSize: number = (expoFile as any).size ?? 0;
  if (fileSize > MAX_UPLOAD_BYTES) {
    const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File size (${sizeMb} MB) for "${filename}" exceeds the 25 MB server upload limit.`,
    );
  }

  // 6. Build FormData
  const formData = new FormData();
  formData.append('event_id', eventId.trim());
  if (folderId != null && folderId !== '') {
    formData.append('folder_id', folderId.trim());
  }
  formData.append('images', expoFile as unknown as Blob);

  // 7. Headers
  // NOTE: Authorization header is intentionally omitted for this endpoint.
  // Django's DEFAULT_AUTHENTICATION_CLASSES (SimpleJWT) rejects the mobile photographer
  // token (which carries 'photographer_id' instead of 'user_id') with HTTP 401 before the
  // view runs. Since upload_images has AllowAny permissions and does not use request.user,
  // omitting the Authorization header allows the request to succeed without 401.
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const uploadUrl = `${ENV.API_BASE_URL}${API_ENDPOINTS.PHOTOS.UPLOAD}`;

  // Pre-request diagnostic log (header KEYS only, no token values)
  console.log('[photoUploadService] Starting upload:', {
    url: uploadUrl,
    headerKeys: Object.keys(headers),
    file: {
      name: filename,
      mimeType: finalMime,
      sizeBytes: fileSize > 0 ? fileSize : undefined,
    },
  });

  // 8. AbortController with 120s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 120000);

  let rawResponse: Response;
  try {
    rawResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (networkErr: any) {
    if (networkErr?.name === 'AbortError' || controller.signal.aborted) {
      const msg = `Upload timed out after 120s for "${filename}".`;
      console.error('[photoUploadService]', msg);
      throw new Error(msg);
    }
    console.error(
      '[photoUploadService] fetch() network failure:',
      networkErr?.message ?? networkErr,
    );
    throw networkErr;
  } finally {
    clearTimeout(timeoutId);
  }

  // 9. Parse response body
  const responseText = await rawResponse.text();
  let responseData: UploadPhotoResponse;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    throw new Error(
      `[photoUploadService] Non-JSON response (HTTP ${rawResponse.status}): ${responseText.slice(0, 300)}`,
    );
  }

  // 10. Handle HTTP error status codes
  if (!rawResponse.ok) {
    console.error(`[photoUploadService] Upload failed HTTP ${rawResponse.status}:`, responseData);
    if (rawResponse.status === 400) {
      const details = responseData.details
        ? typeof responseData.details === 'string'
          ? responseData.details
          : JSON.stringify(responseData.details)
        : responseData.error || JSON.stringify(responseData);
      throw new Error(`Upload failed (Bad Request): ${details}`);
    }
    if (rawResponse.status === 404) {
      throw new Error(`Event not found (ID: ${eventId}). Please verify the event still exists.`);
    }
    if (rawResponse.status === 413) {
      throw new Error('Upload failed: File exceeds maximum allowed size on server (413).');
    }
    if (rawResponse.status === 415) {
      throw new Error('Upload failed: Unsupported media type (415).');
    }
    throw new Error(
      `Upload failed: HTTP ${rawResponse.status} — ${responseData.error || JSON.stringify(responseData)}`,
    );
  }

  // 11. Backend returned 200 OK — verify that photo was actually stored
  if ((responseData.images_uploaded ?? 0) < 1) {
    const reasons = responseData.reason_why_not_uploaded;
    if (Array.isArray(reasons) && reasons.length > 0) {
      const firstReason = reasons[0]?.reason || reasons[0]?.filename || 'Image rejected by server';
      throw new Error(`Upload failed: ${firstReason}`);
    }
    if ((responseData.images_not_uploaded ?? 0) > 0) {
      throw new Error(`Upload failed: Photo "${filename}" was rejected or already uploaded.`);
    }
  }

  console.log(`[photoUploadService] Successfully uploaded ${filename}:`, responseData);
  return responseData;
}
