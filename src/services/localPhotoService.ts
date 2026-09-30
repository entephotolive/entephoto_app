import { Platform, PermissionsAndroid } from 'react-native';
import { Directory, File } from 'expo-file-system';
import { Album } from 'expo-media-library';
import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import { loadAllQualityResults } from './photoQualityPersistenceService';
import {
  PHOTO_STORAGE_DIR_URI,
  PHOTO_STORAGE_DISPLAY_PATH,
  PHOTO_ALBUM_NAME,
} from '@/config/photo.config';

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
 * Scans the configured photo storage directory dynamically using Expo SDK 57 Directory API.
 * Returns only real photos found on disk, or empty array with clear error logs.
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
    // 1. Try primary configured directory first
    let activeDirUri = CANONICAL_DCIM_DIR_URI;
    let dir = new Directory(activeDirUri);

    // Auto-create configured directory if it does not exist
    if (!dir.exists) {
      try {
        dir.create({ intermediates: true });
        console.log(`[LocalPhotoService] Created directory: ${activeDirUri}`);
      } catch {
        // Ignore if restricted
      }
    }

    let entries = dir.exists ? dir.list() : [];
    let photoEntries = entries.filter((entry): entry is File => {
      return entry instanceof File && isPhotoFile(entry.name);
    });

    // 2. Fallback: If configured directory has 0 photos, check common camera/download directories
    if (photoEntries.length === 0) {
      const fallbackUris = [
        activeDirUri.includes('Entephoto')
          ? activeDirUri.replace(/Entephoto$/i, 'EntePhoto')
          : 'file:///sdcard/DCIM/EntePhoto',
        'file:///sdcard/DCIM/Entephoto',
        'file:///sdcard/Download',
        'file:///sdcard/DCIM/Camera',
        'file:///sdcard/Pictures',
      ].filter(u => u.toLowerCase() !== activeDirUri.toLowerCase());

      for (const fallbackUri of fallbackUris) {
        try {
          const fbDir = new Directory(fallbackUri);
          if (fbDir.exists) {
            const fbEntries = fbDir.list();
            const fbPhotos = fbEntries.filter(
              (e): e is File => e instanceof File && isPhotoFile(e.name),
            );
            if (fbPhotos.length > 0) {
              console.log(
                `[LocalPhotoService] Found ${fbPhotos.length} photos in fallback directory: ${fallbackUri}`,
              );
              activeDirUri = fallbackUri;
              dir = fbDir;
              photoEntries = fbPhotos;
              break;
            }
          }
        } catch {
          // Continue to next candidate
        }
      }
    }

    if (photoEntries.length === 0) {
      if (!silent) {
        console.log(
          `[LocalPhotoService] No photos found in ${activeDirUri} or standard fallback directories.`,
        );
      }
      return [];
    }

    // Lookup existing MediaLibrary assets in the configured album if available
    const mediaAssetsByFilename = new Map<string, string>();
    try {
      const album = await Album.get(PHOTO_ALBUM_NAME);
      if (album) {
        const assets = await album.getAssets();
        for (const a of assets) {
          const fname = await a.getFilename();
          if (fname && a.id) {
            mediaAssetsByFilename.set(fname, a.id);
          }
        }
      }
    } catch {}

    // Eagerly hydrate existing quality results from persistence cache
    let qualityMap = new Map();
    try {
      qualityMap = await loadAllQualityResults();
    } catch {}

    let cacheHitCount = 0;
    const scannedPhotos: GalleryPhotoItem[] = photoEntries.map((file, index) => {
      const isRaw = isRawPhoto(file.name);
      const modTime = file.modificationTime;
      const timeFormatted = modTime
        ? new Date(modTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Just now';

      const realAssetId = mediaAssetsByFilename.get(file.name);
      const cachedQuality = qualityMap.get(file.name) || undefined;
      if (cachedQuality) {
        cacheHitCount++;
      }

      return {
        id: realAssetId || `dcim-${file.name}`,
        assetId: realAssetId,
        uri: file.uri,
        filename: file.name,
        isRaw,
        status: 'new',
        selected: false,
        timestamp: timeFormatted,
        // Real file modification time as epoch ms — used by photoBatchingService for time-gap gating.
        // Expo FileSystem Directory API returns modificationTime as seconds since epoch on Android.
        capturedAt: modTime
          ? typeof modTime === 'number' && modTime < 1e10
            ? modTime * 1000 // Expo returns seconds — convert to ms
            : modTime // Already ms
          : undefined,
        dimensions: undefined,
        aperture: undefined,
        iso: undefined,
        shutter: undefined,
        qualityResult: cachedQuality,
        pHash: cachedQuality?.pHash,
        isAnalyzingQuality: false,
      };
    });

    if (scannedPhotos.length > 0) {
      console.log(
        `[LocalPhotoService] Scanned ${scannedPhotos.length} photos: ${cacheHitCount} quality cache hits, ${scannedPhotos.length - cacheHitCount} need analysis.`,
      );
    }

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
 * Uses Directory.watch() and a periodic polling interval to guarantee instant updates.
 */
export function subscribeToDcimPhotos(
  onPhotosUpdated: (photos: GalleryPhotoItem[]) => void,
  pollIntervalMs: number = 2000,
): () => void {
  let isSubscribed = true;
  let watcherSubscription: { remove: () => void } | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmittedIds = new Set<string>();
  let isFirstEmit = true;

  const scanAndNotify = async (silent: boolean = true) => {
    if (!isSubscribed) return;
    try {
      const photos = await scanDcimEntephotoPhotos(silent);
      if (!isSubscribed) return;

      const newIds = new Set(photos.map(p => p.id));
      let hasChanged = newIds.size !== lastEmittedIds.size;
      if (!hasChanged) {
        for (const id of newIds) {
          if (!lastEmittedIds.has(id)) {
            hasChanged = true;
            break;
          }
        }
      }

      if (hasChanged || isFirstEmit) {
        isFirstEmit = false;
        lastEmittedIds = newIds;
        console.log(`[LocalPhotoService] Emitting ${photos.length} updated photos to gallery`);
        onPhotosUpdated(photos);
      }
    } catch (error) {
      console.error('[LocalPhotoService] Error during watch check:', error);
      if (isFirstEmit) {
        isFirstEmit = false;
        onPhotosUpdated([]);
      }
    }
  };

  const debouncedScanAndNotify = (silent: boolean = true) => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      if (isSubscribed) {
        scanAndNotify(silent);
      }
    }, 500);
  };

  const tryStartWatcher = (): boolean => {
    if (Platform.OS === 'android' && !watcherSubscription) {
      try {
        const dir = new Directory(CANONICAL_DCIM_DIR_URI);
        if (dir.exists) {
          watcherSubscription = dir.watch(() => {
            console.log(
              '[LocalPhotoService] Directory change event detected via Directory.watch()',
            );
            debouncedScanAndNotify(true);
          });
          console.log('[LocalPhotoService] Directory.watch() active; polling interval disabled.');
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
          return true;
        }
      } catch (err) {
        console.warn(
          '[LocalPhotoService] Directory.watch() not supported on target directory, falling back to interval:',
          err,
        );
      }
    }
    return false;
  };

  // 1. Initial request on subscription start
  requestStoragePermission().then(granted => {
    if (isSubscribed) {
      if (granted) {
        scanAndNotify(false);
        if (!watcherSubscription) {
          const started = tryStartWatcher();
          if (!started && intervalId === null) {
            intervalId = setInterval(() => debouncedScanAndNotify(true), pollIntervalMs);
          }
        }
      } else {
        // If permission denied, still emit empty array so the initial loading spinner clears!
        isFirstEmit = false;
        onPhotosUpdated([]);
      }
    }
  });

  // 2. Set up native directory watcher if directory exists
  const watcherActive = tryStartWatcher();

  // 3. Fallback polling ONLY if native watcher is not active
  if (!watcherActive) {
    intervalId = setInterval(() => debouncedScanAndNotify(true), pollIntervalMs);
  }

  return () => {
    isSubscribed = false;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcherSubscription) {
      try {
        watcherSubscription.remove();
      } catch {}
      watcherSubscription = null;
    }
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
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
