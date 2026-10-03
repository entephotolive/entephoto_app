/**
 * photoBatchingService.ts
 *
 * Implements TIME-BASED BATCHING.
 * Groups photos by localized date string.
 */

import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';

const ASSUMED_SHOT_INTERVAL_MS = 2000;

export interface RuntimeBatch {
  id: string;
  photoIds: string[];
  photos: GalleryPhotoItem[];
  dateString: string;
}

function extractPhotoTimestampMs(photo: GalleryPhotoItem, indexFallback: number): number {
  if (photo.capturedAt && photo.capturedAt > 0) {
    return photo.capturedAt;
  }
  return Date.now() - (10000 - indexFallback * ASSUMED_SHOT_INTERVAL_MS);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Fast date string formatter that avoids toLocaleDateString().
 *
 * On Hermes (React Native's JS engine), calling new Date().toLocaleDateString()
 * with Intl options inside a loop over hundreds of photos causes ~177 ms+ of
 * synchronous JS thread blockage, freezing all UI interactions during that time.
 *
 * This implementation uses simple arithmetic to produce an identical output
 * (e.g. "October 3, 2026") with no Intl overhead, running in O(1) per call.
 */
function toDateString(epochMs: number): string {
  const d = new Date(epochMs);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function stableId(photo: GalleryPhotoItem): string {
  return photo.filename || photo.id;
}

export function buildPhotoBatchesSync(photos: GalleryPhotoItem[]): RuntimeBatch[] {
  if (photos.length === 0) return [];

  const batches: RuntimeBatch[] = [];
  let currentRuntime: RuntimeBatch | null = null;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const photoMs = extractPhotoTimestampMs(photo, i);
    const photoDateStr = toDateString(photoMs);
    const sid = stableId(photo);

    if (!currentRuntime) {
      currentRuntime = {
        id: `batch-${photoDateStr.replace(/\s+/g, '-')}`,
        photoIds: [sid],
        photos: [photo],
        dateString: photoDateStr,
      };
    } else {
      if (currentRuntime.dateString === photoDateStr) {
        currentRuntime.photoIds.push(sid);
        currentRuntime.photos.push(photo);
      } else {
        batches.push(currentRuntime);
        currentRuntime = {
          id: `batch-${photoDateStr.replace(/\s+/g, '-')}`,
          photoIds: [sid],
          photos: [photo],
          dateString: photoDateStr,
        };
      }
    }
  }

  if (currentRuntime) {
    batches.push(currentRuntime);
  }

  return batches;
}

function batchSectionTitle(batch: RuntimeBatch): string {
  const count = batch.photos.length;
  const photoWord = count === 1 ? 'photo' : 'photos';
  return `${batch.dateString} (${count} ${photoWord})`;
}

export type GallerySectionRow =
  | {
      type: 'hero_collapsed';
      rowKey: string;
      heroPhoto: GalleryPhotoItem;
      heroPhotoIndex: number;
      totalPhotos: number;
      batch: RuntimeBatch;
      batchIndex: number;
    }
  | {
      type: 'grid_row';
      rowKey: string;
      photos: { photo: GalleryPhotoItem; photoIndex: number }[];
    };

export interface GalleryBatchSection {
  batch: RuntimeBatch;
  batchIndex: number;
  title: string;
  subtitle: string | null;
  key: string;
  isCollapsed: boolean;
  data: GallerySectionRow[];
}

export function buildGallerySections(
  batches: RuntimeBatch[],
  allFilteredPhotos: GalleryPhotoItem[],
): GalleryBatchSection[] {
  const photoIndexMap = new Map<string, number>();
  allFilteredPhotos.forEach((p, idx) => {
    photoIndexMap.set(p.id, idx);
    if (p.filename) {
      photoIndexMap.set(p.filename, idx);
    }
  });

  return batches.map((batch, idx) => {
    const batchIndex = idx + 1;
    const title = batchSectionTitle(batch);

    const rows: GallerySectionRow[] = [];

    for (let i = 0; i < batch.photos.length; i += 3) {
      const slice = batch.photos.slice(i, i + 3);
      rows.push({
        type: 'grid_row',
        rowKey: `${batch.id}-row-${i / 3}`,
        photos: slice.map(photo => ({
          photo,
          photoIndex:
            photoIndexMap.get(photo.id) ??
            (photo.filename ? photoIndexMap.get(photo.filename) : undefined) ??
            0,
        })),
      });
    }

    return {
      batch,
      batchIndex,
      title,
      subtitle: null,
      key: `section-${batch.id}`,
      isCollapsed: false,
      data: rows,
    };
  });
}
