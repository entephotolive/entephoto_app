import * as FileSystem from 'expo-file-system/legacy';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import type { EventModel } from './eventService';
import {
  generateEventLiveQrUrl,
  generateQrPngBytes,
  uint8ArrayToBase64,
  extractEventId,
  getEventInitials,
} from '../utils/eventQr';

export interface QrExportResult {
  success: boolean;
  filePath?: string;
  assetId?: string;
  permissionDenied?: boolean;
  error?: string;
}

export const qrExportService = {
  /**
   * Generates a high-resolution PNG for the event QR code, writes it to a temporary file,
   * requests write permissions, and saves it into the device's photo gallery / MediaStore.
   */
  async downloadAndSaveEventQr(event: EventModel): Promise<QrExportResult> {
    try {
      const eventId = extractEventId(event);
      if (!eventId) {
        return {
          success: false,
          error: 'Event ID is missing or invalid. Cannot export QR code.',
        };
      }

      // 1. Generate live event URL using Step 1 utility
      const qrUrl = generateEventLiveQrUrl(event);

      // 2. Extract dynamic event initials for the centre badge
      const initials = getEventInitials(event.title);

      // 3. Generate crisp high-resolution PNG bytes with modern redesign (scale 20 -> ~1140x1140px, 4 quiet zone, initials)
      const pngBytes = generateQrPngBytes(qrUrl, 20, 4, initials);
      const base64Data = uint8ArrayToBase64(pngBytes);

      // 4. Write to temporary cache directory
      const sanitizedTitle = (event.title || 'Event').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      const filename = `EntePhoto_QR_${sanitizedTitle}_${eventId.slice(-6)}.png`;
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) {
        return {
          success: false,
          error: 'Unable to access local storage directory.',
        };
      }

      const tempUri = `${baseDir}${filename}`;
      await FileSystem.writeAsStringAsync(tempUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // 5. Request write permission for Media Library
      const permResponse = await requestPermissionsAsync(true);
      if (!permResponse.granted && permResponse.status !== 'granted') {
        // Clean up temp file
        try {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        } catch {}
        return {
          success: false,
          permissionDenied: true,
          error: 'Storage permission is required to save the QR code to your gallery.',
        };
      }

      // 6. Save to Media Library (Gallery) using Expo SDK 57 Asset API with legacy fallback
      let assetId = '';
      try {
        const asset = await Asset.create(tempUri);
        assetId = asset.id;
      } catch (assetErr) {
        console.warn('[qrExportService] Asset.create failed, trying legacy API:', assetErr);
        const { createAssetAsync } = await import('expo-media-library/legacy');
        const asset = await createAssetAsync(tempUri);
        assetId = asset.id;
      }

      // 7. Clean up temp file
      try {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      } catch {}

      return {
        success: true,
        filePath: tempUri,
        assetId,
      };
    } catch (err: any) {
      console.error('[qrExportService] Failed to export and save QR code:', err);
      return {
        success: false,
        error: err?.message || 'An unexpected error occurred while exporting the QR code.',
      };
    }
  },
};
