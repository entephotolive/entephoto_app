import { Platform, Alert } from 'react-native';
import { Directory, File, type WatchEvent, type WatchSubscription } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { storageService } from '@/services/storageService';
import {
  addPhotoSavedListener,
  queryStoredPhotos,
  deleteStoredPhoto,
  checkFolderPhysicallyExists,
  tryDirectMkdirs,
  createSubdirectoryWithTreeUri,
} from 'entephoto-camera';
import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import { PHOTO_STORAGE_DIR_URI, PHOTO_STORAGE_DISPLAY_PATH } from '@/config/photo.config';
import { permissionCoordinator } from './permissionCoordinator';

const { StorageAccessFramework } = FileSystem;

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

/**
 * Ensures the canonical DCIM/Entephoto directory exists on the device.
 * Idempotent: checks existence before creating, safe to call repeatedly.
 * Returns true if the directory exists or was created successfully.
 */

export type FolderInitStatus = 'already_exists' | 'created' | 'permission_required' | 'failed';

export interface FolderInitResult {
  status: FolderInitStatus;
  apiLevel: number;
  method: 'direct_fs' | 'saf' | 'already_present' | 'none';
  folderPath: string;
  verifiedPhysical: boolean;
  safUri?: string;
  error?: string;
}

export function isDcimDirectorySafUri(uri: string): boolean {
  if (!uri) return false;
  try {
    const decoded = decodeURIComponent(uri);
    const m = decoded.match(/\/tree\/([^/]+)/);
    if (!m || !m[1]) return false;
    const documentId = m[1];
    const colonIdx = documentId.indexOf(':');
    if (colonIdx === -1) return false;
    const pathAfterColon = documentId.substring(colonIdx + 1).replace(/\/$/, '');
    return pathAfterColon.toUpperCase() === 'DCIM';
  } catch {
    return false;
  }
}

export function getSelectedFolderNameFromSafUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const m = decoded.match(/\/tree\/([^/]+)/);
    if (!m || !m[1]) return 'Unknown';
    const documentId = m[1];
    const colonIdx = documentId.indexOf(':');
    if (colonIdx === -1) return documentId;
    const pathAfterColon = documentId.substring(colonIdx + 1).replace(/\/$/, '');
    return pathAfterColon || 'Storage Root';
  } catch {
    return 'Unknown';
  }
}

let inFlightFolderInitPromise: Promise<FolderInitResult> | null = null;

/**
 * Initializes the physical DCIM/Entephoto directory on device storage.
 * Idempotent, safe on app startup and repeated foreground/resume events.
 */
