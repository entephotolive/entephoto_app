import { Platform, PermissionsAndroid } from 'react-native';
import { Directory, File, type WatchEvent, type WatchSubscription } from 'expo-file-system';
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
let inFlightScanPromise: Promise<GalleryPhotoItem[]> | null = null;
const cachedPhotosMap = new Map<string, GalleryPhotoItem>();

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
 * Sorts photo items chronologically (newest first) with deterministic filename tiebreaking.
 */
function sortPhotosChronological(photos: GalleryPhotoItem[]): void {
  photos.sort((a, b) => {
    const timeA = a.capturedAt ?? 0;
    const timeB = b.capturedAt ?? 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return (b.filename || b.id).localeCompare(a.filename || a.id);
  });
}

/**
 * Constructs a single GalleryPhotoItem from an Expo FileSystem File object.
 * Reads modificationTime only for this single file without re-enumerating the directory.
 */
export function buildPhotoItemFromFile(file: File): GalleryPhotoItem | null {
  if (!isPhotoFile(file.name)) {
    return null;
  }
  const isRaw = isRawPhoto(file.name);
  let capturedAt: number | undefined;
  try {
    const modTime = file.modificationTime;
    capturedAt = modTime
      ? typeof modTime === 'number' && modTime < 1e10
        ? modTime * 1000 // Expo returns seconds on Android — convert to ms
        : (modTime as number)
      : undefined;
  } catch {
    capturedAt = undefined;
  }

  const timeFormatted = capturedAt ? formatTime(capturedAt) : '--:--';

  return {
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
}

/**
 * Scans the configured photo storage directory using Expo SDK 57 Directory API.
 * Deduplicates in-flight calls: returns shared promise if a scan is already running.
 *
 * Returns sorted photos (newest first) with no bridge-blocking sequential awaits.
 */
export async function scanDcimEntephotoPhotos(
  silent: boolean = false,
  force: boolean = false,
): Promise<GalleryPhotoItem[]> {
  if (Platform.OS !== 'android') {
    return [];
  }

  // Deduplicate concurrent scans: if a scan is already in flight and not forced, reuse the in-flight promise
  if (inFlightScanPromise && !force) {
    return inFlightScanPromise;
  }

  inFlightScanPromise = (async () => {
    const sequenceId = ++currentScanSequenceId;
    if (!silent) {
      activeScanCount++;
      notifyScanListeners();
    }

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

      const scannedPhotos: GalleryPhotoItem[] = [];
      for (const file of photoEntries) {
        const item = buildPhotoItemFromFile(file);
        if (item) {
          scannedPhotos.push(item);
        }
      }

      if (scannedPhotos.length > 0 && !silent) {
        console.log(
          `[LocalPhotoService] Full scan completed: ${scannedPhotos.length} photos (seq #${sequenceId}).`,
        );
      }

      // Preserve chronological order (newest first) with deterministic tiebreaking
      sortPhotosChronological(scannedPhotos);
      (scannedPhotos as any).scanSequenceId = sequenceId;

      // Synchronize in-memory authoritative cache
      cachedPhotosMap.clear();
      for (const p of scannedPhotos) {
        cachedPhotosMap.set(p.id, p);
        if (p.uri) {
          cachedPhotosMap.set(p.uri, p);
        }
      }

      return scannedPhotos;
    } catch (error: any) {
      console.error(
        `[LocalPhotoService] Failed to read directory at ${CANONICAL_DCIM_DIR_URI}:`,
        error?.message || error,
      );
      throw error;
    } finally {
      if (!silent) {
        activeScanCount = Math.max(0, activeScanCount - 1);
        notifyScanListeners();
      }
      inFlightScanPromise = null;
    }
  })();

  return inFlightScanPromise;
}

export type PhotoSubscriptionOptions = {
  onError?: (error: any) => void;
};

/**
 * Subscribes to real-time DCIM folder changes.
 *
 * EVENT-DRIVEN DESIGN:
 * - Performs one complete initial scan upon entering the Gallery.
 * - Watches directory changes via Directory.watch() and native camera onPhotoSaved events.
 * - Safely buffers incoming events during the initial scan so no camera imports are lost.
 * - Incrementally adds, updates, or deletes single photo items without re-enumerating the folder.
 * - Coalesces rapid event bursts with a short 50ms debounce.
 * - Falls back to a debounced single scan only if a watcher event is coarse (directory-level).
 * - Zero recurring 2-second polling!
 */
