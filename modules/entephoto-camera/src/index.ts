import EntePhotoCameraModule, {
  ConnectionState,
  CameraEvents,
  PhotoSavedEvent,
  DiagnosticRecord,
  PhotoTransferErrorEvent,
  PhotoSkippedEvent,
} from './EntePhotoCameraModule';
import { EventSubscription } from 'expo-modules-core';

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

export {
  ConnectionState,
  CameraEvents,
  PhotoSavedEvent,
  DiagnosticRecord,
  PhotoTransferErrorEvent,
  PhotoSkippedEvent,
};

export default EntePhotoCameraModule;
