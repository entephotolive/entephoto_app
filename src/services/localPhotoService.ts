import { Platform, PermissionsAndroid } from 'react-native';
import { Directory, File } from 'expo-file-system';
import { addPhotoSavedListener } from 'entephoto-camera';
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
  '.crw',
  '.nef',
  '.nrw',
  '.dng',
  '.raw',
  '.rw2',
  '.orf',
  '.raf',
  '.srw',
  '.pef',
  '.heic',
  '.heif',
  '.hif',
  '.webp',
  '.avif',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
];

// Genuine RAW Camera Extensions
const RAW_EXTENSIONS = [
  '.arw',
  '.cr2',
  '.cr3',
  '.crw',
  '.nef',
  '.nrw',
  '.dng',
  '.raw',
  '.rw2',
  '.orf',
  '.raf',
  '.srw',
  '.pef',
];

let directoryInitPromise: Promise<boolean> | null = null;

/**
 * Ensures the canonical DCIM/Entephoto directory exists on the device.
 * Idempotent: checks existence before creating, safe to call repeatedly.
 * Returns true if the directory exists or was created successfully.
 */
export async function ensurePhotoDirectoryExists(silent: boolean = false): Promise<boolean> {
  if (directoryInitPromise) {
    return directoryInitPromise;
  }

  directoryInitPromise = (async () => {
    if (Platform.OS !== 'android') {
      return true;
    }

    try {
      const hasPermission = silent
        ? await checkStoragePermission()
        : await requestStoragePermission();

      if (!hasPermission) {
        if (!silent) {
          console.warn(
            `[LocalPhotoService] Storage permission denied. Cannot initialize ${PHOTO_STORAGE_DISPLAY_PATH} directory.`,
          );
        }
        return false;
      }

      const dir = new Directory(CANONICAL_DCIM_DIR_URI);
      if (!dir.exists) {
        dir.create({ intermediates: true });
        console.log(`[LocalPhotoService] Created canonical directory: ${CANONICAL_DCIM_DIR_URI}`);
      }
      return true;
    } catch (error) {
      console.error(
        `[LocalPhotoService] Failed to ensure canonical directory exists at ${CANONICAL_DCIM_DIR_URI}:`,
        error,
      );
      return false;
    }
  })();

  const success = await directoryInitPromise;
  if (!success) {
    // Reset so subsequent attempts (e.g. after user grants permission or retries) can re-run
    directoryInitPromise = null;
  }
  return success;
}

export function resetDirectoryInitPromise(): void {
  directoryInitPromise = null;
}

/**
 * Checks if a filename is a supported image file
 */
