import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import {
  buildPhotoBatchesSync,
  buildGallerySections,
  getPhotoDateString,
  extractPhotoTimestampMs,
  UNDATED_BATCH_LABEL,
  UNDATED_SECTION_TITLE,
  batchSectionTitle,
} from '../photoBatchingService';

function makePhoto(id: string, filename: string, capturedAt?: number): GalleryPhotoItem {
  return {
    id,
    filename,
    uri: `file:///sdcard/DCIM/Entephoto/${filename}`,
    isRaw: filename.toLowerCase().endsWith('.arw'),
    status: 'new',
    selected: false,
    timestamp: capturedAt ? '12:00' : '--:--',
    capturedAt,
  };
}

describe('photoBatchingService', () => {
  // Oct 15, 2026 12:00:00 UTC = 1792065600000
  const DATE_1 = new Date(2026, 9, 15, 12, 0, 0).getTime();
  // Oct 14, 2026 12:00:00 UTC
  const DATE_2 = new Date(2026, 9, 14, 12, 0, 0).getTime();

  describe('Missing timestamp handling', () => {
    it('returns null for missing or invalid timestamps without inventing Date.now()', () => {
      const photoUndefined = makePhoto('p1', 'IMG_1.JPG', undefined);
      const photoZero = makePhoto('p2', 'IMG_2.JPG', 0);
      const photoNegative = makePhoto('p3', 'IMG_3.JPG', -100);

      expect(extractPhotoTimestampMs(photoUndefined)).toBeNull();
      expect(extractPhotoTimestampMs(photoZero)).toBeNull();
      expect(extractPhotoTimestampMs(photoNegative)).toBeNull();

      expect(getPhotoDateString(photoUndefined)).toBe(UNDATED_BATCH_LABEL);
      expect(getPhotoDateString(photoZero)).toBe(UNDATED_BATCH_LABEL);
    });

    it('groups undated photos into an undated batch with proper title', () => {
      const photos: GalleryPhotoItem[] = [
        makePhoto('p1', 'IMG_1.JPG', undefined),
        makePhoto('p2', 'IMG_2.JPG', undefined),
      ];

      const batches = buildPhotoBatchesSync(photos);
      expect(batches).toHaveLength(1);
      expect(batches[0].dateString).toBe(UNDATED_BATCH_LABEL);
      expect(batchSectionTitle(batches[0])).toBe(`${UNDATED_SECTION_TITLE} (2 photos)`);
    });
  });

  describe('Unique keys across sections and rows', () => {
    it('guarantees unique batch IDs even when multiple non-contiguous batches share the same date', () => {
      // Simulate non-contiguous photos sharing the same date
      const photos: GalleryPhotoItem[] = [
        makePhoto('p1', 'IMG_1.JPG', DATE_1),
        makePhoto('p2', 'IMG_2.JPG', DATE_1),
        makePhoto('p3', 'IMG_3.JPG', DATE_2),
        makePhoto('p4', 'IMG_4.JPG', DATE_1), // Date 1 appears again
      ];

      const batches = buildPhotoBatchesSync(photos);
      expect(batches).toHaveLength(3);

      const batchIds = batches.map(b => b.id);
      const uniqueBatchIds = new Set(batchIds);
      expect(uniqueBatchIds.size).toBe(batches.length);
    });

    it('guarantees unique section and row keys for multiple batches with identical dates', () => {
      const photos: GalleryPhotoItem[] = [
        makePhoto('p1', 'IMG_1.JPG', DATE_1),
        makePhoto('p2', 'IMG_2.JPG', DATE_1),
        makePhoto('p3', 'IMG_3.JPG', DATE_2),
        makePhoto('p4', 'IMG_4.JPG', DATE_1),
        makePhoto('p5', 'IMG_5.JPG', undefined),
        makePhoto('p6', 'IMG_6.JPG', undefined),
      ];

      const batches = buildPhotoBatchesSync(photos);
      const sections = buildGallerySections(batches, photos);

      const sectionKeys = sections.map(s => s.key);
      const uniqueSectionKeys = new Set(sectionKeys);
      expect(uniqueSectionKeys.size).toBe(sections.length);

      const allRowKeys: string[] = [];
      sections.forEach(s => {
        s.data.forEach(row => {
          allRowKeys.push(row.rowKey);
        });
      });
      const uniqueRowKeys = new Set(allRowKeys);
      expect(uniqueRowKeys.size).toBe(allRowKeys.length);
    });

    it('handles several photos with identical timestamps without row or section collisions', () => {
      // 9 burst photos with the exact same millisecond timestamp
      const photos: GalleryPhotoItem[] = Array.from({ length: 9 }).map((_, i) =>
        makePhoto(`burst-${i}`, `DSC000${i}.JPG`, DATE_1),
      );

      const batches = buildPhotoBatchesSync(photos);
      expect(batches).toHaveLength(1);

      const sections = buildGallerySections(batches, photos);
      expect(sections).toHaveLength(1);
      expect(sections[0].data).toHaveLength(3); // 9 photos = 3 rows of 3

      const rowKeys = sections[0].data.map(r => r.rowKey);
      const uniqueRowKeys = new Set(rowKeys);
      expect(uniqueRowKeys.size).toBe(3);
    });

    it('produces stable keys across repeated builds (simulating rescans)', () => {
      const photos: GalleryPhotoItem[] = [
        makePhoto('p1', 'IMG_1.JPG', DATE_1),
        makePhoto('p2', 'IMG_2.JPG', DATE_1),
        makePhoto('p3', 'IMG_3.JPG', DATE_2),
        makePhoto('p4', 'IMG_4.JPG', undefined),
      ];

      const batchesRun1 = buildPhotoBatchesSync(photos);
      const sectionsRun1 = buildGallerySections(batchesRun1, photos);

      // Simulating a rescan where new object instances are created with identical photo data
      const photosRescanned = photos.map(p => ({ ...p }));
      const batchesRun2 = buildPhotoBatchesSync(photosRescanned);
      const sectionsRun2 = buildGallerySections(batchesRun2, photosRescanned);

      expect(batchesRun1.map(b => b.id)).toEqual(batchesRun2.map(b => b.id));
      expect(sectionsRun1.map(s => s.key)).toEqual(sectionsRun2.map(s => s.key));

      const rowKeys1 = sectionsRun1.flatMap(s => s.data.map(r => r.rowKey));
      const rowKeys2 = sectionsRun2.flatMap(s => s.data.map(r => r.rowKey));
      expect(rowKeys1).toEqual(rowKeys2);
    });
  });
});