export async function initializeEntePhotoFolder(options?: {
  interactive?: boolean;
  force?: boolean;
}): Promise<FolderInitResult> {
  const interactive = options?.interactive ?? false;
  const force = options?.force ?? false;

  if (inFlightFolderInitPromise && !force) {
    return inFlightFolderInitPromise;
  }

  inFlightFolderInitPromise = (async (): Promise<FolderInitResult> => {
    if (Platform.OS !== 'android') {
      return {
        status: 'already_exists',
        apiLevel: 0,
        method: 'already_present',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: true,
      };
    }

    const apiLevel =
      typeof Platform.Version === 'number'
        ? Platform.Version
        : parseInt(String(Platform.Version), 10) || 0;

    // 1. Check if the folder already physically exists on disk
    const alreadyPhysical = checkFolderPhysicallyExists();
    if (alreadyPhysical) {
      console.log(
        `[LocalPhotoService] Verified physical folder already exists at ${PHOTO_STORAGE_DISPLAY_PATH} (API ${apiLevel})`,
      );
      return {
        status: 'already_exists',
        apiLevel,
        method: 'already_present',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: true,
      };
    }

    // 2. Try direct filesystem creation first
    const directResult = tryDirectMkdirs();
    if (directResult === 'already_exists') {
      return {
        status: 'already_exists',
        apiLevel,
        method: 'already_present',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: true,
      };
    }

    if (directResult === 'created') {
      const verified = checkFolderPhysicallyExists();
      if (verified) {
        console.log(
          `[LocalPhotoService] Successfully created physical folder via direct mkdirs: ${PHOTO_STORAGE_DISPLAY_PATH} (API ${apiLevel})`,
        );
        return {
          status: 'created',
          apiLevel,
          method: 'direct_fs',
          folderPath: PHOTO_STORAGE_DISPLAY_PATH,
          verifiedPhysical: true,
        };
      }
    }

    // 3. For Android 9 and below (API <= 28): check permissions if direct mkdir failed
    if (apiLevel <= 28) {
      const hasPerm = interactive
        ? await requestStoragePermission()
        : await checkStoragePermission();
      if (!hasPerm) {
        return {
          status: 'permission_required',
          apiLevel,
          method: 'none',
          folderPath: PHOTO_STORAGE_DISPLAY_PATH,
          verifiedPhysical: false,
          error: 'Storage permission required on Android <= 28',
        };
      }
      const retryDirect = tryDirectMkdirs();
      const verified = checkFolderPhysicallyExists();
      if (retryDirect === 'created' || verified) {
        return {
          status: 'created',
          apiLevel,
          method: 'direct_fs',
          folderPath: PHOTO_STORAGE_DISPLAY_PATH,
          verifiedPhysical: true,
        };
      }
      return {
        status: 'failed',
        apiLevel,
        method: 'direct_fs',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: false,
        error: 'Failed to create directory on legacy external storage',
      };
    }

    // 4. Android 10+ (API 29+ / API 34): Use Storage Access Framework (SAF)
    // Check if we already have an existing persisted DCIM SAF URI in secure storage
    const savedSafUri = await storageService.getPersistedDcimSafUri();
    if (savedSafUri && isDcimDirectorySafUri(savedSafUri)) {
      try {
        console.log(
          `[LocalPhotoService] Attempting folder creation via persisted SAF URI (API ${apiLevel})`,
        );
        let safRes = createSubdirectoryWithTreeUri(savedSafUri, 'Entephoto');
        if (!safRes.success) {
          const existingFiles = await StorageAccessFramework.readDirectoryAsync(savedSafUri);
          const hasEntephoto = existingFiles.some(f => {
            const dec = decodeURIComponent(f).toLowerCase();
            return (
              dec.endsWith('/entephoto') ||
              dec.includes('dcim%2fentephoto') ||
              dec.includes('dcim/entephoto')
            );
          });
          if (!hasEntephoto) {
            await StorageAccessFramework.makeDirectoryAsync(savedSafUri, 'Entephoto');
          }
          safRes = { success: true, alreadyExists: hasEntephoto };
        }

        const verified = checkFolderPhysicallyExists();
        console.log(
          `[LocalPhotoService] Persisted SAF result: success=${safRes.success}, verifiedPhysical=${verified}`,
        );
        return {
          status: safRes.alreadyExists ? 'already_exists' : 'created',
          apiLevel,
          method: 'saf',
          folderPath: PHOTO_STORAGE_DISPLAY_PATH,
          verifiedPhysical: verified,
          safUri: savedSafUri,
        };
      } catch (err: any) {
        console.warn(
          `[LocalPhotoService] Persisted SAF URI was invalid or revoked. Clearing it. Error:`,
          err?.message || err,
        );
        await storageService.removePersistedDcimSafUri();
      }
    }

    // 5. No valid persisted SAF URI exists.
    if (!interactive) {
      console.log(
        `[LocalPhotoService] One-time SAF directory setup required for ${PHOTO_STORAGE_DISPLAY_PATH} (API ${apiLevel})`,
      );
      return {
        status: 'permission_required',
        apiLevel,
        method: 'none',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: false,
        error: 'One-time DCIM directory permission required',
      };
    }

    // 6. Interactive SAF directory setup flow
    try {
      console.log(`[LocalPhotoService] Launching SAF directory picker for DCIM (API ${apiLevel})`);
      const initialUri = StorageAccessFramework.getUriForDirectoryInRoot('DCIM');
      const permResult = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);

      if (!permResult.granted || !permResult.directoryUri) {
        console.log('[LocalPhotoService] User cancelled directory picker');
        return {
          status: 'permission_required',
          apiLevel,
          method: 'none',
          folderPath: PHOTO_STORAGE_DISPLAY_PATH,
          verifiedPhysical: false,
          error: 'User cancelled folder selection',
        };
      }

      // Validate that user selected the DCIM folder
      if (!isDcimDirectorySafUri(permResult.directoryUri)) {
        const selectedName = getSelectedFolderNameFromSafUri(permResult.directoryUri);
        console.warn(
          `[LocalPhotoService] User selected wrong directory: "${selectedName}" (expected DCIM)`,
        );
        Alert.alert(
          'Incorrect Folder Selected',
          `Please select the "DCIM" folder. You selected: "${selectedName}".`,
          [{ text: 'OK' }],
        );
        return {
          status: 'failed',
          apiLevel,
          method: 'saf',
          folderPath: PHOTO_STORAGE_DISPLAY_PATH,
          verifiedPhysical: false,
          error: `Selected "${selectedName}" instead of "DCIM"`,
        };
      }

      // Save validated DCIM SAF URI
      await storageService.setPersistedDcimSafUri(permResult.directoryUri);

      // Create child directory Entephoto
      let safRes = createSubdirectoryWithTreeUri(permResult.directoryUri, 'Entephoto');
      if (!safRes.success) {
        try {
          const existingFiles = await StorageAccessFramework.readDirectoryAsync(
            permResult.directoryUri,
          );
          const hasEntephoto = existingFiles.some(f => {
            const dec = decodeURIComponent(f).toLowerCase();
            return (
              dec.endsWith('/entephoto') ||
              dec.includes('dcim%2fentephoto') ||
              dec.includes('dcim/entephoto')
            );
          });
          if (!hasEntephoto) {
            await StorageAccessFramework.makeDirectoryAsync(permResult.directoryUri, 'Entephoto');
          }
          safRes = { success: true, alreadyExists: hasEntephoto };
        } catch (e: any) {
          safRes = { success: false, alreadyExists: false, error: e?.message || String(e) };
        }
      }

      const verified = checkFolderPhysicallyExists();
      console.log(
        `[LocalPhotoService] Initial SAF setup complete: status=${
          safRes.alreadyExists ? 'already_exists' : 'created'
        }, verifiedPhysical=${verified}`,
      );

      return {
        status: safRes.alreadyExists ? 'already_exists' : 'created',
        apiLevel,
        method: 'saf',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: verified,
        safUri: permResult.directoryUri,
      };
    } catch (safErr: any) {
      console.error('[LocalPhotoService] SAF directory picker error:', safErr);
      return {
        status: 'failed',
        apiLevel,
        method: 'saf',
        folderPath: PHOTO_STORAGE_DISPLAY_PATH,
        verifiedPhysical: false,
        error: safErr?.message || 'Failed during SAF directory setup',
      };
    }
  })();

  try {
    return await inFlightFolderInitPromise;
  } finally {
    inFlightFolderInitPromise = null;
  }
}