function isPhotoFile(name: string): boolean {
  if (!name || name.startsWith('.')) {
    return false;
  }
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Checks if a filename is a genuine camera RAW format
 */
function isRawPhoto(name: string): boolean {
  if (!name || name.startsWith('.')) {
    return false;
  }
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

// ── Shared Photo Scan State & Concurrency Control ────────────────────────────
let activeScanCount = 0;
let currentScanSequenceId = 0;
const scanListeners = new Set<(isScanning: boolean) => void>();

function notifyScanListeners(): void {
  const isScanning = activeScanCount > 0;
  scanListeners.forEach(listener => {
    try {
      listener(isScanning);
    } catch (e) {
      console.error('[LocalPhotoService] Error in photo scan listener:', e);
    }
  });
}

/**
 * Subscribes to active photo scan / fetch state transitions across the application.
 * Immediately invokes the listener with the current state.
 * Returns an unsubscribe callback.
 */
export function addPhotoScanListener(listener: (isScanning: boolean) => void): () => void {
  scanListeners.add(listener);
  try {
    listener(activeScanCount > 0);
  } catch (e) {
    console.error('[LocalPhotoService] Error invoking scan listener on registration:', e);
  }
  return () => {
    scanListeners.delete(listener);
  };
}

/**
 * Returns true if any photo scanning, fetching, or directory reading operation is currently running.
 */
export function isPhotoScanInProgress(): boolean {
  return activeScanCount > 0;
}

/**
 * Helper to retrieve the scan sequence ID attached to a scanned photo list.
 * Newer scans have higher sequence IDs, preventing older results from overwriting newer data.
 */
export function getPhotoScanSequenceId(photos: GalleryPhotoItem[]): number {
  return (photos as any)?.scanSequenceId ?? 0;
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

  const sequenceId = ++currentScanSequenceId;
  activeScanCount++;
  notifyScanListeners();

  try {
    // 1. Ensure canonical directory exists and storage permission is granted
    const initialized = await ensurePhotoDirectoryExists(silent);
    if (!initialized) {
      const hasPermission = await checkStoragePermission();
      if (!hasPermission) {
        if (!silent) {
          console.warn(
            `[LocalPhotoService] Storage permission denied. Cannot scan ${PHOTO_STORAGE_DISPLAY_PATH} directory.`,
          );
        }
        throw new Error(`Storage permission denied for ${PHOTO_STORAGE_DISPLAY_PATH}`);
      }
      throw new Error(`Failed to access or create ${PHOTO_STORAGE_DISPLAY_PATH}`);
    }

    const dir = new Directory(CANONICAL_DCIM_DIR_URI);
    if (!dir.exists) {
      throw new Error(`Directory ${PHOTO_STORAGE_DISPLAY_PATH} does not exist`);
    }

    const entries = dir.list();
    const photoEntries: File[] = [];

    for (const entry of entries) {
      if (entry instanceof File && isPhotoFile(entry.name)) {
        photoEntries.push(entry);
      }
    }

    const scannedPhotos: GalleryPhotoItem[] = photoEntries.map(file => {
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
      const timeFormatted = capturedAt ? formatTime(capturedAt) : '--:--';

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

    if (scannedPhotos.length > 0 && !silent) {
      console.log(
        `[LocalPhotoService] Scanned ${scannedPhotos.length} photos (seq #${sequenceId}).`,
      );
    }

    // Preserve the correct chronological order (newest first) with deterministic tiebreaking
    scannedPhotos.sort((a, b) => {
      const timeA = a.capturedAt ?? 0;
      const timeB = b.capturedAt ?? 0;
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      return (b.filename || b.id).localeCompare(a.filename || a.id);
    });

    // Tag the scanned result array with its unique sequence ID for safe concurrency
    (scannedPhotos as any).scanSequenceId = sequenceId;

    return scannedPhotos;
  } catch (error: any) {
    console.error(
      `[LocalPhotoService] Failed to read directory at ${CANONICAL_DCIM_DIR_URI}:`,
      error?.message || error,
    );
    throw error;
  } finally {
    activeScanCount = Math.max(0, activeScanCount - 1);
    notifyScanListeners();
  }
}

/**
 * Subscribes to real-time additions/modifications in the DCIM folder.
 *
 * POLLING & EVENT DESIGN:
 * - Uses non-overlapping scan scheduling with a recursive setTimeout loop.
 * - Flags pending scans when triggers arrive while an active scan is running.
 * - Debounces rapid native watcher and onPhotoSaved events (150ms) to avoid jitter.
 * - Guards against older async scan responses overwriting newer photo data via sequence IDs.
 */
export function subscribeToDcimPhotos(
  onPhotosUpdated: (photos: GalleryPhotoItem[]) => void,
  pollIntervalMs: number = 10000,
): () => void {
  let isSubscribed = true;
  let isScanning = false;
  let hasPendingScan = false;
  let watcherSubscription: { remove: () => void } | null = null;
  let photoSavedSub: { remove: () => void } | null = null;
  let nextPollTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = '';
  let latestAppliedSequence = 0;

  const scheduleNextPoll = () => {
    if (!isSubscribed) return;
    nextPollTimer = setTimeout(() => {
      runScan(true);
    }, pollIntervalMs);
  };

  const runScan = async (silent: boolean) => {
    if (!isSubscribed) return;
    if (isScanning) {
      hasPendingScan = true;
      return;
    }
    isScanning = true;
    try {
      const photos = await scanDcimEntephotoPhotos(silent);
      if (!isSubscribed) return;

      const seq = getPhotoScanSequenceId(photos);
      if (seq >= latestAppliedSequence) {
        latestAppliedSequence = seq;
        // Only notify the subscriber when the set of photo URIs has actually changed.
        const signature = photos.map(p => p.uri).join('|');
        if (signature !== lastSignature) {
          lastSignature = signature;
          console.log(
            `[LocalPhotoService] Emitting ${photos.length} updated photos (seq #${seq}) to gallery`,
          );
          onPhotosUpdated(photos);
        }
      } else {
        console.log(
          `[LocalPhotoService] Dropping stale scan result (seq #${seq} < latest #${latestAppliedSequence})`,
        );
      }
    } catch (error) {
      console.error('[LocalPhotoService] Error during scan:', error);
    } finally {
      isScanning = false;
      if (isSubscribed) {
        if (hasPendingScan) {
          hasPendingScan = false;
          Promise.resolve().then(() => runScan(true));
        } else {
          scheduleNextPoll();
        }
      }
    }
  };

  const triggerDebouncedScan = () => {
    if (!isSubscribed) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (nextPollTimer !== null) {
        clearTimeout(nextPollTimer);
        nextPollTimer = null;
      }
      runScan(true);
    }, 150);
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

  // 2. Set up native directory watcher on the canonical folder for instant notification of new camera photos.
  if (Platform.OS === 'android') {
    try {
      const dir = new Directory(CANONICAL_DCIM_DIR_URI);
      if (dir.exists) {
        watcherSubscription = dir.watch(() => {
          if (isSubscribed) {
            console.log(
              '[LocalPhotoService] Directory change detected, triggering debounced scan.',
            );
            triggerDebouncedScan();
          }
        });
      }
    } catch (err) {
      console.warn(
        '[LocalPhotoService] Directory.watch() not supported, using interval polling only:',
        err,
      );
    }

    // 3. Hook into native onPhotoSaved event for instant gallery updates
    try {
      photoSavedSub = addPhotoSavedListener(event => {
        console.log(
          '[LocalPhotoService] onPhotoSaved event received:',
          event.filename,
          '— triggering debounced scan',
        );
        if (isSubscribed) {
          triggerDebouncedScan();
        }
      });
    } catch (err) {
      console.warn('[LocalPhotoService] Failed to bind addPhotoSavedListener:', err);
    }
  }

  return () => {
    isSubscribed = false;
    hasPendingScan = false;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (nextPollTimer !== null) {
      clearTimeout(nextPollTimer);
      nextPollTimer = null;
    }
    if (watcherSubscription) {
      try {
        watcherSubscription.remove();
      } catch {}
    }
    if (photoSavedSub) {
      try {
        photoSavedSub.remove();
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
