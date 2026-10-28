// src/services/permissionCoordinator.ts
import { Platform, PermissionsAndroid, Linking } from 'react-native';
import { notificationService } from './notifications/notificationService';
import { PHOTO_STORAGE_DISPLAY_PATH } from '@/config/photo.config';

export type PermissionStatus = 'granted' | 'limited' | 'denied' | 'blocked' | 'undetermined';

export interface AppPermissionsStatus {
  photo: PermissionStatus;
  notification: PermissionStatus;
  canProceed: boolean; // True if photo access is either fully granted or limited (user-selected)
  isPhotoGranted: boolean; // True only if fully granted
  isPhotoLimited: boolean; // True if Android 14+ partial/visual user selected
  isNotificationGranted: boolean;
}

// Android 14+ (API 34) Granular Visual Media Permission
const PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED =
  (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_VISUAL_USER_SELECTED ||
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED';

class PermissionCoordinator {
  private hasCheckedInSession = false;
  private inFlightRequestPromise: Promise<AppPermissionsStatus> | null = null;
  private lastKnownStatus: AppPermissionsStatus = {
    photo: 'undetermined',
    notification: 'undetermined',
    canProceed: false,
    isPhotoGranted: false,
    isPhotoLimited: false,
    isNotificationGranted: false,
  };

  /**
   * Returns numeric Android API level, or 0 on non-Android platforms.
   */
  getApiLevel(): number {
    if (Platform.OS !== 'android') return 0;
    return typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10) || 0;
  }

  /**
   * Resets the session deduplication guard.
   * Useful when user manually returns from App Settings or presses "Try Again".
   */
  resetSessionGuard(): void {
    this.hasCheckedInSession = false;
  }

  /**
   * Opens the device system settings for this application.
   */
  async openAppSettings(): Promise<void> {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn('[PermissionCoordinator] Failed to open app settings:', err);
    }
  }

  /**
   * Checks current photo permission without prompting the user.
   */
  async checkPhotoPermission(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    const apiLevel = this.getApiLevel();

    try {
      if (apiLevel >= 34) {
        // Android 14+: Check full access first
        const hasFull = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        );
        if (hasFull) return 'granted';

        // Check partial visual access
        const hasPartial = await PermissionsAndroid.check(
          PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED,
        );
        if (hasPartial) return 'limited';

        return 'denied';
      }

      if (apiLevel === 33) {
        // Android 13: READ_MEDIA_IMAGES only
        const hasImages = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        );
        return hasImages ? 'granted' : 'denied';
      }

      if (apiLevel >= 29) {
        // Android 10–12: READ_EXTERNAL_STORAGE
        const hasRead = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        );
        return hasRead ? 'granted' : 'denied';
      }

      // Android 9 and below: Check both READ and WRITE
      const hasRead = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      );
      const hasWrite = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      );
      return hasRead && hasWrite ? 'granted' : 'denied';
    } catch (err) {
      console.error('[PermissionCoordinator] Error checking photo permission:', err);
      return 'denied';
    }
  }

  /**
   * Checks current notification permission without prompting the user.
   */
  async checkNotificationPermission(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    try {
      const isGranted = notificationService.hasPermission();
      return isGranted ? 'granted' : 'denied';
    } catch (err) {
      console.warn('[PermissionCoordinator] Error checking notification permission:', err);
      return 'denied';
    }
  }

  /**
   * Returns a complete snapshot of permissions without prompting.
   */
  async checkAllPermissions(): Promise<AppPermissionsStatus> {
    const [photo, notification] = await Promise.all([
      this.checkPhotoPermission(),
      this.checkNotificationPermission(),
    ]);

    const isPhotoGranted = photo === 'granted';
    const isPhotoLimited = photo === 'limited';
    const isNotificationGranted = notification === 'granted';

    this.lastKnownStatus = {
      photo,
      notification,
      canProceed: isPhotoGranted || isPhotoLimited,
      isPhotoGranted,
      isPhotoLimited,
      isNotificationGranted,
    };

    return this.lastKnownStatus;
  }

  /**
   * Requests applicable photo permissions based on Android version.
   * Version-aware:
   * - API 34+: Requests READ_MEDIA_IMAGES & READ_MEDIA_VISUAL_USER_SELECTED
   * - API 33: Requests READ_MEDIA_IMAGES
   * - API 29–32: Requests READ_EXTERNAL_STORAGE
   * - API <= 28: Requests READ_EXTERNAL_STORAGE & WRITE_EXTERNAL_STORAGE
   */
  async requestPhotoPermission(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    const current = await this.checkPhotoPermission();
    if (current === 'granted') {
      return 'granted';
    }

    const apiLevel = this.getApiLevel();

    try {
      if (apiLevel >= 34) {
        console.log('[PermissionCoordinator] Requesting Android 14+ granular media permissions');
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED,
        ]);

        const fullResult = results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES];
        const partialResult = (results as Record<string, string>)[
          PERMISSION_READ_MEDIA_VISUAL_USER_SELECTED
        ];

        if (fullResult === PermissionsAndroid.RESULTS.GRANTED) {
          return 'granted';
        }
        if (partialResult === PermissionsAndroid.RESULTS.GRANTED) {
          return 'limited';
        }
        if (
          fullResult === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
          partialResult === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        ) {
          return 'blocked';
        }
        return 'denied';
      }

      if (apiLevel === 33) {
        console.log('[PermissionCoordinator] Requesting Android 13 READ_MEDIA_IMAGES');
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          {
            title: 'EntePhoto Storage Access',
            message: `EntePhoto requires photo access to view and sync photos from your ${PHOTO_STORAGE_DISPLAY_PATH} folder.`,
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'Grant Access',
          },
        );

        if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
        return 'denied';
      }

      if (apiLevel >= 29) {
        console.log('[PermissionCoordinator] Requesting Android 10-12 READ_EXTERNAL_STORAGE');
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: 'EntePhoto Storage Access',
            message: `EntePhoto requires storage access to view and sync photos from your ${PHOTO_STORAGE_DISPLAY_PATH} folder.`,
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'Grant Access',
          },
        );

        if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
        return 'denied';
      }

      // Android 9 and below
      console.log('[PermissionCoordinator] Requesting legacy READ + WRITE storage permissions');
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ]);

      const rGranted =
        results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] ===
        PermissionsAndroid.RESULTS.GRANTED;
      const wGranted =
        results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] ===
        PermissionsAndroid.RESULTS.GRANTED;

      if (rGranted && wGranted) return 'granted';

      const rBlocked =
        results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] ===
        PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
      const wBlocked =
        results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] ===
        PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

      if (rBlocked || wBlocked) return 'blocked';
      return 'denied';
    } catch (err) {
      console.error('[PermissionCoordinator] Error requesting photo permission:', err);
      return 'denied';
    }
  }

  /**
   * Requests Android 13+ notification permission if not already granted.
   * Denial of notification permission NEVER breaks photo functionality.
   */
  async requestNotificationPermission(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }

    const current = await this.checkNotificationPermission();
    if (current === 'granted') {
      return 'granted';
    }

    if (this.getApiLevel() < 33) {
      // Pre-Android 13: Notifications are enabled via app settings, not runtime permission dialog
      return current;
    }

    try {
      console.log('[PermissionCoordinator] Requesting Android 13+ POST_NOTIFICATIONS');
      const granted = await notificationService.requestPermission();
      return granted ? 'granted' : 'denied';
    } catch (err) {
      console.warn('[PermissionCoordinator] Notification permission request error:', err);
      return 'denied';
    }
  }

  /**
   * Main controlled permission sequence for application entry:
   * 1. Check existing photo-library / storage permission.
   * 2. Request applicable photo-reading permission if not already granted.
   * 3. Request Android notification permission if applicable (Android 13+) and not already granted.
   * 4. Deduplicate calls using inFlightRequestPromise and session guard.
   * 5. Return consolidated status.
   */
  async requestAppPermissions(force: boolean = false): Promise<AppPermissionsStatus> {
    // If not forced and already checked during this session, return snapshot without re-prompting
    if (this.hasCheckedInSession && !force) {
      return this.checkAllPermissions();
    }

    // Deduplicate concurrent in-flight requests (avoids overlapping system dialogs)
    if (this.inFlightRequestPromise) {
      return this.inFlightRequestPromise;
    }

    this.inFlightRequestPromise = (async () => {
      try {
        console.log('[PermissionCoordinator] Starting controlled permission flow...');

        // 1. Check & Request Photo Permission
        const initialPhoto = await this.checkPhotoPermission();
        let finalPhoto = initialPhoto;

        if (initialPhoto !== 'granted' && initialPhoto !== 'limited') {
          finalPhoto = await this.requestPhotoPermission();
        }

        // 2. Check & Request Notification Permission (sequential, never overlapping)
        const initialNotif = await this.checkNotificationPermission();
        let finalNotif = initialNotif;

        if (initialNotif !== 'granted' && this.getApiLevel() >= 33) {
          finalNotif = await this.requestNotificationPermission();
        }

        this.hasCheckedInSession = true;

        const isPhotoGranted = finalPhoto === 'granted';
        const isPhotoLimited = finalPhoto === 'limited';
        const isNotificationGranted = finalNotif === 'granted';

        this.lastKnownStatus = {
          photo: finalPhoto,
          notification: finalNotif,
          canProceed: isPhotoGranted || isPhotoLimited,
          isPhotoGranted,
          isPhotoLimited,
          isNotificationGranted,
        };

        console.log('[PermissionCoordinator] Permission flow complete:', this.lastKnownStatus);
        return this.lastKnownStatus;
      } finally {
        this.inFlightRequestPromise = null;
      }
    })();

    return this.inFlightRequestPromise;
  }
}

export const permissionCoordinator = new PermissionCoordinator();