/**
 * Backward-compatible helper that delegates to initializeEntePhotoFolder.
 * Returns true if the directory exists or was created successfully.
 */
export async function ensurePhotoDirectoryExists(silent: boolean = false): Promise<boolean> {
  const result = await initializeEntePhotoFolder({ interactive: !silent });
  return result.status === 'already_exists' || result.status === 'created';
}

export function resetDirectoryInitPromise(): void {
  inFlightFolderInitPromise = null;
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
  const status = await permissionCoordinator.checkPhotoPermission();
  return status === 'granted' || status === 'limited';
}

/**
 * Requests the correct Android storage permission based on API level
 * - Android 13+ (API 33+): READ_MEDIA_IMAGES
 * - Android 12 and below (API <= 32): READ_EXTERNAL_STORAGE
 */
async function requestStoragePermission(): Promise<boolean> {
  const status = await permissionCoordinator.requestPhotoPermission();
  return status === 'granted' || status === 'limited';
}

// ── Shared Photo Scan State & Concurrency Control ────────────────────────────
let activeScanCount = 0;
let currentScanSequenceId = 0;
const scanListeners = new Set<(isScanning: boolean) => void>();
let inFlightScanPromise: Promise<GalleryPhotoItem[]> | null = null;
const cachedPhotosMap = new Map<string, GalleryPhotoItem>();

// ── Scan Progress (Filename) Listeners ────────────────────────────────────────
const scanProgressListeners = new Set<(filename: string) => void>();

/**
 * Subscribes to per-file scan progress events during an initial directory scan.
 * The listener receives the filename (not the full path) of the file currently
 * being processed. Updates are throttled to ~120 ms at the emission site.
 * Returns an unsubscribe callback.
 */
export function addScanProgressListener(listener: (filename: string) => void): () => void {
  scanProgressListeners.add(listener);
  return () => {
    scanProgressListeners.delete(listener);
  };
}

