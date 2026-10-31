import EntePhotoCameraModule, {
  ConnectionState,
  CameraEvents,
  PhotoSavedEvent,
  DiagnosticRecord,
  PhotoTransferErrorEvent,
  PhotoSkippedEvent,
  StoredPhotoResult,
  StorageReadyResult,
  SubdirectorySafResult,
  DirectMkdirResult,
} from './EntePhotoCameraModule';
import { EventSubscription } from 'expo-modules-core';
import { Platform, PermissionsAndroid } from 'react-native';

export function getStatus(): string {
  return EntePhotoCameraModule.getStatus();
}

export function getConnectionState(): ConnectionState {
  return EntePhotoCameraModule.getConnectionState();
}

export function startSearch(): void {
  EntePhotoCameraModule.startSearch();
}

export function reconcileState(): void {
  EntePhotoCameraModule.reconcileState();
}

export function stopSearch(): void {
  EntePhotoCameraModule.stopSearch();
}

/**
 * Unconditional full teardown — ends the Sony session, cancels the import
 * event loop, and releases USB resources regardless of connection state.
 */
export function disconnect(): void {
  EntePhotoCameraModule.disconnect();
}

// ── Event subscriptions ────────────────────────────────────────────────────

export function addConnectionStateListener(
  listener: (event: { state: ConnectionState }) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onConnectionStateChanged', listener);
}

export function addDeviceFoundListener(
  listener: (event: { deviceName: string }) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onDeviceFound', listener);
}

export function addDeviceDisconnectedListener(
  listener: (event: { reason: string }) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onDeviceDisconnected', listener);
}

/**
 * Subscribe to photo-save completions.
 * Fired once per successfully downloaded and MediaStore-saved photo.
 */
export function addPhotoSavedListener(
  listener: (event: PhotoSavedEvent) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onPhotoSaved', listener);
}

/**
 * Subscribe to live diagnostic log records from the native camera pipeline.
 * Each record arrives in real-time as it is appended to the internal buffer.
 * For the full history on console open, call `getDiagnosticLogs()` first.
 */
export function addDiagnosticLogListener(
  listener: (event: DiagnosticRecord) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onDiagnosticLog', listener);
}

/**
 * Subscribe to per-photo transfer failures.
 * Fires when a download or MediaStore write fails for a specific PTP handle.
 * The camera session remains active — this is not a connection-loss event.
 */
export function addPhotoTransferErrorListener(
  listener: (event: PhotoTransferErrorEvent) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onPhotoTransferError', listener);
}

/**
 * Subscribe to photo skipped events (e.g. unsupported format like RAW/ARW).
 * The camera session remains active — this is an intentional skip, not a failure.
 */
export function addPhotoSkippedListener(
  listener: (event: PhotoSkippedEvent) => void,
): EventSubscription {
  return EntePhotoCameraModule.addListener('onPhotoSkipped', listener);
}

// ── Storage and MediaStore APIs ────────────────────────────────────────────

export function checkFolderPhysicallyExists(): boolean {
  return EntePhotoCameraModule?.checkFolderPhysicallyExists?.() ?? false;
}

export function tryDirectMkdirs(): 'already_exists' | 'created' | 'failed' {
  return EntePhotoCameraModule?.tryDirectMkdirs?.() ?? 'failed';
}

export function createSubdirectoryWithTreeUri(
  treeUriString: string,
  subDirName: string,
): SubdirectorySafResult {
  return (
    EntePhotoCameraModule?.createSubdirectoryWithTreeUri?.(treeUriString, subDirName) ?? {
      success: false,
      alreadyExists: false,
      error: 'Module unavailable',
    }
  );
}

export function getPersistedUriPermissions(): string[] {
  return EntePhotoCameraModule?.getPersistedUriPermissions?.() ?? [];
}

export function releasePersistedUriPermission(uriString: string): boolean {
  return EntePhotoCameraModule?.releasePersistedUriPermission?.(uriString) ?? false;
}

export async function ensureStorageReady(): Promise<StorageReadyResult> {
  return (
    EntePhotoCameraModule?.ensureStorageReady?.() ?? {
      ready: true,
      apiLevel: Platform.OS === 'android' ? (Platform.Version as number) : 0,
      isScopedStorage: Platform.OS === 'android' && (Platform.Version as number) >= 29,
      targetPath: 'DCIM/Entephoto/',
    }
  );
}

