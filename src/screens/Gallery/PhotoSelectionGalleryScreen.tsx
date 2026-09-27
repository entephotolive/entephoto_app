import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  SectionList,
  Alert,
  Platform,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  Images,
  ArrowRight,
  MoreVertical,
  Cloud,
  Camera,
  RefreshCw,
  AlertTriangle,
  Star,
} from 'lucide-react-native';
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native';
import { AppNavigationProp, AppStackParamList } from '@/navigation/types';
import { Text } from '@/components/Text';
import { useTheme } from '@/constants/theme';
import { FONTS } from '@/constants/typography';
import { formatEventDate } from '@/utils/date';
import { AppBackground } from '@/components/AppBackground';
import {
  scanDcimEntephotoPhotos,
  subscribeToDcimPhotos,
  deleteLocalPhoto,
  CANONICAL_DCIM_DIR_URI,
  PHOTO_STORAGE_DISPLAY_PATH,
} from '@/services/localPhotoService';
import { uploadSinglePhoto, isValidObjectId } from '@/services/photoUploadService';
import { PhotoQualityResult } from '@/services/photoQualityService';
import {
  buildPhotoBatchesSync,
  RuntimeBatch,
  GalleryBatchSection,
  GallerySectionRow,
  buildGallerySections,
  assignPhotoBatchesPersisted,
  hydrateBatchesForRender,
} from '@/services/photoBatchingService';
import { getAllPersistedBatches } from '@/services/photoBatchPersistenceService';
import {
  runGalleryBackgroundPipeline,
  stopGalleryPipeline,
} from '@/services/galleryPipelineService';
import { FullScreenPhotoViewer } from './components/FullScreenPhotoViewer';
import { GalleryActionsSheet } from './components/GalleryActionsSheet';
import { PhotoQualityModal } from './components/PhotoQualityModal';
import { ImageWithSkeleton } from './components/ImageWithSkeleton';
import { PipelineNotificationStack } from '@/components/PipelineNotificationStack';

export type PhotoStatus = 'new' | 'marked' | 'uploaded';

export interface GalleryPhotoItem {
  id: string;
  assetId?: string;
  uri: string;
  filename?: string;
  isRaw: boolean;
  status: PhotoStatus;
  selected: boolean;
  timestamp: string;
  /** Real file modification time (ms since epoch) from Expo FileSystem Directory API */
  capturedAt?: number;
  aperture?: string;
  iso?: string;
  shutter?: string;
  dimensions?: string;
  /** Early visual hash computed by Skia (~15ms) before ML Kit finishes */
  pHash?: string;
  qualityResult?: PhotoQualityResult;
  isAnalyzingQuality?: boolean;
  compressedUri?: string;
  compressedSizeBytes?: number;
  isCompressed?: boolean;
  isCompressing?: boolean;
  isAutoFavorited?: boolean;
}

type FilterTab = 'All' | 'New' | 'Marked' | 'Uploaded';