function notifyScanProgressListeners(filename: string): void {
  scanProgressListeners.forEach(listener => {
    try {
      listener(filename);
    } catch {
      // Never let a progress listener crash the scan
    }
  });
}

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
      // 1. Check storage permission without creating the directory
      const hasPermission = await checkStoragePermission();
      if (!hasPermission) {
        if (!silent) {
          console.warn(
            `[LocalPhotoService] Storage permission denied. Cannot scan ${PHOTO_STORAGE_DISPLAY_PATH} directory.`,
          );
        }
        throw new Error(`Storage permission denied for ${PHOTO_STORAGE_DISPLAY_PATH}`);
      }

      const scannedPhotos: GalleryPhotoItem[] = [];

      // 2. Query stored photos via native MediaStore bridge (Android 10+ and indexed MediaStore)
      try {
        const storedPhotos = await queryStoredPhotos(PHOTO_STORAGE_DISPLAY_PATH);
        if (storedPhotos && storedPhotos.length > 0) {
          for (let i = 0; i < storedPhotos.length; i++) {
            const sp = storedPhotos[i];
            const capturedAt = sp.capturedAt || Date.now();
            const item: GalleryPhotoItem = {
              id: `dcim-${sp.filename}`,
              assetId: sp.id,
              uri: sp.uri,
              filename: sp.filename,
              isRaw: isRawPhoto(sp.filename),
              status: 'new',
              selected: false,
              timestamp: formatTime(capturedAt),
              capturedAt,
              dimensions: undefined,
              aperture: undefined,
              shutter: undefined,
            };
            scannedPhotos.push(item);
          }
        }
      } catch (mediaStoreErr) {
        console.warn(
          '[LocalPhotoService] MediaStore query failed, falling back to directory check:',
          mediaStoreErr,
        );
      }

      // If MediaStore returned items, finalize and return
      if (scannedPhotos.length > 0) {
        if (!silent) {
          console.log(
            `[LocalPhotoService] MediaStore scan completed: ${scannedPhotos.length} photos (seq #${sequenceId}).`,
          );
        }
        sortPhotosChronological(scannedPhotos);
        (scannedPhotos as any).scanSequenceId = sequenceId;

        cachedPhotosMap.clear();
        for (const p of scannedPhotos) {
          cachedPhotosMap.set(p.id, p);
          if (p.uri) {
            cachedPhotosMap.set(p.uri, p);
          }
        }
        return scannedPhotos;
      }

      // 3. Fallback for legacy Android 9 or direct filesystem files
      const dir = new Directory(CANONICAL_DCIM_DIR_URI);
      if (!dir.exists) {
        if (!silent) {
          console.log(
            `[LocalPhotoService] Directory ${PHOTO_STORAGE_DISPLAY_PATH} does not exist yet. Returning empty gallery.`,
          );
        }
        return [];
      }

      const entries = dir.list();
      const photoEntries: File[] = [];

      for (const entry of entries) {
        if (entry instanceof File && isPhotoFile(entry.name)) {
          photoEntries.push(entry);
        }
      }

      // Yield after synchronous directory listing so UI can paint before per-file metadata extraction
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      let lastProgressEmitMs = 0;
      for (let i = 0; i < photoEntries.length; i++) {
        const file = photoEntries[i];
        // Emit filename progress at most every 120 ms to avoid flooding the JS thread
        if (!silent && scanProgressListeners.size > 0) {
          const now = Date.now();
          if (now - lastProgressEmitMs >= 120) {
            lastProgressEmitMs = now;
            notifyScanProgressListeners(file.name);
          }
        }
        const item = buildPhotoItemFromFile(file);
        if (item) {
          scannedPhotos.push(item);
        }

        // Periodically yield to event loop every 12 items so native animation frames,
        // gesture handling, and UI updates run smoothly without JS-thread blocking.
        if (i > 0 && i % 12 === 0) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
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

        const now = Date.now();
        const photoItem: GalleryPhotoItem = {
          id: `dcim-${event.filename}`,
          assetId: undefined,
          uri: event.uri,
          filename: event.filename,
          isRaw: isRawPhoto(event.filename),
          status: 'new',
          selected: false,
          timestamp: formatTime(now),
          capturedAt: now,
          dimensions: undefined,
          aperture: undefined,
          shutter: undefined,
        };

        const apply = () => {
          cachedPhotosMap.set(photoItem.id, photoItem);
          cachedPhotosMap.set(photoItem.uri, photoItem);
          scheduleEmit();
        };

        if (isInitialScanInFlight) {
          pendingInitialScanEvents.push(apply);
        } else {
          apply();
        }
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
    const filename = fileUri.split('/').pop() || '';
    const photoId = `dcim-${filename}`;

    if (Platform.OS === 'android') {
      const deleted = await deleteStoredPhoto(fileUri);
      if (deleted) {
        console.log(`[LocalPhotoService] Successfully deleted via native MediaStore: ${fileUri}`);
        cachedPhotosMap.delete(photoId);
        cachedPhotosMap.delete(fileUri);
        return true;
      }
    }

    const file = new File(fileUri);
    if (file.exists) {
      file.delete();
      console.log(`[LocalPhotoService] Successfully deleted file: ${fileUri}`);
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
