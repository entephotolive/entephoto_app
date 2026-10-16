/**
 * photoBatchingService.ts
 *
 * Implements TIME-BASED BATCHING.
 * Groups photos by localized date string, with deterministic undated grouping.
 */

import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';

export const UNDATED_BATCH_LABEL = 'Undated';
export const UNDATED_SECTION_TITLE = 'Undated Photos';

export interface RuntimeBatch {
  id: string;
  photoIds: string[];
  photos: GalleryPhotoItem[];
  dateString: string;
}

/**
 * Returns a valid epoch timestamp in milliseconds if present, or null.
 * Never invents a capture time using Date.now().
 */
export function extractPhotoTimestampMs(photo: GalleryPhotoItem): number | null {
  if (photo.capturedAt && photo.capturedAt > 0 && !isNaN(photo.capturedAt)) {
    return photo.capturedAt;
  }
  return null;
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

export function getPhotoDateString(photo: GalleryPhotoItem): string {
  const ts = extractPhotoTimestampMs(photo);
  if (ts !== null) {
    return toDateString(ts);
  }
  return UNDATED_BATCH_LABEL;
}

function stableId(photo: GalleryPhotoItem): string {
  return photo.filename || photo.id;
}

/**
 * Finalizes a batch's ID using a stable photo anchor.
 *
 * To ensure stable, collision-free batch IDs across rescans and new arrivals:
 * - Uses the oldest photo in the batch as the anchor (last item in chronological descending order).
 * - When newly taken photos are prepended to an existing batch, the oldest photo anchor remains unchanged.
 * - Disambiguates batches that share the exact same date string using unique anchor photo identities.
 * - Employs a collision-prevention set to guarantee global uniqueness.
 */
function finalizeBatchId(batch: RuntimeBatch, seenBatchIds: Set<string>): void {
  const anchorPhoto = batch.photos[batch.photos.length - 1];
  const anchorId = anchorPhoto ? stableId(anchorPhoto) : 'empty';
  const dateSlug = batch.dateString.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeAnchor = anchorId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const baseId = `batch-${dateSlug}-${safeAnchor}`;
  let uniqueId = baseId;
  let counter = 1;
  while (seenBatchIds.has(uniqueId)) {
    uniqueId = `${baseId}-${counter++}`;
  }
  seenBatchIds.add(uniqueId);
  batch.id = uniqueId;
}

export function buildPhotoBatchesSync(photos: GalleryPhotoItem[]): RuntimeBatch[] {
  if (photos.length === 0) return [];

  const batches: RuntimeBatch[] = [];
  const seenBatchIds = new Set<string>();
  let currentRuntime: RuntimeBatch | null = null;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const photoDateStr = getPhotoDateString(photo);
    const sid = stableId(photo);

    if (!currentRuntime) {
      currentRuntime = {
        id: '',
        photoIds: [sid],
        photos: [photo],
        dateString: photoDateStr,
      };
    } else {
      if (currentRuntime.dateString === photoDateStr) {
        currentRuntime.photoIds.push(sid);
        currentRuntime.photos.push(photo);
      } else {
        finalizeBatchId(currentRuntime, seenBatchIds);
        batches.push(currentRuntime);
        currentRuntime = {
          id: '',
          photoIds: [sid],
          photos: [photo],
          dateString: photoDateStr,
        };
      }
    }
  }

  if (currentRuntime) {
    finalizeBatchId(currentRuntime, seenBatchIds);
    batches.push(currentRuntime);
  }

  return batches;
}

export function batchSectionTitle(batch: RuntimeBatch): string {
  const count = batch.photos.length;
  const photoWord = count === 1 ? 'photo' : 'photos';
  if (batch.dateString === UNDATED_BATCH_LABEL) {
    return `${UNDATED_SECTION_TITLE} (${count} ${photoWord})`;
  }
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

  const seenSectionKeys = new Set<string>();
  const seenRowKeys = new Set<string>();

  return batches.map((batch, idx) => {
    const batchIndex = idx + 1;
    const title = batchSectionTitle(batch);

    // Guaranteed globally unique section key
    const baseSectionKey = `section-${batch.id}`;
    let sectionKey = baseSectionKey;
    let secCounter = 1;
    while (seenSectionKeys.has(sectionKey)) {
      sectionKey = `${baseSectionKey}-${secCounter++}`;
    }
    seenSectionKeys.add(sectionKey);

    const rows: GallerySectionRow[] = [];

    for (let i = 0; i < batch.photos.length; i += 3) {
      const slice = batch.photos.slice(i, i + 3);
      const rowIndex = i / 3;
      const firstPhoto = slice[0];
      const rowAnchor = firstPhoto
        ? stableId(firstPhoto).replace(/[^a-zA-Z0-9_-]/g, '_')
        : `${rowIndex}`;

      // Guaranteed globally unique row key
      const baseRowKey = `${batch.id}-r${rowIndex}-${rowAnchor}`;
      let rowKey = baseRowKey;
      let rowCounter = 1;
      while (seenRowKeys.has(rowKey)) {
        rowKey = `${baseRowKey}-${rowCounter++}`;
      }
      seenRowKeys.add(rowKey);

      rows.push({
        type: 'grid_row',
        rowKey,
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
      key: sectionKey,
      isCollapsed: false,
      data: rows,
    };
  });
}