export function subscribeToDcimPhotos(
  onPhotosUpdated: (photos: GalleryPhotoItem[]) => void,
  options?: PhotoSubscriptionOptions | number,
): () => void {
  let isSubscribed = true;
  let isInitialScanInFlight = true;
  const pendingInitialScanEvents: (() => void)[] = [];
  let watcherSubscription: WatchSubscription | null = null;
  let photoSavedSub: { remove: () => void } | null = null;
  let emitDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let coarseScanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const callbacks = typeof options === 'object' && options !== null ? options : undefined;

  const emitUpdatedPhotos = () => {
    if (!isSubscribed) return;
    const unique = new Set<GalleryPhotoItem>();
    for (const item of cachedPhotosMap.values()) {
      unique.add(item);
    }
    const sorted = Array.from(unique);
    sortPhotosChronological(sorted);
    const seq = ++currentScanSequenceId;
    (sorted as any).scanSequenceId = seq;
    console.log(
      `[LocalPhotoService] Emitting ${sorted.length} updated photos (seq #${seq}) to subscriber`,
    );
    onPhotosUpdated(sorted);
  };

  const scheduleEmit = () => {
    if (!isSubscribed) return;
    if (emitDebounceTimer !== null) {
      clearTimeout(emitDebounceTimer);
    }
    emitDebounceTimer = setTimeout(() => {
      emitDebounceTimer = null;
      emitUpdatedPhotos();
    }, 50);
  };

  const scheduleCoarseScan = () => {
    if (!isSubscribed) return;
    if (coarseScanDebounceTimer !== null) {
      clearTimeout(coarseScanDebounceTimer);
    }
    coarseScanDebounceTimer = setTimeout(async () => {
      coarseScanDebounceTimer = null;
      try {
        console.log(
          '[LocalPhotoService] Coarse directory event detected — executing single fallback rescan',
        );
        const photos = await scanDcimEntephotoPhotos(true, true);
        if (isSubscribed) {
          onPhotosUpdated(photos);
        }
      } catch (err) {
        console.error('[LocalPhotoService] Coarse rescan failed:', err);
      }
    }, 150);
  };

  const handleFileUpsert = (file: File) => {
    const apply = () => {
      try {
        if (!file.exists) return;
        const photoItem = buildPhotoItemFromFile(file);
        if (!photoItem) return;

        const existing = cachedPhotosMap.get(photoItem.id) || cachedPhotosMap.get(photoItem.uri);
        if (
          existing &&
          existing.capturedAt === photoItem.capturedAt &&
          existing.uri === photoItem.uri &&
          existing.filename === photoItem.filename
        ) {
          return;
        }

        cachedPhotosMap.set(photoItem.id, photoItem);
        cachedPhotosMap.set(photoItem.uri, photoItem);
        scheduleEmit();
      } catch (e) {
        console.warn(`[LocalPhotoService] Failed to process file event for ${file.name}:`, e);
      }
    };

    if (isInitialScanInFlight) {
      pendingInitialScanEvents.push(apply);
    } else {
      apply();
    }
  };

  const handleFileDelete = (filename: string, uri: string) => {
    const apply = () => {
      const id = `dcim-${filename}`;
      let changed = false;
      if (cachedPhotosMap.has(id)) {
        cachedPhotosMap.delete(id);
        changed = true;
      }
      if (cachedPhotosMap.has(uri)) {
        cachedPhotosMap.delete(uri);
        changed = true;
      }
      if (changed) {
        scheduleEmit();
      }
    };

    if (isInitialScanInFlight) {
      pendingInitialScanEvents.push(apply);
    } else {
      apply();
    }
  };

  // 1. Register native directory watcher safely before initial scan
  if (Platform.OS === 'android') {
    try {
      const dir = new Directory(CANONICAL_DCIM_DIR_URI);
      if (dir.exists) {
        watcherSubscription = dir.watch(
          (event: WatchEvent<File | Directory>) => {
            if (!isSubscribed) return;
            const target = event.target;
            const isDirectory = target instanceof Directory || (target as any).isDirectory;
            const isSelfDir = isDirectory || target.uri === CANONICAL_DCIM_DIR_URI || !target.name;

            if (isSelfDir) {
              scheduleCoarseScan();
              return;
            }

            const filename = target.name || (target.uri ? target.uri.split('/').pop() : '');
            if (!filename || !isPhotoFile(filename)) {
              return;
            }

            const targetUri = ((target as any)?.uri as string) || '';
            const targetFile = target instanceof File ? target : new File(targetUri);

            switch (event.type) {
              case 'created':
              case 'modified':
                handleFileUpsert(targetFile);
                break;
              case 'deleted':
                handleFileDelete(filename, targetUri);
                break;
              case 'renamed': {
                handleFileDelete(filename, targetUri);
                if (event.newTarget) {
                  const newTargetUri = ((event.newTarget as any)?.uri as string) || '';
                  const newFilename =
                    event.newTarget.name || (newTargetUri ? newTargetUri.split('/').pop() : '');
                  if (newFilename && isPhotoFile(newFilename)) {
                    const newFile =
                      event.newTarget instanceof File ? event.newTarget : new File(newTargetUri);
                    handleFileUpsert(newFile);
                  }
                }
                break;
              }
            }
          },
          { debounce: 80 },
        );
      }
    } catch (err) {
      console.warn('[LocalPhotoService] Directory.watch() setup warning:', err);
    }

    // 2. Register native camera photo saved listener safely before initial scan
    try {
      photoSavedSub = addPhotoSavedListener(event => {
        if (!isSubscribed) return;
        console.log(`[LocalPhotoService] Camera photo saved event: ${event.filename}`);
        if (!isPhotoFile(event.filename)) return;

        const targetFile = new File(event.uri);
        handleFileUpsert(targetFile);
      });
    } catch (err) {
      console.warn('[LocalPhotoService] Failed to bind addPhotoSavedListener:', err);
    }
  }

  // 3. Start initial complete scan (shows permission dialog if needed)
  requestStoragePermission()
    .then(granted => {
      if (!isSubscribed) return;
      if (!granted) {
        isInitialScanInFlight = false;
        callbacks?.onError?.(
          new Error(`Storage permission denied for ${PHOTO_STORAGE_DISPLAY_PATH}`),
        );
        return;
      }

      return scanDcimEntephotoPhotos(false);
    })
    .then(scanned => {
      if (!isSubscribed || !scanned) return;
      isInitialScanInFlight = false;

      // Drain and apply any events that arrived while initial scan was executing
      while (pendingInitialScanEvents.length > 0) {
        const queuedAction = pendingInitialScanEvents.shift();
        try {
          queuedAction?.();
        } catch (e) {
          console.warn('[LocalPhotoService] Error applying queued initial scan event:', e);
        }
      }

      emitUpdatedPhotos();
    })
    .catch(err => {
      if (!isSubscribed) return;
      isInitialScanInFlight = false;
      console.error('[LocalPhotoService] Initial subscription scan error:', err);
      callbacks?.onError?.(err);
    });

  return () => {
    isSubscribed = false;
    isInitialScanInFlight = false;
    pendingInitialScanEvents.length = 0;
    if (emitDebounceTimer !== null) {
      clearTimeout(emitDebounceTimer);
      emitDebounceTimer = null;
    }
    if (coarseScanDebounceTimer !== null) {
      clearTimeout(coarseScanDebounceTimer);
      coarseScanDebounceTimer = null;
    }
    if (watcherSubscription) {
      try {
        watcherSubscription.remove();
      } catch {}
      watcherSubscription = null;
    }
    if (photoSavedSub) {
      try {
        photoSavedSub.remove();
      } catch {}
      photoSavedSub = null;
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
      const filename = file.name || fileUri.split('/').pop() || '';
      const photoId = `dcim-${filename}`;
      cachedPhotosMap.delete(photoId);
      cachedPhotosMap.delete(fileUri);
      return true;
    }
    console.warn(`[LocalPhotoService] File not found for deletion: ${fileUri}`);
    return false;
  } catch (error) {
    console.error(`[LocalPhotoService] Failed to delete file ${fileUri}:`, error);
    return false;
  }
}