export const PhotoSelectionGalleryScreen: React.FC = () => {
  const navigation = useNavigation<AppNavigationProp>();
  const route = useRoute<RouteProp<AppStackParamList, 'PhotoSelectionGallery'>>();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Route Parameters
  const eventId = route.params?.eventId || '';
  const eventTitle = route.params?.eventTitle || 'Rahul & Fathima';
  const eventDateFormatted = route.params?.eventDate
    ? formatEventDate(route.params.eventDate)
    : '05 Sep 2026';
  const eventCategory = route.params?.eventCategory || 'Wedding';

  // Dynamic photos state (only real photos from DCIM/Entephoto)
  const [photos, setPhotos] = useState<GalleryPhotoItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionsModalVisible, setIsActionsModalVisible] = useState(false);

  // Uploading state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    filename?: string;
  } | null>(null);
  const [uploadingPhotoIds, setUploadingPhotoIds] = useState<Set<string>>(new Set());

  // Quality analysis & modal state
  const [selectedQualityPhoto, setSelectedQualityPhoto] = useState<GalleryPhotoItem | null>(null);
  const [isQualityModalVisible, setIsQualityModalVisible] = useState(false);
  const isMountedRef = React.useRef(true);

  /**
   * Persisted batches state.
   * Initially null (shows sync fallback batches); populated after the async
   * persistence call completes. Once populated, never reverts to null.
   */
  const [persistedBatches, setPersistedBatches] = useState<RuntimeBatch[] | null>(null);
  /** True while the first persistence load is running (shows no extra spinner — fallback sync batches are used) */
  const batchLoadedRef = React.useRef(false);

  // Guard pipeline and state against unmounted screen
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopGalleryPipeline();
    };
  }, []);

  // Background non-blocking pipeline trigger: yields to main thread after UI animations settle
  const triggerPipeline = useCallback(
    (photosToProcess: GalleryPhotoItem[]) => {
      InteractionManager.runAfterInteractions(() => {
        if (!isMountedRef.current) return;

        runGalleryBackgroundPipeline(
          photosToProcess,
          {
            onPhotoUpdated: update => {
              if (!isMountedRef.current) return;
              setPhotos(prev => prev.map(p => (p.id === update.id ? { ...p, ...update } : p)));
            },
            onAutoFavorite: photoId => {
              if (!isMountedRef.current) return;
              console.log('[PhotoGallery] Auto-favorited passing photo:', photoId);
            },
          },
          eventId,
        );
      });
    },
    [eventId],
  );

  // Subscribe to real-time DCIM folder changes
  useEffect(() => {
    const unsubscribe = subscribeToDcimPhotos(dcimPhotos => {
      setPhotos(prevPhotos => {
        if (prevPhotos.length === 0) {
          triggerPipeline(dcimPhotos);
          return dcimPhotos;
        }

        // Preserve user's local selections, quality results, and compression states across scans
        const statusMap = new Map<
          string,
          {
            selected: boolean;
            status: PhotoStatus;
            qualityResult?: PhotoQualityResult;
            isAnalyzingQuality?: boolean;
            compressedUri?: string;
            compressedSizeBytes?: number;
            isCompressed?: boolean;
            isCompressing?: boolean;
            isAutoFavorited?: boolean;
          }
        >();
        for (const p of prevPhotos) {
          const entry = {
            selected: p.selected,
            status: p.status,
            qualityResult: p.qualityResult,
            isAnalyzingQuality: p.isAnalyzingQuality,
            compressedUri: p.compressedUri,
            compressedSizeBytes: p.compressedSizeBytes,
            isCompressed: p.isCompressed,
            isCompressing: p.isCompressing,
            isAutoFavorited: p.isAutoFavorited,
          };
          statusMap.set(p.id, entry);
          statusMap.set(p.uri, entry);
        }

        const merged = dcimPhotos.map(item => {
          const existing = statusMap.get(item.id) || statusMap.get(item.uri);
          if (existing) {
            return {
              ...item,
              selected: existing.selected,
              status: existing.status,
              qualityResult: existing.qualityResult,
              isAnalyzingQuality: existing.isAnalyzingQuality,
              compressedUri: existing.compressedUri,
              compressedSizeBytes: existing.compressedSizeBytes,
              isCompressed: existing.isCompressed,
              isCompressing: existing.isCompressing,
              isAutoFavorited: existing.isAutoFavorited,
            };
          }
          return item;
        });

        triggerPipeline(merged);
        return merged;
      });
    }, 2000);

    return () => {
      unsubscribe();
    };
  }, [triggerPipeline]);

  // Manual rescan handler
  const handleManualRescan = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const scanned = await scanDcimEntephotoPhotos();
      setPhotos(scanned);
      triggerPipeline(scanned);
    } finally {
      setIsRefreshing(false);
    }
  }, [triggerPipeline]);

  // Step 3: Trigger background pipeline when gallery screen gains focus (without redundant re-runs)
  useFocusEffect(
    useCallback(() => {
      if (photos.length > 0) {
        triggerPipeline(photos);
      }
    }, [photos, triggerPipeline]),
  );

  // Dynamic live counts based on real photos
  const totalCount = photos.length;

  const selectedCount = useMemo(() => {
    return photos.filter(p => p.selected).length;
  }, [photos]);

  const newCount = useMemo(() => {
    return photos.filter(p => p.status === 'new').length;
  }, [photos]);

  const markedCount = useMemo(() => {
    return photos.filter(p => p.status === 'marked' || p.selected).length;
  }, [photos]);

  const uploadedCount = useMemo(() => {
    return photos.filter(p => p.status === 'uploaded').length;
  }, [photos]);

  // Filtered Photo List
  const filteredPhotos = useMemo(() => {
    switch (activeFilter) {
      case 'New':
        return photos.filter(p => p.status === 'new');
      case 'Marked':
        return photos.filter(p => p.selected || p.status === 'marked');
      case 'Uploaded':
        return photos.filter(p => p.status === 'uploaded');
      case 'All':
      default:
        return photos;
    }
  }, [photos, activeFilter]);

  /**
   * Analysis progress: tracks how many photos have completed Skia/ML Kit analysis.
   * Derived directly from filteredPhotos (avoids cascading setState in effects).
   */
  const analysisProgress = useMemo<{ analyzed: number; total: number } | null>(() => {
    const total = filteredPhotos.length;
    if (total === 0) return null;
    const analyzed = filteredPhotos.filter(p => p.qualityResult != null).length;
    return analyzed < total ? { analyzed, total } : null;
  }, [filteredPhotos]);

  /**
   * Gallery batches — computed from time-based similar-photo batching.
   *
   * Two-phase:
   *  Phase 1 (immediate, sync): `buildPhotoBatchesSync` runs the sequential algorithm
   *    in-memory without consulting persistence. This gives instant rendering.
   *  Phase 2 (async, debounced): `assignPhotoBatchesPersisted` loads persisted
   *    assignments, skips already-assigned photos, saves new ones, and hydrates
   *    authoritative persisted batches. The result replaces phase 1.
   *
   * PERFORMANCE: syncBatches only recalculates when filteredPhotos identity
   * changes (i.e. new photos added or filter changed). Individual photo quality
   * updates do NOT re-run the sync algorithm — they are batched by the debounced
   * persistence effect instead.
   */
  const syncBatches = useMemo<RuntimeBatch[]>(() => {
    return buildPhotoBatchesSync(filteredPhotos);
  }, [filteredPhotos]);

  /**
   * Debounce ref: accumulates pHash/faceCount arrival ticks and fires the full
   * persistence pipeline once after BATCH_DEBOUNCE_MS of silence.
   *
   * ROOT CAUSE FIXED: previously the useEffect dep array contained
   * `filteredPhotos.map(p => ...).join('|')` which changed on EVERY single
   * onPhotoUpdated call, triggering the full O(n) pipeline 200 times for
   * 200 photos = O(n²). Now we debounce and fire once per burst.
   */
  const BATCH_DEBOUNCE_MS = 250;
  const batchDebounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBatchRun = React.useRef(false);

  /**
   * Stable snapshot of filteredPhotos for use inside the debounced callback.
   * Updated synchronously on every render so the debounced callback always
   * sees the latest photo list without capturing a stale closure.
   */
  const filteredPhotosRef = React.useRef(filteredPhotos);
  useEffect(() => {
    filteredPhotosRef.current = filteredPhotos;
  });

  /** Core batching pipeline — runs once per debounced burst, not once per photo. */
  const runPersistentBatchingOnce = useCallback(async (cancelled: { value: boolean }) => {
    const currentPhotos = filteredPhotosRef.current;
    if (currentPhotos.length === 0 || cancelled.value || !isMountedRef.current) return;
    try {
      await assignPhotoBatchesPersisted(currentPhotos);
      if (cancelled.value || !isMountedRef.current) return;

      const allBatches = await getAllPersistedBatches();
      if (cancelled.value || !isMountedRef.current) return;

      const runtimeBatches = hydrateBatchesForRender(
        allBatches.filter(b =>
          b.photoIds.some(pid => currentPhotos.some(p => (p.filename || p.id) === pid)),
        ),
        currentPhotos,
      );

      if (!cancelled.value && isMountedRef.current) {
        setPersistedBatches(runtimeBatches);
        batchLoadedRef.current = true;
      }
    } catch (err) {
      console.warn('[PhotoGallery] Persistent batch assignment failed, using sync fallback:', err);
    }
  }, []);

  /**
   * Debounced batching effect: fires the full pipeline ONCE after 250ms of
   * analysis-completion inactivity instead of once per photo completion.
   *
   * Watches filteredPhotos identity (new photos / filter change) AND the count
   * of photos that have a pHash — a cheap numeric signal that only increments,
   * never triggers the O(n) string construction on every tick.
   */
  const analyzedCount = filteredPhotos.filter(
    p => p.pHash != null || p.qualityResult?.pHash != null,
  ).length;

  useEffect(() => {
    if (filteredPhotos.length === 0) return;

    // Debounce: clear any pending timer and start a fresh one
    const cancelled = { value: false };
    if (batchDebounceTimer.current !== null) {
      clearTimeout(batchDebounceTimer.current);
    }
    pendingBatchRun.current = true;
    batchDebounceTimer.current = setTimeout(() => {
      batchDebounceTimer.current = null;
      pendingBatchRun.current = false;
      runPersistentBatchingOnce(cancelled);
    }, BATCH_DEBOUNCE_MS);

    return () => {
      cancelled.value = true;
    };
  }, [
    filteredPhotos, // triggers when new photos arrive or filter changes
    analyzedCount, // triggers when any photo completes analysis (cheap: just a number)
    runPersistentBatchingOnce,
  ]);

  // Eagerly load persisted batches on initial mount if available (instant cross-session render)
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const allBatches = await getAllPersistedBatches();
        if (!isMounted || allBatches.length === 0) return;
        const currentPhotos = filteredPhotosRef.current;
        if (currentPhotos.length === 0) return;

        const runtimeBatches = hydrateBatchesForRender(
          allBatches.filter(b =>
            b.photoIds.some(pid => currentPhotos.some(p => (p.filename || p.id) === pid)),
          ),
          currentPhotos,
        );

        if (isMounted && runtimeBatches.length > 0) {
          setPersistedBatches(runtimeBatches);
          batchLoadedRef.current = true;
          console.log(
            `[PhotoGallery] Eagerly hydrated ${runtimeBatches.length} batch(es) from disk cache on launch.`,
          );
        }
      } catch {}
    })();
    return () => {
      isMounted = false;
    };
  }, [photos.length]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (batchDebounceTimer.current !== null) {
        clearTimeout(batchDebounceTimer.current);
      }
    };
  }, []);

  /**
   * Authoritative batches for rendering:
   * Uses persisted batches when available (phase 2), otherwise sync fallback (phase 1).
   */
  const activeBatches = persistedBatches ?? syncBatches;

  /**
   * Sections built for React Native SectionList (one section per PhotoBatch).
   * Renders all photos directly in a 3-column grid under each batch header.
   */
  const gallerySections = useMemo<GalleryBatchSection[]>(() => {
    return buildGallerySections(activeBatches, filteredPhotos);
  }, [activeBatches, filteredPhotos]);

  // Back Navigation
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('CameraConnected');
    }
  }, [navigation]);

  // Toggle Photo Selection with 20-photo maximum limit
  const togglePhotoSelection = useCallback((id: string) => {
    setPhotos(prev => {
      const currentSelectedCount = prev.filter(p => p.selected).length;
      return prev.map(item => {
        if (item.id === id) {
          if (item.status === 'uploaded') {
            return item;
          }
          const nextSelected = !item.selected;
          if (nextSelected && currentSelectedCount >= 20) {
            Alert.alert(
              'Selection Limit Reached',
              'You can mark and upload a maximum of 20 photos at a time.',
            );
            return item;
          }
          return {
            ...item,
            selected: nextSelected,
            status: nextSelected ? 'marked' : 'new',
          };
        }
        return item;
      });
    });
  }, []);

  // Step 7: Toggle Select All photos within a specific batch (with 20-photo safety limit)
  const toggleBatchSelection = useCallback((batch: RuntimeBatch) => {
    setPhotos(prev => {
      const selectablePhotos = batch.photos.filter(p => p.status !== 'uploaded');
      if (selectablePhotos.length === 0) return prev;

      const allSelected = selectablePhotos.every(p => {
        const current = prev.find(item => item.id === p.id);
        return current?.selected;
      });

      const batchPhotoIds = new Set(batch.photos.map(p => p.id));
      const currentTotalSelected = prev.filter(p => p.selected).length;
      const unselectedInBatch = selectablePhotos.filter(p => {
        const current = prev.find(item => item.id === p.id);
        return !current?.selected;
      });

      if (!allSelected && currentTotalSelected + unselectedInBatch.length > 20) {
        Alert.alert(
          'Selection Limit Reached',
          'You can mark and upload a maximum of 20 photos at a time.',
        );
        return prev;
      }

      return prev.map(item => {
        if (batchPhotoIds.has(item.id) && item.status !== 'uploaded') {
          const nextSelected = !allSelected;
          return {
            ...item,
            selected: nextSelected,
            status: nextSelected ? 'marked' : item.status === 'marked' ? 'new' : item.status,
          };
        }
        return item;
      });
    });
  }, []);

  // Open Gallery Actions Sheet
  const handleMoreOptions = useCallback(() => {
    setIsActionsModalVisible(true);
  }, []);

  // Select All Photos (Capped at 20)
  const handleSelectAll = useCallback(() => {
    let count = 0;
    setPhotos(prev =>
      prev.map(p => {
        if (p.status !== 'uploaded' && count < 20) {
          count++;
          return { ...p, selected: true, status: 'marked' };
        }
        return p;
      }),
    );
    setIsActionsModalVisible(false);
    if (photos.filter(p => p.status !== 'uploaded').length > 20) {
      Alert.alert('Limit Applied', 'Selected the first 20 photos (maximum batch size).');
    }
  }, [photos]);

  // Select All New Photos (Capped at 20)
  const handleSelectAllNew = useCallback(() => {
    let count = 0;
    setPhotos(prev =>
      prev.map(p => {
        if (p.status === 'new' && count < 20) {
          count++;
          return { ...p, selected: true, status: 'marked' };
        }
        return p;
      }),
    );
    setIsActionsModalVisible(false);
    if (photos.filter(p => p.status === 'new').length > 20) {
      Alert.alert('Limit Applied', 'Selected the first 20 new photos (maximum batch size).');
    }
  }, [photos]);

  // Invert Selection (Capped at 20)
  const handleInvertSelection = useCallback(() => {
    let count = 0;
    setPhotos(prev =>
      prev.map(p => {
        if (p.status === 'uploaded') return p;
        const nextSelected = !p.selected;
        if (nextSelected && count < 20) {
          count++;
          return {
            ...p,
            selected: true,
            status: 'marked',
          };
        }
        return {
          ...p,
          selected: false,
          status: p.status === 'marked' ? 'new' : p.status,
        };
      }),
    );
    setIsActionsModalVisible(false);
  }, []);

  // Clear Selection
  const handleClearSelection = useCallback(() => {
    setPhotos(prev =>
      prev.map(p => ({
        ...p,
        selected: false,
        status: p.status === 'marked' ? 'new' : p.status,
      })),
    );
    setIsActionsModalVisible(false);
  }, []);

  // Batch Delete Selected Photos
  const handleDeleteSelectedPhotos = useCallback(() => {
    const selectedPhotos = photos.filter(p => p.selected);
    if (selectedPhotos.length === 0) {
      Alert.alert('No Photos Selected', 'Please select one or more photos to delete.');
      return;
    }

    Alert.alert(
      'Delete Selected Photos',
      `Are you sure you want to permanently delete ${selectedPhotos.length} photo${selectedPhotos.length > 1 ? 's' : ''} from your device storage? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete (${selectedPhotos.length})`,
          style: 'destructive',
          onPress: async () => {
            setIsActionsModalVisible(false);
            const selectedUris = new Set(selectedPhotos.map(p => p.uri));
            const selectedIds = new Set(selectedPhotos.map(p => p.id));

            // Delete files from storage
            await Promise.all(
              selectedPhotos.map(async photo => {
                try {
                  await deleteLocalPhoto(photo.uri);
                } catch (e) {
                  console.error('[GalleryActions] Failed to delete photo file:', photo.uri, e);
                }
              }),
            );

            // Update state
            setPhotos(prev => prev.filter(p => !selectedIds.has(p.id) && !selectedUris.has(p.uri)));

            Alert.alert(
              'Photos Deleted 🗑️',
              `Successfully deleted ${selectedPhotos.length} photo${selectedPhotos.length > 1 ? 's' : ''} from local storage.`,
            );
          },
        },
      ],
    );
  }, [photos]);

  // Rescan Trigger from Action Sheet
  const handleRescanFromSheet = useCallback(async () => {
    setIsActionsModalVisible(false);
    await handleManualRescan();
  }, [handleManualRescan]);

  // Upload Selected Photos (Bulk upload: Each image uploaded independently)
  const handleUploadPhotos = useCallback(() => {
    if (isUploading) {
      return;
    }

    const selectedPhotos = photos.filter(p => p.selected && p.status !== 'uploaded');
    if (selectedPhotos.length === 0) {
      Alert.alert(
        'No Photos Selected',
        'Please tap on the photos you wish to mark and upload to the event cloud.',
      );
      return;
    }

    if (!eventId || !isValidObjectId(eventId)) {
      Alert.alert(
        'Invalid Event ID',
        'No valid 24-character hex event ID is associated with this session. Please select a valid event first.',
      );
      return;
    }

    const batchToUpload = selectedPhotos.slice(0, 20);

    Alert.alert(
      'Upload Photos',
      `Ready to upload ${batchToUpload.length} selected photo${batchToUpload.length > 1 ? 's' : ''} to "${eventTitle}"? Each photo is processed independently.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Upload (${batchToUpload.length})`,
          style: 'default',
          onPress: async () => {
            setIsUploading(true);
            const total = batchToUpload.length;
            let successCount = 0;
            let failCount = 0;
            const failReasons: string[] = [];

            setUploadProgress({ current: 0, total });

            for (let i = 0; i < total; i++) {
              const photo = batchToUpload[i];
              setUploadProgress({
                current: i + 1,
                total,
                filename: photo.filename,
              });
              setUploadingPhotoIds(prev => new Set(prev).add(photo.id));

              try {
                await uploadSinglePhoto(eventId, photo);
                successCount++;
                // Mark individual photo as uploaded immediately upon success
                setPhotos(prev =>
                  prev.map(p =>
                    p.id === photo.id || p.uri === photo.uri
                      ? { ...p, selected: false, status: 'uploaded' }
                      : p,
                  ),
                );
              } catch (err: any) {
                const errorMsg = err?.message || 'Upload failed';
                console.error(`[PhotoGallery] Upload error for ${photo.filename}:`, errorMsg);
                failReasons.push(`${photo.filename}: ${errorMsg}`);
                failCount++;
              } finally {
                setUploadingPhotoIds(prev => {
                  const next = new Set(prev);
                  next.delete(photo.id);
                  return next;
                });
              }
            }

            setIsUploading(false);
            setUploadProgress(null);

            if (failCount === 0) {
              Alert.alert(
                'Upload Complete! 🚀',
                `Successfully uploaded all ${successCount} photos to "${eventTitle}".`,
              );
            } else {
              const reasonsSample = failReasons.slice(0, 3).join('\n• ');
              const moreText =
                failReasons.length > 3 ? `\n...and ${failReasons.length - 3} more.` : '';
              Alert.alert(
                'Upload Finished ⚠️',
                `Uploaded: ${successCount}\nFailed: ${failCount}\n\nIssues:\n• ${reasonsSample}${moreText}\n\nYou can retry uploading any remaining marked photos.`,
              );
            }
          },
        },
      ],
    );
  }, [isUploading, photos, eventId, eventTitle]);

  // Upload Trigger from Action Sheet
  const handleUploadFromSheet = useCallback(() => {
    setIsActionsModalVisible(false);
    handleUploadPhotos();
  }, [handleUploadPhotos]);

  // Delete Single Photo
  const handleDeletePhoto = useCallback(async (photo: GalleryPhotoItem) => {
    await deleteLocalPhoto(photo.uri);
    setPhotos(prev => prev.filter(p => p.id !== photo.id && p.uri !== photo.uri));
  }, []);

  // Upload Single Photo
  const handleUploadSinglePhoto = useCallback(
    async (photo: GalleryPhotoItem) => {
      if (!eventId || !isValidObjectId(eventId)) {
        Alert.alert('Invalid Event ID', 'No valid 24-character event ID available for upload.');
        return;
      }
      setUploadingPhotoIds(prev => new Set(prev).add(photo.id));
      try {
        await uploadSinglePhoto(eventId, photo);
        setPhotos(prev =>
          prev.map(p =>
            p.id === photo.id || p.uri === photo.uri
              ? { ...p, selected: false, status: 'uploaded' }
              : p,
          ),
        );
        Alert.alert(
          'Photo Uploaded! 🚀',
          `${photo.filename || 'Photo'} has been uploaded to "${eventTitle}".`,
        );
      } catch (err: any) {
        console.error(`[PhotoGallery] Failed to upload ${photo.filename}:`, err);
        Alert.alert(
          'Upload Failed',
          `Could not upload ${photo.filename || 'photo'}:\n${err?.message || 'Network error'}`,
        );
      } finally {
        setUploadingPhotoIds(prev => {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        });
      }
    },
    [eventId, eventTitle],
  );

  // ── Render: Single Grid Tile (shared for single, batch_photo row types) ──
  const renderPhotoTile = useCallback(
    (item: GalleryPhotoItem, flatIndex: number, isBestShot?: boolean) => {
      const isSelected = item.selected;
      const isUploaded = item.status === 'uploaded';
      const isPhotoUploading = uploadingPhotoIds.has(item.id);

      const isNeedsReview =
        item.qualityResult &&
        (item.qualityResult.blur ||
          item.qualityResult.overExposure ||
          (item.qualityResult.face && !item.qualityResult.eyesOpen));

      const isQualityPass = item.qualityResult && !isNeedsReview;

      return (
        <View style={styles.gridCellContainer}>
          <Pressable
            onPress={() => {
              setViewerInitialIndex(flatIndex);
              setViewerVisible(true);
            }}
            onLongPress={() => {
              setSelectedQualityPhoto(item);
              setIsQualityModalVisible(true);
            }}
            style={({ pressed }) => [
              styles.photoTileWrapper,
              isSelected && styles.photoTileSelectedBorder,
              isUploaded && styles.photoTileUploadedDimmed,
              {
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open photo ${item.filename || item.id}`}
          >
            {/* Main Photo Thumbnail with Skeleton Placeholder (Step 9) */}
            <ImageWithSkeleton
              source={{ uri: item.uri }}
              style={styles.photoImage}
              containerStyle={styles.photoImageContainer}
              resizeMode="cover"
            />

            {/* Top-left Star Best Shot Badge */}
            {isBestShot && (
              <View style={styles.tileStarBadge}>
                <Star size={9} color="#FFFFFF" fill="#FFB800" strokeWidth={0} />
                <Text style={styles.tileStarBadgeText}>Best</Text>
              </View>
            )}

            {/* Bottom-left RAW Tag */}
            {item.isRaw && (
              <View style={[styles.rawBadgeContainer, isBestShot && { bottom: 22 }]}>
                <Text style={styles.rawBadgeText}>RAW</Text>
              </View>
            )}

            {/* Bottom-right Quality Indicator Badge */}
            {item.isAnalyzingQuality ? (
              <View style={styles.qualityAnalyzingBadge}>
                <ActivityIndicator size={8} color="#FFFFFF" />
              </View>
            ) : isNeedsReview ? (
              <Pressable
                onPress={e => {
                  e.stopPropagation();
                  setSelectedQualityPhoto(item);
                  setIsQualityModalVisible(true);
                }}
                hitSlop={6}
                style={styles.qualityReviewBadge}
                accessibilityRole="button"
                accessibilityLabel="Quality review details"
              >
                <AlertTriangle size={10} color="#92400E" strokeWidth={2.8} />
                <Text style={styles.qualityReviewBadgeText}>Review</Text>
              </Pressable>
            ) : isQualityPass ? (
              <Pressable
                onPress={e => {
                  e.stopPropagation();
                  setSelectedQualityPhoto(item);
                  setIsQualityModalVisible(true);
                }}
                hitSlop={6}
                style={styles.qualityPassBadge}
                accessibilityRole="button"
                accessibilityLabel="Quality passed"
              >
                <Check size={9} color="#065F46" strokeWidth={3} />
                <Text style={styles.qualityPassBadgeText}>Sharp</Text>
              </Pressable>
            ) : null}

            {/* Top-right Status / Selection Indicator with independent press hitSlop */}
            <Pressable
              onPress={e => {
                e.stopPropagation();
                if (!isPhotoUploading) {
                  togglePhotoSelection(item.id);
                }
              }}
              hitSlop={10}
              disabled={isPhotoUploading}
              style={styles.selectionIndicatorContainer}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={`Select photo ${item.filename || item.id}`}
            >
              {isPhotoUploading ? (
                <View style={styles.uploadingSpinnerBadge}>
                  <ActivityIndicator size={11} color="#FFFFFF" />
                </View>
              ) : isUploaded ? (
                <View style={styles.uploadedCloudBadge}>
                  <Cloud size={13} color="#FFFFFF" strokeWidth={2.4} />
                </View>
              ) : isSelected ? (
                <View style={styles.selectedCheckBadge}>
                  <Check size={14} color="#FFFFFF" strokeWidth={3.4} />
                </View>
              ) : (
                <View style={styles.unselectedCircleScrim}>
                  <View style={styles.unselectedHollowRing} />
                </View>
              )}
            </Pressable>
          </Pressable>
        </View>
      );
    },
    [togglePhotoSelection, uploadingPhotoIds],
  );

  // ── Render: Batch Section Header (SectionList) ───────────────────────────
  const renderSectionHeader = useCallback(
    ({ section }: { section: GalleryBatchSection }) => {
      const { title, batch } = section;
      const selectablePhotos = batch.photos.filter(p => p.status !== 'uploaded');
      const isAllBatchSelected =
        selectablePhotos.length > 0 &&
        selectablePhotos.every(p => {
          const livePhoto = photos.find(item => item.id === p.id);
          return livePhoto?.selected;
        });

      return (
        <View
          style={[
            styles.batchHeaderRow,
            {
              backgroundColor: isDark ? '#18181D' : '#F5F0E8',
              borderColor: isDark ? '#2E2E36' : '#E8E2D8',
            },
          ]}
          accessibilityRole="header"
          accessibilityLabel={title}
        >
          <View
            style={[styles.batchHeaderAccent, { backgroundColor: isDark ? '#FF6B4A' : '#161616' }]}
          />

          {/* Left: Clean Header Title (Time + Batch + Photo Count) */}
          <View style={styles.batchHeaderTextBlock}>
            <View style={styles.batchHeaderTitleRow}>
              <Text style={[styles.batchHeaderLabel, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                {title}
              </Text>
            </View>
          </View>

          {/* Right Action Button: Select All per batch toggle */}
          {selectablePhotos.length > 0 && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => toggleBatchSelection(batch)}
              style={[
                styles.batchSelectAllBtn,
                isAllBatchSelected && styles.batchSelectAllBtnActive,
                {
                  backgroundColor: isAllBatchSelected
                    ? isDark
                      ? '#FF6B4A'
                      : '#161616'
                    : isDark
                      ? '#26262E'
                      : '#FFFFFF',
                  borderColor: isDark ? '#3F3F46' : '#161616',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                isAllBatchSelected ? 'Deselect all in batch' : 'Select all in batch'
              }
            >
              <Check
                size={11}
                color={isAllBatchSelected ? '#FFFFFF' : isDark ? '#A1A1AA' : '#52525B'}
                strokeWidth={3}
                style={{ marginRight: 3 }}
              />
              <Text
                style={[
                  styles.batchSelectAllText,
                  {
                    color: isAllBatchSelected ? '#FFFFFF' : isDark ? '#D4D4D8' : '#161616',
                  },
                ]}
              >
                {isAllBatchSelected ? 'Selected' : 'Select all'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      );
    },
    [isDark, photos, toggleBatchSelection],
  );

  // ── Render: Section Item (3-Column Grid Row for all batch photos) ──────────
  const renderSectionItem = useCallback(
    ({ item }: { item: GallerySectionRow }) => {
      if (item.type !== 'grid_row') return null;

      // Grid Row: 3-column items with skeleton placeholders
      return (
        <View style={styles.photoRowGroup}>
          {item.photos.map(({ photo, photoIndex, isBestShot }) => (
            <React.Fragment key={photo.id}>
              {renderPhotoTile(photo, photoIndex, isBestShot)}
            </React.Fragment>
          ))}
          {/* Spacer tiles to keep grid aligned when row has < 3 photos */}
          {item.photos.length < 3 &&
            Array.from({ length: 3 - item.photos.length }).map((_, i) => (
              <View key={`spacer-${i}`} style={styles.gridCellContainer} />
            ))}
        </View>
      );
    },
    [renderPhotoTile],
  );

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* ── 1. HEADER ROW ── */}
        <View style={styles.headerRow}>
          {/* Circular Tactile Back Button */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={handleBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[
              styles.backButton,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFFFFF',
                borderColor: isDark ? '#2E2E36' : '#161616',
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.4} />
          </TouchableOpacity>

          {/* Event Title Block */}
          <View style={styles.headerTitleBlock}>
            <Text
              style={[styles.eventTitleText, { color: isDark ? '#F4F4F5' : '#161616' }]}
              numberOfLines={2}
            >
              {eventTitle}
            </Text>
          </View>

          {/* Right Header Actions: Connected Badge & More Menu */}
          <View style={styles.headerRightActions}>
            {/* Pill Connected Status Badge */}
            <View
              style={[
                styles.connectedStatusPill,
                {
                  backgroundColor: '#D2F4E2',
                  borderColor: isDark ? '#34D399' : '#161616',
                },
              ]}
            >
              <View style={styles.statusGreenDot} />
              <Text style={styles.connectedPillLabel}>Connected</Text>
            </View>

            {/* Circular More Options Button */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleMoreOptions}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[
                styles.moreOptionsButton,
                {
                  backgroundColor: isDark ? '#1A1A1E' : '#FFFFFF',
                  borderColor: isDark ? '#2E2E36' : '#161616',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <MoreVertical size={18} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2. FILTER TAB ROW ── */}
        <View style={styles.filterRowContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}
            data={[
              { key: 'All' as FilterTab, label: `All (${totalCount})` },
              { key: 'New' as FilterTab, label: `New (${newCount})` },
              { key: 'Marked' as FilterTab, label: `Marked (${markedCount})` },
              { key: 'Uploaded' as FilterTab, label: `Uploaded (${uploadedCount})` },
            ]}
            keyExtractor={item => item.key}
            renderItem={({ item }) => {
              const isSelected = activeFilter === item.key;
              return (
                <Pressable
                  onPress={() => setActiveFilter(item.key)}
                  style={({ pressed }) => [
                    styles.filterChipWrapper,
                    {
                      transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }],
                    },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isSelected }}
                >
                  {/* Shadow Underlay for Unselected Filter Chips */}
                  {!isSelected && <View style={styles.chipShadowUnderlay} />}

                  <View
                    style={[
                      styles.filterChipFace,
                      isSelected
                        ? [
                            styles.filterChipSelectedFace,
                            { backgroundColor: '#161616', borderColor: '#161616' },
                          ]
                        : [
                            styles.filterChipDefaultFace,
                            {
                              backgroundColor: isDark ? '#1A1A1E' : '#FAF7F2',
                              borderColor: isDark ? '#2E2E36' : '#161616',
                            },
                          ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isSelected
                          ? styles.filterChipSelectedText
                          : [
                              styles.filterChipDefaultText,
                              { color: isDark ? '#F4F4F5' : '#161616' },
                            ],
                      ]}
                    >
                      {item.label}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>

        {/* ── 3. ANALYSIS PROGRESS BANNER (shown during Skia/ML Kit analysis burst) ── */}
        {analysisProgress !== null && (
          <View
            style={[
              styles.analysisBanner,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFF9F0',
                borderColor: isDark ? '#2E2E36' : '#E8DDD0',
              },
            ]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Analyzing ${analysisProgress.analyzed} of ${analysisProgress.total} photos`}
          >
            <ActivityIndicator
              size={11}
              color={isDark ? '#FFA07A' : '#161616'}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.analysisBannerText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
              {`Analyzing ${analysisProgress.analyzed}/${analysisProgress.total}…`}
            </Text>
          </View>
        )}

        {/* ── 4. PHOTO GRID (SectionList, one section per PhotoBatch) ── */}
        <SectionList<GallerySectionRow, GalleryBatchSection>
          sections={gallerySections}
          keyExtractor={item => item.rowKey}
          renderItem={renderSectionItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={[
            styles.gridContentContainer,
            { paddingBottom: insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={true}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptyIconCircle,
                  {
                    backgroundColor: isDark ? '#26262E' : '#FFE5D9',
                    borderColor: isDark ? '#3F3F46' : '#161616',
                  },
                ]}
              >
                <Camera size={34} color={isDark ? '#FFA07A' : '#161616'} strokeWidth={2} />
              </View>
              <Text style={[styles.emptyTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                {`No photos in ${PHOTO_STORAGE_DISPLAY_PATH}`}
              </Text>
              <Text style={[styles.emptySubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                Connect your camera or copy photo files into {'\n'}
                <Text style={{ fontWeight: '700', color: isDark ? '#F4F4F5' : '#161616' }}>
                  {CANONICAL_DCIM_DIR_URI}
                </Text>
              </Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleManualRescan}
                disabled={isRefreshing}
                style={[
                  styles.emptyRefreshBtn,
                  {
                    backgroundColor: isDark ? '#1A1A1E' : '#FFFFFF',
                    borderColor: isDark ? '#2E2E36' : '#161616',
                  },
                ]}
              >
                <RefreshCw
                  size={16}
                  color={isDark ? '#F4F4F5' : '#161616'}
                  strokeWidth={2.2}
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={[styles.emptyRefreshBtnText, { color: isDark ? '#F4F4F5' : '#161616' }]}
                >
                  {isRefreshing ? 'Scanning...' : 'Rescan Photo Folder'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />

        {/* ── 4. FLOATING BOTTOM ACTION DOCK ── */}
        <View style={[styles.floatingDockContainer, { bottom: Math.max(insets.bottom, 16) + 8 }]}>
          {/* Hard Clay Shadow Underlay */}
          <View style={styles.floatingDockShadowUnderlay} />

          {/* Dock Card Surface */}
          <View
            style={[
              styles.floatingDockFace,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFFFFF',
                borderColor: isDark ? '#2E2E36' : '#161616',
              },
            ]}
          >
            {/* Left Info: Icon Tile + Selected Counts */}
            <View style={styles.dockLeftSection}>
              <View
                style={[
                  styles.dockIconTile,
                  {
                    backgroundColor: isDark ? '#2E221D' : '#FFE5D9',
                    borderColor: isDark ? '#3E2F28' : '#161616',
                  },
                ]}
              >
                <Images size={22} color={isDark ? '#FFA07A' : '#161616'} strokeWidth={2.2} />
              </View>

              <View style={styles.dockTextStack}>
                <Text
                  style={[styles.dockSelectedCountText, { color: isDark ? '#F4F4F5' : '#161616' }]}
                >
                  {selectedCount} photos selected
                </Text>
                <Text
                  style={[styles.dockTotalCountText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                >
                  {totalCount} photos total
                </Text>
              </View>
            </View>

            {/* Right Action: Upload CTA Button with Tactile Depress */}
            <Pressable
              onPress={handleUploadPhotos}
              disabled={isUploading || selectedCount === 0}
              style={({ pressed }) => [
                styles.dockUploadBtnWrapper,
                (isUploading || selectedCount === 0) && styles.dockUploadBtnDisabledWrapper,
                {
                  transform: [
                    { translateY: pressed && !isUploading && selectedCount > 0 ? 2 : 0 },
                    { translateX: pressed && !isUploading && selectedCount > 0 ? 2 : 0 },
                  ],
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Upload Photos"
            >
              <View
                style={[
                  styles.dockUploadBtnFace,
                  (isUploading || selectedCount === 0) && styles.dockUploadBtnDisabledFace,
                ]}
              >
                {isUploading ? (
                  <>
                    <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.dockUploadBtnText}>
                      Uploading ({uploadProgress?.current || 0}/{uploadProgress?.total || 0})...
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.dockUploadBtnText}>
                      {selectedCount > 0 ? `Upload (${selectedCount})` : 'Upload Photos'}
                    </Text>
                    <ArrowRight
                      size={18}
                      color="#FFFFFF"
                      strokeWidth={2.6}
                      style={{ marginLeft: 8 }}
                    />
                  </>
                )}
              </View>
            </Pressable>
          </View>
        </View>

        {/* ── 4b. PIPELINE NOTIFICATION STACK (iOS Lock Screen Notification Group) ── */}
        <PipelineNotificationStack bottomOffset={84} />

        {/* ── 5. FULL-SCREEN TWO-STAGE PHOTO VIEWER ── */}
        <FullScreenPhotoViewer
          visible={viewerVisible}
          photos={filteredPhotos}
          initialIndex={viewerInitialIndex}
          eventTitle={eventTitle}
          eventSubtitle={`${eventCategory} • ${eventDateFormatted}`}
          onClose={() => setViewerVisible(false)}
          onToggleMark={togglePhotoSelection}
          onUploadPhoto={handleUploadSinglePhoto}
          onDeletePhoto={handleDeletePhoto}
          onOpenQualityDetail={photo => {
            setSelectedQualityPhoto(photo);
            setIsQualityModalVisible(true);
          }}
          isDark={isDark}
        />

        {/* ── 6. MATCHING THEME GALLERY ACTIONS SHEET ── */}
        <GalleryActionsSheet
          visible={isActionsModalVisible}
          onClose={() => setIsActionsModalVisible(false)}
          isDark={isDark}
          totalCount={totalCount}
          selectedCount={selectedCount}
          newCount={newCount}
          onRescan={handleRescanFromSheet}
          onSelectAll={handleSelectAll}
          onSelectAllNew={handleSelectAllNew}
          onInvertSelection={handleInvertSelection}
          onClearSelection={handleClearSelection}
          onUploadSelected={handleUploadFromSheet}
          onDeleteSelected={handleDeleteSelectedPhotos}
        />

        {/* ── 7. PHOTO QUALITY DIAGNOSTICS MODAL (Step 7) ── */}
        <PhotoQualityModal
          visible={isQualityModalVisible}
          photo={selectedQualityPhoto}
          onClose={() => {
            setIsQualityModalVisible(false);
            setSelectedQualityPhoto(null);
          }}
          isDark={isDark}
        />
      </SafeAreaView>
    </AppBackground>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  // ── 1. Header Styles ──
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 14,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#161616',
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.8,
        shadowRadius: 0,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  headerTitleBlock: {
    flex: 1,
    marginHorizontal: 14,
    justifyContent: 'center',
  },
  eventTitleText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    letterSpacing: -0.4,
  },
  eventSublineText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12.5,
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectedStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.8,
  },
  statusGreenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  connectedPillLabel: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 12,
    fontWeight: '700',
    color: '#161616',
  },
  moreOptionsButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#161616',
        shadowOffset: { width: 1.5, height: 1.5 },
        shadowOpacity: 0.8,
        shadowRadius: 0,
      },
      android: {
        elevation: 2,
      },
    }),
  },

  // ── 2. Filter Row Styles ──
  filterRowContainer: {
    paddingBottom: 12,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  filterChipWrapper: {
    position: 'relative',
  },
  chipShadowUnderlay: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: -2,
    bottom: -2,
    borderRadius: 24,
    backgroundColor: '#161616',
  },
  filterChipFace: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipDefaultFace: {},
  filterChipSelectedFace: {
    ...Platform.select({
      ios: {
        shadowColor: '#161616',
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.9,
        shadowRadius: 0,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  filterChipText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  filterChipDefaultText: {},
  filterChipSelectedText: {
    color: '#FFFFFF',
  },

  // ── 3. Photo Grid Styles ──
  gridContentContainer: {
    paddingHorizontal: 12,
    paddingTop: 4,
    flexGrow: 1,
  },
  gridColumnWrapper: {
    gap: 8,
    marginBottom: 8,
  },
  gridCellContainer: {
    // numColumns=1; tiles self-arrange in rows of 3 using flexDirection: 'row' + flexWrap
    // Each tile takes exactly 1/3 of the content width.
    width: '33.33%',
    aspectRatio: 1,
    borderRadius: 14,
    padding: 4,
  },
  photoTileWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#26262E',
    borderWidth: 2.5,
    borderColor: 'transparent',
  },

  // ── Batch Header Row (SectionList) ─────────────────────────────────────────
  batchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
    marginBottom: 6,
    marginHorizontal: 0,
    borderRadius: 12,
    borderWidth: 1.2,
    gap: 10,
  },
  batchHeaderAccent: {
    width: 3.5,
    borderRadius: 2,
    height: 22,
  },
  batchHeaderTextBlock: {
    flex: 1,
  },
  batchHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchHeaderLabel: {
    fontFamily: FONTS.syne.bold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  batchHeaderTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  batchHeaderTagText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 9.5,
    fontWeight: '700',
  },
  batchHeaderActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  batchSelectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 7,
    borderWidth: 1.2,
  },
  batchSelectAllBtnActive: {
    borderColor: '#161616',
  },
  batchSelectAllText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 10.5,
    fontWeight: '700',
  },
  batchExpandToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 7,
    borderWidth: 1.2,
  },
  batchExpandToggleText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 10.5,
    fontWeight: '700',
  },

  // ── Photo Row Group (3-column grid row) ─────────────────────────────────────
  photoRowGroup: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  photoTileSelectedBorder: {
    borderColor: '#FF5E3A',
    borderWidth: 3,
  },
  photoTileUploadedDimmed: {
    opacity: 0.65,
  },
  photoImageContainer: {
    width: '100%',
    height: '100%',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  rawBadgeContainer: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(22, 22, 22, 0.78)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rawBadgeText: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  selectionIndicatorContainer: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  unselectedCircleScrim: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unselectedHollowRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.8,
    borderColor: '#FFFFFF',
  },
  selectedCheckBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#161616',
    borderWidth: 1.8,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadedCloudBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(22, 22, 22, 0.85)',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadingSpinnerBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(22, 22, 22, 0.92)',
    borderWidth: 1.5,
    borderColor: '#FFA07A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityReviewBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    borderWidth: 1.2,
    borderColor: '#D97706',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 1,
      },
    }),
  },
  qualityReviewBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 9,
    fontWeight: '800',
    color: '#92400E',
  },
  qualityPassBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#D1FAE5',
    borderWidth: 1.2,
    borderColor: '#059669',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  qualityPassBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 9,
    fontWeight: '800',
    color: '#065F46',
  },
  qualityAnalyzingBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(22, 22, 22, 0.75)',
    padding: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },

  // ── Star Best Shot Badges & Collapsed Hero View (Step 3) ───────────────────
  tileStarBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(15, 15, 18, 0.88)',
    borderWidth: 1.2,
    borderColor: '#FFB800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 2,
  },
  tileStarBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 8.5,
    fontWeight: '800',
    color: '#FFB800',
    letterSpacing: 0.2,
  },
  heroCardOuter: {
    width: '100%',
    paddingHorizontal: 0,
    marginBottom: 6,
    marginTop: 2,
  },
  heroCardContainer: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1.4,
    overflow: 'hidden',
    padding: 10,
    gap: 12,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  heroImageContainer: {
    width: 90,
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#26262E',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroStarBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 15, 18, 0.90)',
    borderWidth: 1,
    borderColor: '#FFB800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    zIndex: 2,
  },
  heroStarBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 8.5,
    fontWeight: '800',
    color: '#FFB800',
  },
  heroSelectionContainer: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 3,
  },
  heroPhotoCountOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 14, 0.85)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  heroPhotoCountOverlayText: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroDetailsSection: {
    flex: 1,
    gap: 6,
    justifyContent: 'center',
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroCaptionText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  heroSignalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  signalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  signalChipText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 9.5,
    fontWeight: '700',
  },
  heroExpandActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  heroExpandPrompt: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Empty State Styles ──
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#161616',
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.8,
        shadowRadius: 0,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  emptyRefreshBtnText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 13.5,
    fontWeight: '700',
  },

  // ── 4. Floating Bottom Action Dock Styles ──
  floatingDockContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  floatingDockShadowUnderlay: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: -4,
    bottom: -4,
    borderRadius: 36,
    backgroundColor: '#161616',
  },
  floatingDockFace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 36,
    borderWidth: 2.4,
  },
  dockLeftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dockIconTile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  dockTextStack: {
    justifyContent: 'center',
  },
  dockSelectedCountText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  dockTotalCountText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
    marginTop: 1,
  },
  dockUploadBtnWrapper: {
    borderRadius: 28,
  },
  dockUploadBtnDisabledWrapper: {
    opacity: 0.65,
  },
  dockUploadBtnFace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161616',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#161616',
  },
  dockUploadBtnDisabledFace: {
    backgroundColor: '#3A3A40',
    borderColor: '#3A3A40',
  },
  dockUploadBtnText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  // ── 5. Modal Preview Styles ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 12, 0.96)',
  },
  modalSafeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  modalHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitleText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCheckBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCheckBtnActive: {
    backgroundColor: '#FF5E3A',
  },
  modalImageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalMainImage: {
    width: '100%',
    height: '100%',
  },
  modalMetadataCard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(26, 26, 30, 0.95)',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  metaBadge: {
    alignItems: 'center',
  },
  metaBadgeLabel: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 9,
    color: '#A1A1AA',
    fontWeight: '700',
    marginBottom: 2,
  },
  metaBadgeValue: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Analysis progress banner: shown during Skia/ML Kit burst, disappears on completion
  analysisBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  analysisBannerText: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 11,
    fontWeight: '600',
  },
});
