import { Platform } from 'react-native';
import {
  hasNotificationPermission as nativeHasPermission,
  requestNotificationPermission as nativeRequestPermission,
  showCameraSearching as nativeShowCameraSearching,
  showCameraConnected as nativeShowCameraConnected,
  dismissCamera as nativeDismissCamera,
  startUploadService as nativeStartUploadService,
  updateUploadProgress as nativeUpdateUploadProgress,
  stopUploadService as nativeStopUploadService,
  showUploadComplete as nativeShowUploadComplete,
  showUploadCancelled as nativeShowUploadCancelled,
  showUploadFailed as nativeShowUploadFailed,
  dismissUpload as nativeDismissUpload,
} from 'entephoto-camera';

type CameraNotificationState = 'idle' | 'searching' | 'connected';

class NotificationService {
  private cameraState: CameraNotificationState = 'idle';
  private currentCameraModel: string | null = null;
  private hasRequestedInSession: boolean = false;
  private uploadActive: boolean = false;

  /**
   * Checks whether notification permissions are granted on the current device.
   */
  hasPermission(): boolean {
    if (Platform.OS !== 'android') return true;
    try {
      return nativeHasPermission();
    } catch (err) {
      console.warn('[NotificationService] hasPermission check failed:', err);
      return false;
    }
  }

  /**
   * Requests Android 13+ runtime notification permission once per session.
   * If already granted or previously requested in this session, avoids prompting again.
   */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (this.hasPermission()) return true;

    try {
      this.hasRequestedInSession = true;
      const granted = await nativeRequestPermission();
      return granted;
    } catch (err) {
      console.warn('[NotificationService] requestPermission failed:', err);
      return false;
    }
  }

  /**
   * Prompt for permission at an appropriate user interaction point (e.g. starting search).
   * Will not repeatedly prompt if already asked in the current session.
   */
  async ensurePermission(): Promise<boolean> {
    if (this.hasPermission()) return true;
    if (this.hasRequestedInSession) return false;
    return this.requestPermission();
  }

  // ── Camera Notifications ──────────────────────────────────────────────────

  /**
   * Shows the ongoing "Searching for Camera" notification.
   * Idempotent: repeated calls while already searching do not re-post or flicker.
   */
  showCameraSearching(): void {
    if (Platform.OS !== 'android') return;
    if (this.cameraState === 'searching') return;

    try {
      this.cameraState = 'searching';
      this.currentCameraModel = null;
      nativeShowCameraSearching();
    } catch (err) {
      console.warn('[NotificationService] showCameraSearching error:', err);
    }
  }

  /**
   * Shows the ongoing "Camera Connected" notification, including model name when known.
   * Idempotent: repeated calls with identical model do not re-post or flicker.
   */
  showCameraConnected(cameraModel?: string | null): void {
    if (Platform.OS !== 'android') return;
    const model = cameraModel?.trim() || null;
    if (this.cameraState === 'connected' && this.currentCameraModel === model) {
      return;
    }

    try {
      this.cameraState = 'connected';
      this.currentCameraModel = model;
      nativeShowCameraConnected(model);
    } catch (err) {
      console.warn('[NotificationService] showCameraConnected error:', err);
    }
  }

  /**
   * Dismisses the camera notification (searching or connected).
   * Idempotent: no-op if already dismissed.
   */
  dismissCamera(): void {
    if (Platform.OS !== 'android') return;
    if (this.cameraState === 'idle') return;

    try {
      this.cameraState = 'idle';
      this.currentCameraModel = null;
      nativeDismissCamera();
    } catch (err) {
      console.warn('[NotificationService] dismissCamera error:', err);
    }
  }

  // ── Upload Foreground Service & Notifications ──────────────────────────────

  /**
   * Starts the upload foreground service with ongoing progress notification.
   */
  startUploadProgress(current: number, total: number, bytePercentage?: number | null): void {
    if (Platform.OS !== 'android') return;
    try {
      this.uploadActive = true;
      nativeStartUploadService(current, total, bytePercentage ?? null);
    } catch (err) {
      console.warn('[NotificationService] startUploadProgress error:', err);
    }
  }

  /**
   * Updates upload progress in the ongoing foreground notification.
   */
  updateUploadProgress(current: number, total: number, bytePercentage?: number | null): void {
    if (Platform.OS !== 'android') return;
    try {
      nativeUpdateUploadProgress(current, total, bytePercentage ?? null);
    } catch (err) {
      console.warn('[NotificationService] updateUploadProgress error:', err);
    }
  }

  /**
   * Stops the upload foreground service and removes the ongoing notification.
   */
  stopUploadProgress(): void {
    if (Platform.OS !== 'android') return;
    try {
      this.uploadActive = false;
      nativeStopUploadService();
    } catch (err) {
      console.warn('[NotificationService] stopUploadProgress error:', err);
    }
  }

  /**
   * Shows a completed notification for finished upload batches.
   */
  showUploadComplete(count: number): void {
    if (Platform.OS !== 'android') return;
    try {
      this.stopUploadProgress();
      nativeShowUploadComplete(count);
    } catch (err) {
      console.warn('[NotificationService] showUploadComplete error:', err);
    }
  }

  /**
   * Shows an upload cancelled notification.
   */
  showUploadCancelled(uploadedCount: number, total: number): void {
    if (Platform.OS !== 'android') return;
    try {
      this.stopUploadProgress();
      nativeShowUploadCancelled(uploadedCount, total);
    } catch (err) {
      console.warn('[NotificationService] showUploadCancelled error:', err);
    }
  }

  /**
   * Shows an upload failed notification with descriptive error text.
   */
  showUploadFailed(message: string, successCount: number, total: number): void {
    if (Platform.OS !== 'android') return;
    try {
      this.stopUploadProgress();
      nativeShowUploadFailed(message, successCount, total);
    } catch (err) {
      console.warn('[NotificationService] showUploadFailed error:', err);
    }
  }

  /**
   * Explicitly dismisses all upload-related notifications.
   */
  dismissUpload(): void {
    if (Platform.OS !== 'android') return;
    try {
      this.uploadActive = false;
      nativeDismissUpload();
    } catch (err) {
      console.warn('[NotificationService] dismissUpload error:', err);
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