export async function queryStoredPhotos(relativeDir?: string | null): Promise<StoredPhotoResult[]> {
  return EntePhotoCameraModule?.queryStoredPhotos?.(relativeDir ?? null) ?? [];
}

export function purgeDownloadedRecord(filename: string): boolean {
  return EntePhotoCameraModule?.purgeDownloadedRecord?.(filename) ?? false;
}

export async function deleteStoredPhoto(uriString: string): Promise<boolean> {
  return EntePhotoCameraModule?.deleteStoredPhoto?.(uriString) ?? false;
}

// ── Diagnostic log APIs ────────────────────────────────────────────────────

/**
 * Returns a snapshot of all buffered diagnostic records (up to 1000).
 * Call once when the diagnostic console is first opened; then subscribe to
 * `onDiagnosticLog` for live updates.
 */
export function getDiagnosticLogs(): DiagnosticRecord[] {
  return EntePhotoCameraModule.getDiagnosticLogs();
}

/**
 * Clears the in-memory diagnostic buffer.
 * Does NOT disconnect the camera session or reset connection state.
 */
export function clearDiagnosticLogs(): void {
  EntePhotoCameraModule.clearDiagnosticLogs();
}

/**
 * Returns the entire diagnostic log as a single newline-delimited plain text string.
 * Use to power a "Copy Log" or "Share Log" button.
 */
export function getDiagnosticText(): string {
  return EntePhotoCameraModule.getDiagnosticText();
}

// ── Notification APIs ──────────────────────────────────────────────────────

export function hasNotificationPermission(): boolean {
  return EntePhotoCameraModule?.hasNotificationPermission?.() ?? false;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 33) return hasNotificationPermission();

  try {
    const perm =
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ||
      ('android.permission.POST_NOTIFICATIONS' as any);
    const granted = await PermissionsAndroid.request(perm);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn('[EntePhotoCamera] Failed to request notification permission:', err);
    return false;
  }
}

export function showCameraSearching(): void {
  EntePhotoCameraModule?.showCameraSearching?.();
}

export function showCameraConnected(cameraName?: string | null): void {
  EntePhotoCameraModule?.showCameraConnected?.(cameraName ?? null);
}

export function dismissCamera(): void {
  EntePhotoCameraModule?.dismissCamera?.();
}

export function dismissCameraNotification(): void {
  EntePhotoCameraModule?.dismissCameraNotification?.();
}

export function startUploadService(
  current: number,
  total: number,
  percentage?: number | null,
): void {
  EntePhotoCameraModule?.startUploadService?.(
    Math.max(1, current),
    Math.max(0, total),
    percentage ?? null,
  );
}

export function updateUploadProgress(
  current: number,
  total: number,
  percentage?: number | null,
): void {
  EntePhotoCameraModule?.updateUploadProgress?.(
    Math.max(1, current),
    Math.max(0, total),
    percentage ?? null,
  );
}

export function stopUploadService(): void {
  EntePhotoCameraModule?.stopUploadService?.();
}

export function showUploadComplete(count: number): void {
  EntePhotoCameraModule?.showUploadComplete?.(Math.max(0, count));
}

export function showUploadCancelled(uploadedCount: number, total: number): void {
  EntePhotoCameraModule?.showUploadCancelled?.(Math.max(0, uploadedCount), Math.max(0, total));
}

export function showUploadFailed(message: string, successCount: number, total: number): void {
  EntePhotoCameraModule?.showUploadFailed?.(
    message || 'Upload failed',
    Math.max(0, successCount),
    Math.max(0, total),
  );
}

export function dismissUpload(): void {
  EntePhotoCameraModule?.dismissUpload?.();
}

export function dismissUploadNotification(): void {
  EntePhotoCameraModule?.dismissUploadNotification?.();
}

export {
  ConnectionState,
  CameraEvents,
  PhotoSavedEvent,
  DiagnosticRecord,
  PhotoTransferErrorEvent,
  PhotoSkippedEvent,
  StoredPhotoResult,
  StorageReadyResult,
  SubdirectorySafResult,
  DirectMkdirResult,
};

export default EntePhotoCameraModule;
