// src/config/photo.config.ts

/**
 * Normalizes user-provided path into a valid file:/// URI for Expo FileSystem.
 * Examples:
 *  - "DCIM/Entephoto" -> "file:///sdcard/DCIM/Entephoto"
 *  - "/sdcard/DCIM/Entephoto" -> "file:///sdcard/DCIM/Entephoto"
 *  - "file:///sdcard/DCIM/Entephoto" -> "file:///sdcard/DCIM/Entephoto"
 */
function normalizePhotoDirectoryUri(rawPath?: string): string {
  if (!rawPath || !rawPath.trim()) {
    return 'file:///sdcard/DCIM/Entephoto';
  }

  let cleaned = rawPath.trim().replace(/\\/g, '/');

  if (cleaned.startsWith('file://')) {
    return cleaned;
  }

  if (cleaned.startsWith('/sdcard/')) {
    return `file://${cleaned}`;
  }

  if (cleaned.startsWith('sdcard/')) {
    return `file:///${cleaned}`;
  }

  if (cleaned.startsWith('/')) {
    return `file:///sdcard${cleaned}`;
  }

  return `file:///sdcard/${cleaned}`;
}

/**
 * Extracts a user-friendly display path (e.g. "DCIM/Entephoto").
 */
function getDisplayPath(uri: string): string {
  return uri.replace(/^file:\/\/\/(?:sdcard\/)?/, '').replace(/^\/+/, '');
}

/**
 * Extracts the default album name (the last folder name in the path).
 */
function extractAlbumName(uri: string, customAlbumName?: string): string {
  if (customAlbumName && customAlbumName.trim()) {
    return customAlbumName.trim();
  }
  const parts = uri.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'Entephoto';
}

// Read env variables (Expo requires EXPO_PUBLIC_ prefix for client-side access)
const rawPhotoPath =
  process.env.EXPO_PUBLIC_PHOTO_STORAGE_PATH ||
  process.env.EXPO_PUBLIC_PHOTO_PATH ||
  process.env.EXPO_PUBLIC_PHOTO_DIR_PATH;

const rawAlbumName = process.env.EXPO_PUBLIC_PHOTO_ALBUM_NAME;

export const PHOTO_STORAGE_DIR_URI = normalizePhotoDirectoryUri(rawPhotoPath);
export const PHOTO_STORAGE_DISPLAY_PATH = getDisplayPath(PHOTO_STORAGE_DIR_URI);
export const PHOTO_ALBUM_NAME = extractAlbumName(PHOTO_STORAGE_DIR_URI, rawAlbumName);
