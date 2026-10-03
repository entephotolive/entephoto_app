import { Platform, PermissionsAndroid } from 'react-native';
import { Directory, File } from 'expo-file-system';
import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import { PHOTO_STORAGE_DIR_URI, PHOTO_STORAGE_DISPLAY_PATH } from '@/config/photo.config';

// ── Canonical Photo Directory on Android (synced with env) ────────────────────
export const CANONICAL_DCIM_DIR_URI = PHOTO_STORAGE_DIR_URI;
export { PHOTO_STORAGE_DISPLAY_PATH };

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
function isPhotoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Checks if a filename is a genuine camera RAW format
 */
function isRawPhoto(name: string): boolean {
  const lower = name.toLowerCase();
  return RAW_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Formats a time in HH:MM format without using toLocaleTimeString (avoids Intl overhead on Hermes).
 */
function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h < 10 ? `0${h}` : `${h}`;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hh}:${mm}`;
}

/**
 * Checks if storage permission is already granted without prompting the user.
 */
async function checkStoragePermission(): Promise<boolean> {
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

    return await PermissionsAndroid.check(permission);
  } catch (error) {
    console.error('[LocalPhotoService] Error checking storage permission:', error);
    return false;
  }
}

/**
 * Requests the correct Android storage permission based on API level
 * - Android 13+ (API 33+): READ_MEDIA_IMAGES
 * - Android 12 and below (API <= 32): READ_EXTERNAL_STORAGE
 */
async function requestStoragePermission(): Promise<boolean> {
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
      message: `EntePhoto requires storage access to view and sync photos from your ${PHOTO_STORAGE_DISPLAY_PATH} folder.`,
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
 * Scans the configured photo storage directory using Expo SDK 57 Directory API.
 *
 * PERFORMANCE NOTE: The previous implementation called Album.get() + album.getAssets()
 * + sequential await a.getFilename() for every asset, which caused 26–32 second scan
 * times for 466 photos and overwhelmed the JS bridge. This has been removed entirely.
 *
 * The file name and URI are already available directly from the expo-file-system
 * Directory.list() result (file.name, file.uri). The MediaLibrary asset ID lookup
 * (assetId field) was only used for display and is not required for the gallery's
 * core photo selection, marking, upload, or deletion workflows. Those workflows
 * use file.uri as the stable identifier.
 *
 * Returns sorted photos (newest first) with no bridge-blocking sequential awaits.
 */
export async function scanDcimEntephotoPhotos(
  silent: boolean = false,
): Promise<GalleryPhotoItem[]> {
  if (Platform.OS !== 'android') {
    return [];
  }

  const hasPermission = silent ? await checkStoragePermission() : await requestStoragePermission();
  if (!hasPermission) {
    if (!silent) {
      console.warn(
        `[LocalPhotoService] Storage permission denied. Cannot scan ${PHOTO_STORAGE_DISPLAY_PATH} directory.`,
      );
    }
    return [];
  }

  try {
    const dir = new Directory(CANONICAL_DCIM_DIR_URI);

    if (!dir.exists) {
      if (!silent) {
        console.warn(
          `[LocalPhotoService] Directory does not exist on device: ${CANONICAL_DCIM_DIR_URI}`,
        );
      }
      return [];
    }

    const entries = dir.list();
    const photoEntries = entries.filter((entry): entry is File => {
      return entry instanceof File && isPhotoFile(entry.name);
    });

    const scannedPhotos: GalleryPhotoItem[] = photoEntries.map((file, index) => {
      const isRaw = isRawPhoto(file.name);
      const modTime = file.modificationTime;

      // Normalize modificationTime: Expo FileSystem returns seconds on Android.
      const capturedAt: number | undefined = modTime
        ? typeof modTime === 'number' && modTime < 1e10
          ? modTime * 1000 // Expo returns seconds — convert to ms
          : (modTime as number) // Already ms
        : undefined;

      // Use fast manual HH:MM formatting instead of toLocaleTimeString (avoids Intl
      // initialization overhead on Hermes which causes blocking delays in tight loops).
      const timeFormatted = capturedAt ? formatTime(capturedAt) : 'Just now';

      return {
        // Use filename-based stable ID — avoids the expensive sequential MediaLibrary
        // getFilename() loop that was previously adding 26–32 s per scan cycle.
        id: `dcim-${file.name}`,
        assetId: undefined,
        uri: file.uri,
        filename: file.name,
        isRaw,
        status: 'new',
        selected: false,
        timestamp: timeFormatted,
        capturedAt,
        dimensions: undefined,
        aperture: undefined,
        shutter: undefined,
      };
    });

    if (scannedPhotos.length > 0) {
      console.log(`[LocalPhotoService] Scanned ${scannedPhotos.length} photos.`);
    }

    // Preserve the correct chronological order (newest first)
    scannedPhotos.sort((a, b) => {
      const timeA = a.capturedAt ?? 0;
      const timeB = b.capturedAt ?? 0;
      return timeB - timeA;
    });

    return scannedPhotos;
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
 *
 * POLLING DESIGN — NON-OVERLAPPING:
 * The previous implementation used setInterval(scanAndNotify, 2000). Because
 * scanDcimEntephotoPhotos takes 26–32 seconds per call, setInterval spawned a new
 * overlapping scan every 2 seconds without waiting for the previous one to finish.
 * After 60 seconds of the gallery being open, 30+ concurrent scan operations were
 * running simultaneously, saturating the JS bridge and causing all UI interactions
 * (menus, taps, navigation) to freeze.
 *
 * The new design uses a recursive setTimeout loop: the next scan is only scheduled
 * AFTER the current scan finishes. This guarantees zero overlapping scans.
 *
 * The Directory.watch() native watcher is preserved for instant notification of
 * new photos being added by the camera, but it is also guarded against launching
 * a new scan while one is already running.
 */
export function subscribeToDcimPhotos(
  onPhotosUpdated: (photos: GalleryPhotoItem[]) => void,
  pollIntervalMs: number = 10000,
): () => void {
  let isSubscribed = true;
  let isScanning = false;
  let watcherSubscription: { remove: () => void } | null = null;
  let nextPollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = '';

  const scheduleNextPoll = () => {
    if (!isSubscribed) return;
    nextPollTimer = setTimeout(() => {
      runScan(true);
    }, pollIntervalMs);
  };

  const runScan = async (silent: boolean) => {
    // Strict guard: never run two scans concurrently.
    if (!isSubscribed || isScanning) return;
    isScanning = true;
    try {
      const photos = await scanDcimEntephotoPhotos(silent);
      if (!isSubscribed) return;

      // Only notify the subscriber when the set of photo URIs has actually changed.
      // Joining all URIs into a string is O(N) but far cheaper than re-rendering
      // 466+ gallery tiles when nothing has changed.
      const signature = photos.map(p => p.uri).join('|');
      if (signature !== lastSignature) {
        lastSignature = signature;
        console.log(`[LocalPhotoService] Emitting ${photos.length} updated photos to gallery`);
        onPhotosUpdated(photos);
      }
    } catch (error) {
      console.error('[LocalPhotoService] Error during scan:', error);
    } finally {
      isScanning = false;
      // Schedule the next poll only after this one has fully completed.
      scheduleNextPoll();
    }
  };

  // 1. Initial scan on subscription start (shows permission dialog if needed).
  requestStoragePermission()
    .then(granted => {
      if (granted && isSubscribed) {
        runScan(false);
      }
    })
    .catch(err => {
      console.error('[LocalPhotoService] Permission request failed:', err);
    });

  // 2. Set up native directory watcher for instant notification of new camera photos.
  //    The watcher callback is also guarded by isScanning so it cannot launch an
  //    overlapping scan if a poll is already in progress.
  if (Platform.OS === 'android') {
    try {
      const dir = new Directory(CANONICAL_DCIM_DIR_URI);
      if (dir.exists) {
        watcherSubscription = dir.watch(() => {
          if (!isScanning && isSubscribed) {
            console.log('[LocalPhotoService] Directory change detected, triggering scan.');
            // Cancel any pending poll timer so we don't double-scan shortly after.
            if (nextPollTimer !== null) {
              clearTimeout(nextPollTimer);
              nextPollTimer = null;
            }
            runScan(true);
          }
        });
      }
    } catch (err) {
      console.warn(
        '[LocalPhotoService] Directory.watch() not supported, using interval polling only:',
        err,
      );
    }
  }

  return () => {
    isSubscribed = false;
    if (nextPollTimer !== null) {
      clearTimeout(nextPollTimer);
      nextPollTimer = null;
    }
    if (watcherSubscription) {
      try {
        watcherSubscription.remove();
      } catch {}
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
