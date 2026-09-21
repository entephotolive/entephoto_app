import { apiClient } from './apiClient';
import { API_ENDPOINTS } from '../config/api.config';
import { GalleryPhotoItem } from '../screens/Gallery/PhotoSelectionGalleryScreen';

export interface UploadPhotoResponse {
  images_uploaded?: number;
  images_not_uploaded?: number;
  data?: {
    image_name?: string;
    event_id?: string;
    folder_id?: string | null;
    image_id?: number;
    face?: boolean | null;
    has_face?: boolean | null;
    [key: string]: any;
  }[];
  [key: string]: any;
}

/**
 * Returns appropriate MIME type based on file extension
 */
export function getMimeTypeFromFilename(filename?: string): string {
  if (!filename) return 'image/jpeg';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (
    lower.endsWith('.arw') ||
    lower.endsWith('.cr2') ||
    lower.endsWith('.cr3') ||
    lower.endsWith('.nef') ||
    lower.endsWith('.dng')
  ) {
    return 'image/x-raw';
  }
  return 'image/jpeg';
}

/**
 * Uploads a single photo to the backend /api/upload-images/ endpoint.
 */
export async function uploadSinglePhoto(
  eventId: string,
  photo: GalleryPhotoItem,
  folderId?: string | null,
): Promise<UploadPhotoResponse> {
  const formData = new FormData();
  formData.append('event_id', eventId);
  if (folderId) {
    formData.append('folder_id', folderId);
  }

  const filename = photo.filename || `photo_${Date.now()}.jpg`;
  const mimeType = getMimeTypeFromFilename(filename);

  formData.append('images', {
    uri: photo.uri,
    name: filename,
    type: mimeType,
  } as any);

  console.log(`[photoUploadService] Uploading photo ${filename} to event ${eventId}...`);

  const response = await apiClient.post<UploadPhotoResponse>(
    API_ENDPOINTS.PHOTOS.UPLOAD,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );

  console.log(`[photoUploadService] Successfully uploaded ${filename}:`, response.data);
  return response.data;
}
