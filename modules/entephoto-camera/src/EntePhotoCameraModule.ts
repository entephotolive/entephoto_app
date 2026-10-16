import { NativeModule, requireNativeModule } from 'expo';

export type ConnectionState =
  | 'idle'
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'permission_required'
  | 'error';

export type PhotoSavedEvent = {
  uri: string;
  filename: string;
  mimeType: string;
};

/**
 * A single structured diagnostic record from the native camera pipeline.
 * Emitted via `onDiagnosticLog` and also available as a snapshot via `getDiagnosticLogs()`.
 */
export type DiagnosticRecord = {
  /** Monotonically increasing sequence number from process start. */
  sequenceId: number;
  /** Unix epoch time in milliseconds. */
  timestampMs: number;
  /** ISO-8601 formatted timestamp string (local time). */
  timestampIso: string;
  /** Severity level: DEBUG | INFO | WARN | ERROR */
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  /** The native component that generated this record. */
  component: string;
  /** Human-readable log message. */
  message: string;
  /** Java exception class simple name, if an exception was attached. */
  exceptionType: string | null;
  /** Exception message string. */
  exceptionMessage: string | null;
  /** Truncated stack trace (max 1200 chars). Only populated for errors. */
  stackTrace: string | null;
  /** PTP object handle (hex), if this record relates to a specific download. */
  objectHandle: number | null;
  /** Named pipeline stage label for filtering. */
  pipelineStage: string | null;
};

/**
 * Emitted when a photo transfer fails at any pipeline stage.
 * The camera connection is NOT lost when this fires — only individual downloads fail.
 */
export type PhotoTransferErrorEvent = {
  /** PTP object handle that failed (0 if unknown). */
  handle: number;
  /** Named pipeline stage where the failure occurred. */
  stage: string;
  /** Human-readable error description. */
  message: string;
  /** Optional native PTP/USB error code string. */
  errorCode: string;
  /** Whether the user could reasonably retry without disconnecting. */
  retryable: boolean;
  /** Unix epoch ms when the error was recorded. */
  timestamp: number;
};

/**
 * Emitted when a camera file is intentionally skipped (e.g., unsupported format like RAW/ARW).
 * The camera connection remains active and session is not affected.
 */
export type PhotoSkippedEvent = {
  /** Original filename on camera (e.g. "DSC00001.ARW"). */
  filename: string;
  /** File extension (e.g. "arw"). */
  extension: string;
  /** Reason description. */
  reason: string;
};

export type CameraEvents = {
  onDeviceFound: (event: { deviceName: string }) => void;
  onDeviceDisconnected: (event: { reason: string }) => void;
  onConnectionStateChanged: (event: { state: ConnectionState }) => void;
  /** Fired after a photo is fully saved to MediaStore / disk. */
  onPhotoSaved: (event: PhotoSavedEvent) => void;
  /**
   * Fired for every new native diagnostic record.
   * Subscribe to this event to drive the live in-app diagnostic console.
   * The full historical buffer is also available via `getDiagnosticLogs()`.
   */
  onDiagnosticLog: (event: DiagnosticRecord) => void;
  /**
   * Fired when a photo download or save fails.
   * Does not indicate that the camera session has ended.
   */
  onPhotoTransferError: (event: PhotoTransferErrorEvent) => void;
  /**
   * Fired when a photo is intentionally skipped (e.g. unsupported format).
   */
  onPhotoSkipped: (event: PhotoSkippedEvent) => void;
};

declare class EntePhotoCameraModule extends NativeModule<CameraEvents> {
  getStatus(): string;
  getConnectionState(): ConnectionState;
  startSearch(): void;
  /**
   * Reconciles native camera connection status when returning to foreground.
   */
  reconcileState(): void;
  /**
   * Stops USB device discovery only.
   * No-op if the camera is already in an active remote-shooting session.
   * Call {@link disconnect} for an explicit full teardown.
   */
  stopSearch(): void;
  /**
   * Unconditional full teardown — ends the Sony session, cancels the import
   * event loop, and releases USB resources regardless of connection state.
   */
  disconnect(): void;
  /**
   * Returns a snapshot of all buffered diagnostic records (up to 1000 entries).
   * Call this when the diagnostic console is first opened to show history.
   * Live updates arrive via the `onDiagnosticLog` event.
   */
  getDiagnosticLogs(): DiagnosticRecord[];
  /**
   * Clears the in-memory diagnostic buffer.
   * Does NOT disconnect the camera session.
   */
  clearDiagnosticLogs(): void;
  /**
   * Returns the entire diagnostic log as a single newline-delimited plain text string.
   * Use this to power a "Copy / Share Log" button in the diagnostic console.
   */
  getDiagnosticText(): string;
}

export default requireNativeModule<EntePhotoCameraModule>('EntePhotoCamera');
