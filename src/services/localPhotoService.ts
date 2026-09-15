import { Platform, PermissionsAndroid } from 'react-native';
import { Directory, File } from 'expo-file-system';
import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';

// ── Canonical DCIM Entephoto Directory on Android ────────────────────────────
export const CANONICAL_DCIM_DIR_URI = 'file:///sdcard/DCIM/Entephoto';

// Supported Image Extensions
const SUPPORTED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.dng',
  '.heic',
  '.webp',
];

// Genuine RAW Camera Extensions
const RAW_EXTENSIONS = [
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.dng',
  '.rw2',
  '.orf',
  '.raf',
  '.srw',
  '.pef',
];

/**
 * Checks if a filename is a supported image file
 */
export function isPhotoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Checks if a filename is a genuine camera RAW format
 */
export function isRawPhoto(name: string): boolean {
  const lower = name.toLowerCase();
  return RAW_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Requests the correct Android storage permission based on API level
 * - Android 13+ (API 33+): READ_MEDIA_IMAGES
 * - Android 12 and below (API <= 32): READ_EXTERNAL_STORAGE
 */
export async function requestStoragePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const apiLevel =
      typeof Platform.Version === 'number'
        ? Platform.Version
        : parseInt(String(Platform.Version), 10);
    const permission =
      apiLevel >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

    const hasPermission = await PermissionsAndroid.check(permission);
    if (hasPermission) {
      console.log(`[LocalPhotoService] Storage permission already granted (${permission})`);
      return true;
    }

    console.log(`[LocalPhotoService] Requesting storage permission: ${permission}`);
    const result = await PermissionsAndroid.request(permission, {
      title: 'EntePhoto Storage Access',
      message:
        'EntePhoto requires storage access to view and sync photos from your DCIM/Entephoto folder.',
      buttonNeutral: 'Ask Me Later',
      buttonNegative: 'Cancel',
      buttonPositive: 'Grant Access',
    });

    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    console.log(`[LocalPhotoService] Storage permission request result: ${result}`);
    return granted;
  } catch (error) {
    console.error('[LocalPhotoService] Error requesting storage permission:', error);
    return false;
  }
}

/**
 * Scans /sdcard/DCIM/Entephoto dynamically using Expo SDK 57 Directory API.
 * Returns only real photos found on disk, or empty array with clear error logs.
 */
export async function scanDcimEntephotoPhotos(): Promise<GalleryPhotoItem[]> {
  if (Platform.OS !== 'android') {
    console.log('[LocalPhotoService] Non-Android platform detected; skipping DCIM scan.');
    return [];
  }

  const hasPermission = await requestStoragePermission();
  if (!hasPermission) {
    console.warn(
      '[LocalPhotoService] Storage permission denied. Cannot scan DCIM/Entephoto directory.',
    );
    return [];
  }

  try {
    console.log(`[LocalPhotoService] Scanning directory: ${CANONICAL_DCIM_DIR_URI}`);
    const dir = new Directory(CANONICAL_DCIM_DIR_URI);

    if (!dir.exists) {
      console.warn(
        `[LocalPhotoService] Directory does not exist on device: ${CANONICAL_DCIM_DIR_URI}`,
      );
      return [];
    }

    const entries = dir.list();
    console.log(`[LocalPhotoService] Directory entries found: ${entries.length}`);

    const photoEntries = entries.filter((entry): entry is File => {
      return entry instanceof File && isPhotoFile(entry.name);
    });

    console.log(
      `[LocalPhotoService] Valid photo files found in DCIM/Entephoto: ${photoEntries.length}`,
    );

    return photoEntries.map((file, index) => {
      const isRaw = isRawPhoto(file.name);
      const modTime = file.modificationTime;
      const timeFormatted = modTime
        ? new Date(modTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';

      return {
        id: `dcim-${file.name}-${index}`,
        uri: file.uri,
        filename: file.name,
        isRaw,
        status: 'new',
        selected: false,
        timestamp: timeFormatted,
        dimensions: undefined,
        aperture: undefined,
        iso: undefined,
        shutter: undefined,
      };
    });
  } catch (error: any) {
    console.error(
      `[LocalPhotoService] Failed to read directory at ${CANONICAL_DCIM_DIR_URI}:`,
      error?.message || error,
    );
    return [];
  }
}

/**
 * Subscribes to real-time additions/modifications in the DCIM folder.
 * Uses Directory.watch() and a periodic polling interval to guarantee instant updates.
 */
export function subscribeToDcimPhotos(
  onPhotosUpdated: (photos: GalleryPhotoItem[]) => void,
  pollIntervalMs: number = 2000,
): () => void {
  let isSubscribed = true;
  let watcherSubscription: { remove: () => void } | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastSignature = '';

  const scanAndNotify = async () => {
    if (!isSubscribed) return;
    try {
      const photos = await scanDcimEntephotoPhotos();
      if (!isSubscribed) return;

      const signature = photos.map(p => p.uri).join('|');
      if (signature !== lastSignature) {
        lastSignature = signature;
        console.log(`[LocalPhotoService] Emitting ${photos.length} updated photos to gallery`);
        onPhotosUpdated(photos);
      }
    } catch (error) {
      console.error('[LocalPhotoService] Error during watch check:', error);
    }
  };

  // 1. Initial scan
  scanAndNotify();

  // 2. Set up native directory watcher if directory exists
  if (Platform.OS === 'android') {
    try {
      const dir = new Directory(CANONICAL_DCIM_DIR_URI);
      if (dir.exists) {
        watcherSubscription = dir.watch(() => {
          console.log('[LocalPhotoService] Directory change event detected via Directory.watch()');
          scanAndNotify();
        });
      }
    } catch (err) {
      console.warn(
        '[LocalPhotoService] Directory.watch() not supported on target directory, falling back to interval:',
        err,
      );
    }
  }

  // 3. Polling interval to ensure newly added camera photos show up immediately
  intervalId = setInterval(scanAndNotify, pollIntervalMs);

  return () => {
    isSubscribed = false;
    if (watcherSubscription) {
      try {
        watcherSubscription.remove();
      } catch {}
    }
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}

/**
 * Deletes a local photo file from disk if it exists.
 */
export async function deleteLocalPhoto(fileUri: string): Promise<boolean> {
  try {
    const file = new File(fileUri);
    if (file.exists) {
      file.delete();
      console.log(`[LocalPhotoService] Successfully deleted file: ${fileUri}`);
      return true;
    }
    console.warn(`[LocalPhotoService] File not found for deletion: ${fileUri}`);
    return false;
  } catch (error) {
    console.error(`[LocalPhotoService] Failed to delete file ${fileUri}:`, error);
    return false;
  }
}
