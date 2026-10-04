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
  Animated,
  Image,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  Images,
  ArrowRight,
  MoreVertical,
  Cloud,
  RefreshCw,
  Heart,
  Info,
} from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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
} from '@/services/localPhotoService';
import {
  uploadSinglePhoto,
  isValidObjectId,
  UploadCancellationControl,
  isUploadCancelledError,
} from '@/services/photoUploadService';
import { storageService } from '@/services/storageService';
import { FullScreenPhotoViewer } from './components/FullScreenPhotoViewer';
import { GalleryActionsSheet } from './components/GalleryActionsSheet';
import { ImageWithSkeleton } from './components/ImageWithSkeleton';
import {
  RuntimeBatch,
  GalleryBatchSection,
  GallerySectionRow,
  buildPhotoBatchesSync,
  buildGallerySections,
} from '@/services/photoBatchingService';

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
}

type FilterTab = 'All' | 'Favorites' | 'Marked' | 'Uploaded';

export const PhotoSelectionGalleryScreen: React.FC = () => {
  const navigation = useNavigation<AppNavigationProp>();
  const route = useRoute<RouteProp<AppStackParamList, 'PhotoSelectionGallery'>>();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

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
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isActionsModalVisible, setIsActionsModalVisible] = useState(false);

  // Uploading state
  const isUploadingRef = React.useRef(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    filename?: string;
    bytePercentage?: number;
  } | null>(null);
  const [uploadingPhotoIds, setUploadingPhotoIds] = useState<Set<string>>(new Set());
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [favoritePhotoIds, setFavoritePhotoIds] = useState<Set<string>>(new Set());
  const [isFavoritesLoaded, setIsFavoritesLoaded] = useState(false);

  // Photos ref to access latest photo data inside long-running async workers without stale closures
  const photosRef = React.useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // All Upload Queue & Session State
  const allUploadQueueRef = React.useRef<string[]>([]);
  const allUploadFailedIdsRef = React.useRef<Set<string>>(new Set());
  const isAllUploadActiveRef = React.useRef(false);
  const [isAllUploadActive, setIsAllUploadActive] = useState(false);
  const isAllUploadPausedRef = React.useRef(false);
  const [isAllUploadPaused, setIsAllUploadPaused] = useState(false);
  const isAllUploadWorkerRunningRef = React.useRef(false);
  const currentUploadControlRef = React.useRef<UploadCancellationControl | null>(null);
  const currentUploadingPhotoIdRef = React.useRef<string | null>(null);
  const processAllUploadQueueRef = React.useRef<() => void>(() => {});

  // Dedicated cleanup effect for All Upload session on unmount
  useEffect(() => {
    const failedIds = allUploadFailedIdsRef.current;
    return () => {
      isAllUploadActiveRef.current = false;
      isAllUploadPausedRef.current = false;
      if (currentUploadControlRef.current) {
        currentUploadControlRef.current.cancel();
        currentUploadControlRef.current = null;
      }
      allUploadQueueRef.current = [];
      failedIds.clear();
      isAllUploadWorkerRunningRef.current = false;
      currentUploadingPhotoIdRef.current = null;
    };
  }, []);

  // Floating Dock Animation & Favorite Logic
  const [dockSlideAnim] = useState(() => new Animated.Value(0));
  const [progressAnim] = useState(() => new Animated.Value(0));

  // Restore favorited photos from local storage on mount
  useEffect(() => {
    let isMounted = true;
    async function loadFavorites() {
      try {
        const savedIds = await storageService.getFavoritePhotoIds();
        if (isMounted && savedIds && savedIds.length > 0) {
          setFavoritePhotoIds(new Set(savedIds));
        }
      } catch (error) {
        console.error('[Gallery] Failed to load favorite photo IDs from storage:', error);
      } finally {
        if (isMounted) {
          setIsFavoritesLoaded(true);
        }
      }
    }
    loadFavorites();
    return () => {
      isMounted = false;
    };
  }, []);

  // Save favorite photo IDs to local storage whenever they change (after hydration)
  useEffect(() => {
    if (!isFavoritesLoaded) {
      return; // Prevent saving empty state before hydration completes
    }
    const idsArray = Array.from(favoritePhotoIds);
    storageService.setFavoritePhotoIds(idsArray).catch(error => {
      console.error('[Gallery] Failed to save favorite photo IDs:', error);
    });
  }, [favoritePhotoIds, isFavoritesLoaded]);

  // Subscribe to real-time DCIM folder changes
  useEffect(() => {
    let isMounted = true;

    // Run initial scan to guarantee initial loading lifecycle finishes even if folder is empty
    scanDcimEntephotoPhotos()
      .then(scanned => {
        if (!isMounted) return;
        setPhotos(scanned);
        setIsInitialLoading(false);
      })
      .catch(err => {
        console.error('[Gallery] Initial scan failed:', err);
        if (isMounted) {
          setIsInitialLoading(false);
        }
      });

    const unsubscribe = subscribeToDcimPhotos(dcimPhotos => {
      if (!isMounted) return;
      setIsInitialLoading(false);
      setPhotos(prevPhotos => {
        if (prevPhotos.length === 0) {
          return dcimPhotos;
        }

        // Preserve user's local selections and object references across scans
        const prevMap = new Map<string, GalleryPhotoItem>();
        for (const p of prevPhotos) {
          prevMap.set(p.id, p);
          if (p.uri) {
            prevMap.set(p.uri, p);
          }
        }

        const merged = dcimPhotos.map(item => {
          const existing = prevMap.get(item.id) || prevMap.get(item.uri);
          if (existing) {
            // Keep exactly the same object reference to prevent re-renders
            return existing;
          }
          return item;
        });

        // Ensure array identity is preserved if strictly equal
        if (
          merged.length === prevPhotos.length &&
          merged.every((item, i) => item === prevPhotos[i])
        ) {
          return prevPhotos;
        }

        // If All Upload is active, append newly arriving unuploaded photos to the queue
        if (isAllUploadActiveRef.current) {
          let hasNewQueueItems = false;
          merged.forEach(p => {
            if (
              p.status !== 'uploaded' &&
              !allUploadFailedIdsRef.current.has(p.id) &&
              !allUploadQueueRef.current.includes(p.id) &&
              currentUploadingPhotoIdRef.current !== p.id
            ) {
              console.log(`[AllUpload] Appending new arrival to queue: ${p.filename || p.id}`);
              allUploadQueueRef.current.push(p.id);
              hasNewQueueItems = true;
            }
          });
          if (hasNewQueueItems && !isAllUploadPausedRef.current) {
            processAllUploadQueueRef.current?.();
          }
        }

        return merged;
      });
    }, 2000);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Manual rescan handler
  const handleManualRescan = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const scanned = await scanDcimEntephotoPhotos();
      setPhotos(scanned);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Dynamic live counts based on real photos
  const totalCount = photos.length;

  const selectedCount = useMemo(() => {
    return selectedPhotoIds.size;
  }, [selectedPhotoIds]);

  const favoriteCount = favoritePhotoIds.size;

  const newCount = useMemo(() => {
    return photos.filter(p => p.status === 'new').length;
  }, [photos]);

  const markedCount = useMemo(() => {
    return photos.filter(p => p.status === 'marked').length;
  }, [photos]);

  const uploadedCount = useMemo(() => {
    return photos.filter(p => p.status === 'uploaded').length;
  }, [photos]);

  const unuploadedCount = useMemo(() => {
    return photos.filter(p => p.status !== 'uploaded').length;
  }, [photos]);

  // Filtered Photo List (Only recompute on selection/favorite changes when activeFilter is 'Marked' or 'Favorites')
  const filteredPhotos = useMemo(() => {
    switch (activeFilter) {
      case 'Favorites':
        return photos.filter(p => favoritePhotoIds.has(p.id));
      case 'Marked':
        return photos.filter(p => p.status === 'marked');
      case 'Uploaded':
        return photos.filter(p => p.status === 'uploaded');
      case 'All':
      default:
        return photos;
    }
  }, [photos, activeFilter, favoritePhotoIds]);

  /**
   * Gallery batches — computed from date-based photo batching.
   * Runs sequentially in memory to group photos by date.
   */
  const activeBatches = useMemo<RuntimeBatch[]>(() => {
    return buildPhotoBatchesSync(filteredPhotos);
  }, [filteredPhotos]);

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

  const toggleFavoritePhoto = useCallback((id: string) => {
    setFavoritePhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Toggle Photo Selection (unrestricted selection count)
  const togglePhotoSelection = useCallback(
    (id: string) => {
      const targetPhoto = photos.find(p => p.id === id);
      if (targetPhoto && targetPhoto.status === 'uploaded') {
        return; // Uploaded photos cannot be selected for upload
      }

      setSelectedPhotoIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [photos],
  );

  // Toggle Select All photos within a specific batch (unrestricted selection count)
  const toggleBatchSelection = useCallback((batch: RuntimeBatch) => {
    setSelectedPhotoIds(prev => {
      const selectableIds = batch.photos.filter(p => p.status !== 'uploaded').map(p => p.id);
      if (selectableIds.length === 0) return prev;

      const allSelected = selectableIds.every(id => prev.has(id));
      const next = new Set(prev);
      selectableIds.forEach(id => {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }, []);

  // Open Gallery Actions Sheet
  const handleMoreOptions = useCallback(() => {
    setIsActionsModalVisible(true);
  }, []);

  // Select All Photos (unrestricted selection count)
  const handleSelectAll = useCallback(() => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      filteredPhotos.forEach(p => {
        if (p.status !== 'uploaded') {
          next.add(p.id);
        }
      });
      return next;
    });
    setIsActionsModalVisible(false);
  }, [filteredPhotos]);

  // Select All New Photos (unrestricted selection count)
  const handleSelectAllNew = useCallback(() => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      filteredPhotos.forEach(p => {
        if (p.status === 'new') {
          next.add(p.id);
        }
      });
      return next;
    });
    setIsActionsModalVisible(false);
  }, [filteredPhotos]);

  // Invert Selection (unrestricted selection count)
  const handleInvertSelection = useCallback(() => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      filteredPhotos.forEach(p => {
        if (p.status === 'uploaded') return;
        if (prev.has(p.id)) {
          next.delete(p.id);
        } else {
          next.add(p.id);
        }
      });
      return next;
    });
    setIsActionsModalVisible(false);
  }, [filteredPhotos]);

  // Clear Selection
  const handleClearSelection = useCallback(() => {
    setSelectedPhotoIds(new Set());
    setIsActionsModalVisible(false);
  }, []);

  // Batch Delete Selected Photos
  const handleDeleteSelectedPhotos = useCallback(() => {
    const selectedPhotos = photos.filter(p => selectedPhotoIds.has(p.id));
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

            const successIds = new Set<string>();
            const successUris = new Set<string>();
            let failCount = 0;

            // Delete files from storage
            await Promise.all(
              selectedPhotos.map(async photo => {
                try {
                  await deleteLocalPhoto(photo.uri);
                  successIds.add(photo.id);
                  successUris.add(photo.uri);
                } catch (e) {
                  console.error('[GalleryActions] Failed to delete photo file:', photo.uri, e);
                  failCount++;
                }
              }),
            );

            // Clear ONLY successful deleted IDs from selection and favorite sets
            setSelectedPhotoIds(prev => {
              const next = new Set(prev);
              successIds.forEach(id => next.delete(id));
              return next;
            });
            setFavoritePhotoIds(prev => {
              const next = new Set(prev);
              successIds.forEach(id => next.delete(id));
              return next;
            });

            // Update state ONLY for successful deletions
            setPhotos(prev => prev.filter(p => !successIds.has(p.id) && !successUris.has(p.uri)));

            if (failCount === 0) {
              Alert.alert(
                'Photos Deleted 🗑️',
                `Successfully deleted ${successIds.size} photo${successIds.size > 1 ? 's' : ''} from local storage.`,
              );
            } else {
              Alert.alert(
                'Partial Deletion',
                `Successfully deleted ${successIds.size} photo${successIds.size !== 1 ? 's' : ''}, but ${failCount} failed to delete and remain selected.`,
              );
            }
          },
        },
      ],
    );
  }, [photos, selectedPhotoIds]);

  // Rescan Trigger from Action Sheet
  const handleRescanFromSheet = useCallback(async () => {
    setIsActionsModalVisible(false);
    await handleManualRescan();
  }, [handleManualRescan]);

  // ── ALL UPLOAD QUEUE WORKER & CONTROLLER ──

  // Process the All Upload queue sequentially one photo at a time
  const processAllUploadQueue = useCallback(async () => {
    if (isAllUploadWorkerRunningRef.current || !isAllUploadActiveRef.current) {
      return;
    }

    isAllUploadWorkerRunningRef.current = true;

    try {
      while (isAllUploadActiveRef.current && !isAllUploadPausedRef.current) {
        if (allUploadQueueRef.current.length === 0) {
          console.log(
            '[AllUpload] Queue empty. Remaining in active state for future new photos...',
          );
          setUploadProgress(null);
          break;
        }

        const nextPhotoId = allUploadQueueRef.current.shift()!;
        const photo = photosRef.current.find(p => p.id === nextPhotoId);

        // Skip if photo was removed or already uploaded
        if (!photo || photo.status === 'uploaded') {
          continue;
        }

        currentUploadingPhotoIdRef.current = photo.id;
        setUploadingPhotoIds(prev => new Set(prev).add(photo.id));

        const cancelControl = new UploadCancellationControl();
        currentUploadControlRef.current = cancelControl;

        progressAnim.setValue(0);
        setUploadProgress({
          current: 1,
          total: allUploadQueueRef.current.length + 1,
          filename: photo.filename,
          bytePercentage: 0,
        });

        isUploadingRef.current = true;
        setIsUploading(true);

        try {
          let lastStateUpdate = 0;
          await uploadSinglePhoto(
            eventId,
            photo,
            null,
            percentage => {
              Animated.timing(progressAnim, {
                toValue: percentage,
                duration: 200,
                useNativeDriver: false,
              }).start();

              const now = Date.now();
              if (now - lastStateUpdate > 250 || percentage >= 99.9) {
                lastStateUpdate = now;
                setUploadProgress(prev => (prev ? { ...prev, bytePercentage: percentage } : prev));
              }
            },
            cancelControl,
          );

          if (!isAllUploadActiveRef.current) {
            return;
          }

          progressAnim.setValue(100);
          setUploadProgress(prev => (prev ? { ...prev, bytePercentage: 100 } : prev));
          console.log(`[AllUpload] Photo ${photo.filename || photo.id} uploaded successfully.`);

          setPhotos(prev =>
            prev.map(p =>
              p.id === photo.id || p.uri === photo.uri
                ? { ...p, selected: false, status: 'uploaded' }
                : p,
            ),
          );

          setSelectedPhotoIds(prev => {
            if (prev.has(photo.id)) {
              const next = new Set(prev);
              next.delete(photo.id);
              return next;
            }
            return prev;
          });
        } catch (err: any) {
          if (isUploadCancelledError(err) || cancelControl.isCancelled) {
            console.log(`[AllUpload] Photo ${photo.filename || photo.id} upload cancelled.`);
            if (isAllUploadActiveRef.current) {
              allUploadQueueRef.current.unshift(photo.id);
            }
            break;
          } else {
            const errorMsg = err?.message || 'Upload failed';
            console.error(
              `[AllUpload] Photo ${photo.filename || photo.id} skipped due to error:`,
              errorMsg,
            );
            allUploadFailedIdsRef.current.add(photo.id);
          }
        } finally {
          currentUploadingPhotoIdRef.current = null;
          currentUploadControlRef.current = null;
          if (isAllUploadActiveRef.current) {
            setUploadingPhotoIds(prev => {
              const next = new Set(prev);
              next.delete(photo.id);
              return next;
            });
          }
        }
      }
    } finally {
      isAllUploadWorkerRunningRef.current = false;
      if (
        !isAllUploadActiveRef.current ||
        allUploadQueueRef.current.length === 0 ||
        isAllUploadPausedRef.current
      ) {
        isUploadingRef.current = false;
        if (isAllUploadActiveRef.current) {
          setIsUploading(false);
        }
      }
      // If resumed while the worker was unwinding the previous cancelled photo, re-trigger processing
      if (
        isAllUploadActiveRef.current &&
        !isAllUploadPausedRef.current &&
        allUploadQueueRef.current.length > 0
      ) {
        processAllUploadQueueRef.current?.();
      }
    }
  }, [eventId, progressAnim]);

  // Keep processAllUploadQueueRef updated with the latest callback reference
  useEffect(() => {
    processAllUploadQueueRef.current = processAllUploadQueue;
  }, [processAllUploadQueue]);

  // Handler called when user confirms All Upload from GalleryActionsSheet
  const startAllUpload = useCallback(() => {
    setIsActionsModalVisible(false);

    if (isUploadingRef.current && !isAllUploadActiveRef.current) {
      Alert.alert('Upload in Progress', 'Please wait for the current upload to finish.');
      return;
    }

    if (!eventId || !isValidObjectId(eventId)) {
      Alert.alert(
        'Invalid Event ID',
        'No valid 24-character hex event ID is associated with this session.',
      );
      return;
    }

    isAllUploadActiveRef.current = true;
    setIsAllUploadActive(true);
    isAllUploadPausedRef.current = false;
    setIsAllUploadPaused(false);

    // Initial population: every photo in the entire gallery where status !== 'uploaded'
    const unuploaded = photosRef.current.filter(p => p.status !== 'uploaded');
    allUploadFailedIdsRef.current.clear();
    allUploadQueueRef.current = unuploaded.map(p => p.id);

    console.log(
      `[AllUpload] Session started with ${allUploadQueueRef.current.length} unuploaded photos.`,
    );

    processAllUploadQueue();
  }, [eventId, processAllUploadQueue]);

  // Pause All Upload session
  const pauseAllUpload = useCallback(() => {
    if (!isAllUploadActiveRef.current || isAllUploadPausedRef.current) {
      return;
    }

    console.log('[AllUpload] Pausing All Upload session...');
    isAllUploadPausedRef.current = true;
    setIsAllUploadPaused(true);

    // Cancel active upload task if one is currently in flight
    if (currentUploadControlRef.current) {
      currentUploadControlRef.current.cancel();
    }

    // Re-queue the active photo ID to the front of the queue if not already there
    if (currentUploadingPhotoIdRef.current) {
      const activeId = currentUploadingPhotoIdRef.current;
      if (!allUploadQueueRef.current.includes(activeId)) {
        allUploadQueueRef.current.unshift(activeId);
      }
    }

    // Reset progress display
    setUploadProgress(null);
    progressAnim.setValue(0);
    isUploadingRef.current = false;
    setIsUploading(false);
  }, [progressAnim]);

  // Resume All Upload session
  const resumeAllUpload = useCallback(() => {
    if (!isAllUploadActiveRef.current || !isAllUploadPausedRef.current) {
      return;
    }

    console.log('[AllUpload] Resuming All Upload session...');
    isAllUploadPausedRef.current = false;
    setIsAllUploadPaused(false);

    // Resume processing existing queue (the previously paused photo is at the front)
    processAllUploadQueue();
  }, [processAllUploadQueue]);

  // ── CORE UPLOAD BATCH HANDLER ──
  // This single function owns the upload process to strictly prevent concurrent upload bugs.
  const executeUploadBatch = useCallback(
    async (batchToUpload: GalleryPhotoItem[], showConfirmation: boolean = true) => {
      if (isAllUploadActiveRef.current) {
        Alert.alert(
          'All Upload Active',
          'An All Upload session is currently active. Manual uploads are disabled while All Upload is running.',
        );
        return;
      }

      if (isUploadingRef.current) {
        console.warn('[PhotoGallery] Upload already in progress. Ignoring request.');
        return;
      }

      if (!eventId || !isValidObjectId(eventId)) {
        Alert.alert(
          'Invalid Event ID',
          'No valid 24-character hex event ID is associated with this session.',
        );
        return;
      }

      if (batchToUpload.length === 0) {
        Alert.alert('No Photos', 'No eligible photos to upload.');
        return;
      }

      const runUploads = async () => {
        // Double-check the lock inside the async callback (in case of double taps on the Alert)
        if (isUploadingRef.current) return;

        isUploadingRef.current = true;
        setIsUploading(true);

        const total = batchToUpload.length;
        let successCount = 0;
        let failCount = 0;
        const failReasons: string[] = [];

        console.log(`[PhotoGallery] Starting batch upload of ${total} photos.`);
        setUploadProgress({ current: 0, total });

        try {
          for (let i = 0; i < total; i++) {
            const photo = batchToUpload[i];
            console.log(`[PhotoGallery] Uploading photo ${i + 1}/${total}: ${photo.filename}`);

            // Reset progress line for the new photo
            progressAnim.setValue(0);

            setUploadProgress({
              current: i + 1,
              total,
              filename: photo.filename,
              bytePercentage: 0,
            });
            setUploadingPhotoIds(prev => new Set(prev).add(photo.id));

            try {
              let lastStateUpdate = 0;
              await uploadSinglePhoto(eventId, photo, null, percentage => {
                // Smoothly animate the bar
                Animated.timing(progressAnim, {
                  toValue: percentage,
                  duration: 200,
                  useNativeDriver: false,
                }).start();

                // Throttle full React state updates to avoid unnecessary gallery re-renders
                const now = Date.now();
                if (now - lastStateUpdate > 250 || percentage >= 99.9) {
                  lastStateUpdate = now;
                  setUploadProgress(prev =>
                    prev ? { ...prev, bytePercentage: percentage } : prev,
                  );
                }
              });

              // Ensure we show 100% when success is confirmed
              progressAnim.setValue(100);
              setUploadProgress(prev => (prev ? { ...prev, bytePercentage: 100 } : prev));

              successCount++;
              console.log(`[PhotoGallery] Photo ${photo.filename} uploaded successfully.`);

              // Mark individual photo as uploaded immediately upon success
              setPhotos(prev =>
                prev.map(p =>
                  p.id === photo.id || p.uri === photo.uri
                    ? { ...p, selected: false, status: 'uploaded' }
                    : p,
                ),
              );
              setSelectedPhotoIds(prev => {
                const next = new Set(prev);
                next.delete(photo.id);
                return next;
              });
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
        } finally {
          // ALWAYS release the lock
          isUploadingRef.current = false;
          setIsUploading(false);
          setUploadProgress(null);
          console.log(
            `[PhotoGallery] Batch complete. Success: ${successCount}, Failed: ${failCount}`,
          );

          if (failCount === 0) {
            Alert.alert(
              'Upload Complete! 🚀',
              `Successfully uploaded ${successCount} photo${successCount !== 1 ? 's' : ''} to "${eventTitle}".`,
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
        }
      };

      if (showConfirmation) {
        Alert.alert(
          'Upload Photos',
          `Ready to upload ${batchToUpload.length} selected photo${batchToUpload.length > 1 ? 's' : ''} to "${eventTitle}"? Each photo is processed independently.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: `Upload (${batchToUpload.length})`,
              style: 'default',
              onPress: runUploads,
            },
          ],
        );
      } else {
        await runUploads();
      }
    },
    [eventId, eventTitle, progressAnim],
  );

  // Upload Selected Photos (Gallery Bulk Upload)
  const handleUploadPhotos = useCallback(() => {
    if (isUploadingRef.current) return;

    const selectedPhotos = photos.filter(
      p => selectedPhotoIds.has(p.id) && p.status !== 'uploaded',
    );

    if (selectedPhotos.length === 0) {
      Alert.alert(
        'No Photos Selected',
        'Please tap on the photos you wish to mark and upload to the event cloud.',
      );
      return;
    }

    executeUploadBatch(selectedPhotos, true);
  }, [photos, selectedPhotoIds, executeUploadBatch]);

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

  // Upload Single Photo (Thin wrapper for the viewer)
  const handleUploadSinglePhoto = useCallback(
    (photo: GalleryPhotoItem) => {
      if (photo.status === 'uploaded') return;
      // Do not show an alert prompt when uploading a single photo directly from the viewer
      executeUploadBatch([photo], false);
    },
    [executeUploadBatch],
  );

  // Floating Dock Animation & Favorite Logic

  useEffect(() => {
    if (selectedCount > 0 || isUploading || isAllUploadActive) {
      Animated.spring(dockSlideAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 24,
        stiffness: 250,
      }).start();
    } else {
      Animated.timing(dockSlideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [selectedCount, isUploading, isAllUploadActive, dockSlideAnim]);

  useEffect(() => {
    if (!isUploading) {
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
    }
  }, [isUploading, progressAnim]);

  const selectedAreAllFavorites = useMemo(() => {
    if (selectedPhotoIds.size === 0) return false;
    for (const id of selectedPhotoIds) {
      if (!favoritePhotoIds.has(id)) return false;
    }
    return true;
  }, [selectedPhotoIds, favoritePhotoIds]);

  const handleToggleFavoriteSelected = useCallback(() => {
    setFavoritePhotoIds(prev => {
      const next = new Set(prev);
      const toRemove = selectedAreAllFavorites;
      selectedPhotoIds.forEach(id => {
        if (toRemove) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }, [selectedPhotoIds, selectedAreAllFavorites]);

  // ── Render: Single Grid Tile (shared for single, batch_photo row types) ──
  // Replaced inline renderPhotoTile with MemoizedPhotoTile

  // ── Render: Batch Section Header (SectionList) ───────────────────────────
  const renderSectionHeader = useCallback(
    ({ section }: { section: GalleryBatchSection }) => {
      return (
        <MemoizedBatchHeader
          section={section}
          isDark={isDark}
          selectedPhotoIds={selectedPhotoIds}
          onToggleBatchSelection={toggleBatchSelection}
        />
      );
    },
    [isDark, selectedPhotoIds, toggleBatchSelection],
  );

  // ── Render: Section Item (3-Column Grid Row for all batch photos) ──────────
  const renderSectionItem = useCallback(
    ({ item }: { item: GallerySectionRow }) => {
      if (item.type !== 'grid_row') return null;

      return (
        <MemoizedGridRow
          item={item}
          uploadingPhotoIds={uploadingPhotoIds}
          selectedPhotoIds={selectedPhotoIds}
          favoritePhotoIds={favoritePhotoIds}
          onOpenViewer={flatIndex => {
            setViewerInitialIndex(flatIndex);
            setViewerVisible(true);
          }}
          onToggleSelection={togglePhotoSelection}
        />
      );
    },
    [uploadingPhotoIds, selectedPhotoIds, favoritePhotoIds, togglePhotoSelection],
  );

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* ── 1. HEADER ROW ── */}
        <View style={styles.headerRow}>
          {/* Tactile Back Button (Matching App Header Style) */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={handleBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[
              styles.backButton,
              {
                backgroundColor: isDark ? '#1A1A1E' : 'rgba(234, 223, 212, 0.7)',
                borderColor: isDark ? '#2E2E36' : '#DFCFC2',
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

            {/* More Options Button */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleMoreOptions}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[
                styles.moreOptionsButton,
                {
                  backgroundColor: isDark ? '#1A1A1E' : 'rgba(234, 223, 212, 0.7)',
                  borderColor: isDark ? '#2E2E36' : '#DFCFC2',
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
              { key: 'Favorites' as FilterTab, label: `Favorites (${favoriteCount})` },
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

        {/* ── TOP LOADING SPINNER (Visible during initial photo scanning) ── */}
        {isInitialLoading && (
          <View style={styles.topSpinnerContainer}>
            <ActivityIndicator size="small" color={isDark ? '#818CF8' : '#6366F1'} />
          </View>
        )}

        {/* ── 3. PHOTO GRID (SectionList, one section per PhotoBatch) ── */}
        <SectionList<GallerySectionRow, GalleryBatchSection>
          sections={gallerySections}
          extraData={useMemo(
            () => [selectedPhotoIds, favoritePhotoIds, isInitialLoading],
            [selectedPhotoIds, favoritePhotoIds, isInitialLoading],
          )}
          keyExtractor={item => item.rowKey}
          renderItem={renderSectionItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={[
            styles.gridContentContainer,
            { paddingBottom: gallerySections.length === 0 ? 0 : insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10} // 10 rows = 30 photos, easily fills any phone screen without huge initial blocking
          maxToRenderPerBatch={10}
          windowSize={5} // 5 screens of content (default is 21), reduces memory usage for heavy images
          removeClippedSubviews={true}
          scrollEnabled={gallerySections.length > 0}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={() => {
            if (isInitialLoading) {
              return null;
            }

            if (activeFilter === 'Favorites') {
              return (
                <View style={styles.emptyContainer}>
                  <View
                    style={[
                      styles.emptyIconCircle,
                      {
                        backgroundColor: isDark ? '#2E221D' : '#FFE5D9',
                        borderColor: isDark ? '#3E2F28' : '#161616',
                      },
                    ]}
                  >
                    <Heart size={34} color="#FF4D4D" fill="#FF4D4D" strokeWidth={0} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                    No Favorite Photos
                  </Text>
                  <Text style={[styles.emptySubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                    Tap the heart icon on any photo in the viewer {'\n'} to add it to your
                    favorites.
                  </Text>
                </View>
              );
            }

            return (
              <View
                style={[
                  styles.emptyContainer,
                  {
                    paddingBottom: Math.max(insets.bottom, 20),
                  },
                ]}
              >
                {/* Illustration */}
                <View
                  style={[
                    styles.emptyIllustrationContainer,
                    {
                      height: Math.min(windowHeight * 0.28, 220),
                      width: Math.min(windowHeight * 0.28, 220),
                    },
                  ]}
                >
                  <Image
                    source={require('../../../assets/galleryScreen/clay_folder_illustration.jpg')}
                    style={styles.emptyIllustration}
                    resizeMode="contain"
                  />
                </View>

                {/* Main Message */}
                <Text style={[styles.emptyTitle, { color: isDark ? '#F4F4F5' : '#1A1A1E' }]}>
                  No photos found
                </Text>
                <Text style={[styles.emptySubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                  We couldn&apos;t find any photos in this folder.
                </Text>

                {/* Helpful Information Card */}
                <View
                  style={[
                    styles.emptyInfoCard,
                    {
                      backgroundColor: isDark ? '#1F1F24' : '#FFF0E6',
                      borderColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFE3D4',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.emptyInfoIconWrapper,
                      { backgroundColor: isDark ? '#332924' : '#FFD9C6' },
                    ]}
                  >
                    <Info size={22} color={isDark ? '#FFA07A' : '#D97757'} strokeWidth={2.5} />
                  </View>
                  <View style={styles.emptyInfoTextGroup}>
                    <Text
                      style={[
                        styles.emptyInfoText,
                        {
                          color: isDark ? '#E4E4E5' : '#2D2825',
                          fontFamily: FONTS.plusJakartaSans.bold,
                          marginBottom: 2,
                        },
                      ]}
                    >
                      Make sure your camera is connected
                    </Text>
                    <Text style={[styles.emptyInfoText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                      and photos are saved to folder.
                    </Text>
                  </View>
                </View>

                {/* Primary Action Button */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleManualRescan}
                  disabled={isRefreshing}
                  style={[
                    styles.emptyRefreshBtn,
                    {
                      backgroundColor: isDark ? '#26262E' : '#1A1A1E',
                    },
                  ]}
                >
                  <RefreshCw
                    size={20}
                    color="#FFFFFF"
                    strokeWidth={2.2}
                    style={{ marginRight: 12 }}
                  />
                  <Text style={styles.emptyRefreshBtnText}>
                    {isRefreshing ? 'Scanning...' : 'Rescan Photos'}
                  </Text>
                  <ArrowRight
                    size={20}
                    color="#FFFFFF"
                    strokeWidth={2.2}
                    style={{ marginLeft: 12 }}
                  />
                </TouchableOpacity>
              </View>
            );
          }}
        />

        {/* ── 4. FLOATING BOTTOM ACTION DOCK ── */}
        <Animated.View
          style={[
            styles.floatingDockContainer,
            {
              bottom: Math.max(insets.bottom, 16) + 8,
              opacity: dockSlideAnim,
              transform: [
                {
                  translateY: dockSlideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [100, 0],
                  }),
                },
              ],
            },
          ]}
          pointerEvents={
            selectedCount > 0 || isUploading || isAllUploadActive ? 'box-none' : 'none'
          }
        >
          <View
            style={[
              styles.floatingDockSurface,
              {
                backgroundColor: isDark ? '#222228' : '#FFFFFF',
                borderColor: isDark ? '#3A3A44' : '#E8E8E8',
              },
            ]}
          >
            {isAllUploadActive ? (
              <View style={styles.dockUploadStateContainer}>
                {/* Top Row: Title + Progress/Status + Pause/Resume Button */}
                <View style={styles.dockUploadTopRow}>
                  <View style={styles.dockUploadTopLeft}>
                    <Cloud
                      size={18}
                      color={isAllUploadPaused ? (isDark ? '#F59E0B' : '#D97706') : '#6366F1'}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[styles.dockProgressTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                    >
                      All Upload
                    </Text>
                    {isAllUploadPaused ? (
                      <View
                        style={[
                          styles.dockStatusBadge,
                          { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.18)' : '#FEF3C7' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dockStatusBadgeText,
                            { color: isDark ? '#FBBF24' : '#D97706' },
                          ]}
                        >
                          Paused
                        </Text>
                      </View>
                    ) : !isUploading && !uploadProgress ? (
                      <Text
                        style={[
                          styles.dockStatusIdleText,
                          { color: isDark ? '#A1A1AA' : '#71717A' },
                        ]}
                      >
                        • Waiting for new photos
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.dockAllUploadRightRow}>
                    {uploadProgress && (
                      <Text style={[styles.dockProgressTitle, { color: '#6366F1' }]}>
                        {uploadProgress.current} / {uploadProgress.total} photos
                      </Text>
                    )}
                  </View>
                </View>

                {/* Bottom Row */}
                <View style={styles.dockUploadBottomRow}>
                  {isAllUploadPaused ? (
                    <View style={styles.dockIdleBottomRow}>
                      <Text
                        style={[
                          styles.dockIdleBottomText,
                          { color: isDark ? '#A1A1AA' : '#71717A' },
                        ]}
                      >
                        Uploading paused. Tap Resume to continue.
                      </Text>
                    </View>
                  ) : !isUploading && !uploadProgress ? (
                    <View style={styles.dockIdleBottomRow}>
                      <Text
                        style={[
                          styles.dockIdleBottomText,
                          { color: isDark ? '#A1A1AA' : '#71717A' },
                        ]}
                      >
                        All current photos uploaded • Watching folder for new arrivals
                      </Text>
                    </View>
                  ) : (
                    <>
                      <View
                        style={[
                          styles.dockProgressBarTrack,
                          {
                            flex: 1,
                            backgroundColor: isDark ? '#1C1C21' : '#EAEAEA',
                            borderColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
                            borderWidth: 1,
                          },
                        ]}
                      >
                        <Animated.View
                          style={[
                            styles.dockProgressBarFill,
                            {
                              backgroundColor: '#6366F1',
                              width: progressAnim.interpolate({
                                inputRange: [0, 100],
                                outputRange: ['0%', '100%'],
                              }),
                            },
                          ]}
                        />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.dockProgressCount,
                          {
                            color: isDark ? '#A1A1AA' : '#71717A',
                            minWidth: 38,
                            flexShrink: 0,
                            textAlign: 'right',
                          },
                        ]}
                      >
                        {Math.round(uploadProgress?.bytePercentage || 0)}%
                      </Text>
                    </>
                  )}
                </View>
              </View>
            ) : isUploading ? (
              <View style={styles.dockUploadStateContainer}>
                {/* Top Row */}
                <View style={styles.dockUploadTopRow}>
                  <View style={styles.dockUploadTopLeft}>
                    <Cloud size={18} color="#6366F1" strokeWidth={2.2} />
                    <Text
                      style={[styles.dockProgressTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                    >
                      Uploading photos
                    </Text>
                  </View>
                  <Text style={[styles.dockProgressTitle, { color: '#6366F1' }]}>
                    {uploadProgress?.current || 1} / {uploadProgress?.total || 0} photos
                  </Text>
                </View>

                {/* Bottom Row */}
                <View style={styles.dockUploadBottomRow}>
                  <View
                    style={[
                      styles.dockProgressBarTrack,
                      {
                        flex: 1,
                        backgroundColor: isDark ? '#1C1C21' : '#EAEAEA',
                        borderColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <Animated.View
                      style={[
                        styles.dockProgressBarFill,
                        {
                          backgroundColor: '#6366F1',
                          width: progressAnim.interpolate({
                            inputRange: [0, 100],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dockProgressCount,
                      {
                        color: isDark ? '#A1A1AA' : '#71717A',
                        minWidth: 38,
                        flexShrink: 0,
                        textAlign: 'right',
                      },
                    ]}
                  >
                    {Math.round(uploadProgress?.bytePercentage || 0)}%
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.dockNormalStateContainer}>
                {/* Left Info: Icon Tile + Selected Counts */}
                <View style={styles.dockLeftSection}>
                  <View style={styles.dockThumbnailStackContainer}>
                    <View
                      style={[
                        styles.dockThumbnailUnderlay2,
                        { borderColor: isDark ? '#1C1C21' : '#FFFFFF' },
                      ]}
                    />
                    <View
                      style={[
                        styles.dockThumbnailUnderlay1,
                        { borderColor: isDark ? '#1C1C21' : '#FFFFFF' },
                      ]}
                    />
                    <View
                      style={[
                        styles.dockThumbnailTop,
                        {
                          borderColor: isDark ? '#1C1C21' : '#FFFFFF',
                          backgroundColor: isDark ? '#26262E' : '#F4F4F5',
                        },
                      ]}
                    >
                      <Images size={18} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={1.5} />
                      {selectedCount > 0 &&
                        Array.from(selectedPhotoIds)
                          .slice(0, 1)
                          .map(id => {
                            const photo = photos.find(p => p.id === id);
                            if (photo) {
                              return (
                                <ImageWithSkeleton
                                  key={photo.id}
                                  source={{ uri: photo.uri }}
                                  style={styles.dockThumbnailImage}
                                  resizeMode="cover"
                                />
                              );
                            }
                            return null;
                          })}
                    </View>
                  </View>

                  <View style={styles.dockTextStack}>
                    <Text
                      style={[
                        styles.dockSelectedCountText,
                        { color: isDark ? '#F4F4F5' : '#161616' },
                      ]}
                      numberOfLines={1}
                    >
                      {selectedCount} selected
                    </Text>
                    <Text
                      style={[styles.dockSecondaryText, { color: isDark ? '#A1A1AA' : '#71717A' }]}
                      numberOfLines={1}
                    >
                      Ready to upload
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.dockVerticalDivider,
                    { backgroundColor: isDark ? '#2E2E36' : '#E4E4E8' },
                  ]}
                />

                {/* Right Action: Action Buttons */}
                <View style={styles.dockRightSection}>
                  {/* Favorite Button */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handleToggleFavoriteSelected}
                    disabled={isUploading}
                    style={[
                      styles.dockActionButton,
                      {
                        backgroundColor: isDark ? '#262224' : '#FFF0F0',
                      },
                      isUploading && { opacity: 0.5 },
                    ]}
                  >
                    <Heart
                      size={16}
                      color={selectedAreAllFavorites ? '#FF5E3A' : '#FF7657'}
                      fill={selectedAreAllFavorites ? '#FF5E3A' : 'transparent'}
                      strokeWidth={2}
                    />
                    <Text
                      style={[
                        styles.dockActionText,
                        {
                          color: selectedAreAllFavorites ? '#FF5E3A' : '#FF7657',
                        },
                      ]}
                    >
                      Favorite
                    </Text>
                  </TouchableOpacity>

                  {/* Upload CTA Button */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={handleUploadPhotos}
                    disabled={isUploading || selectedCount === 0}
                    style={[
                      styles.dockUploadButton,
                      (isUploading || selectedCount === 0) && styles.dockUploadButtonDisabled,
                    ]}
                  >
                    <Cloud size={16} color="#FFFFFF" strokeWidth={2.2} />
                    <Text style={styles.dockUploadText}>Upload</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </Animated.View>

        {/* ── 5. FULL-SCREEN TWO-STAGE PHOTO VIEWER ── */}
        <FullScreenPhotoViewer
          visible={viewerVisible}
          photos={filteredPhotos}
          initialIndex={viewerInitialIndex}
          eventTitle={eventTitle}
          eventSubtitle={`${eventCategory} • ${eventDateFormatted}`}
          onClose={() => setViewerVisible(false)}
          onToggleMark={togglePhotoSelection}
          onToggleFavorite={toggleFavoritePhoto}
          favoritePhotoIds={favoritePhotoIds}
          onUploadPhoto={handleUploadSinglePhoto}
          onDeletePhoto={handleDeletePhoto}
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
          unuploadedCount={unuploadedCount}
          isAllUploadActive={isAllUploadActive}
          isAllUploadPaused={isAllUploadPaused}
          onRescan={handleRescanFromSheet}
          onSelectAll={handleSelectAll}
          onSelectAllNew={handleSelectAllNew}
          onInvertSelection={handleInvertSelection}
          onClearSelection={handleClearSelection}
          onUploadSelected={handleUploadFromSheet}
          onDeleteSelected={handleDeleteSelectedPhotos}
          onStartAllUpload={startAllUpload}
          onPauseAllUpload={pauseAllUpload}
          onResumeAllUpload={resumeAllUpload}
        />
      </SafeAreaView>
    </AppBackground>
  );
};

// ── Memoized Components for Scroll Performance ──

const MemoizedPhotoTile = React.memo(
  ({
    item,
    flatIndex,
    isUploading,
    isSelected,
    isFavorite,
    onOpenViewer,
    onToggleSelection,
  }: {
    item: GalleryPhotoItem;
    flatIndex: number;
    isUploading: boolean;
    isSelected: boolean;
    isFavorite: boolean;
    onOpenViewer: (idx: number) => void;
    onToggleSelection: (id: string) => void;
  }) => {
    // isSelected comes from props
    const isUploaded = item.status === 'uploaded';

    return (
      <View style={styles.gridCellContainer}>
        <Pressable
          onPress={() => onOpenViewer(flatIndex)}
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
          <ImageWithSkeleton
            source={{ uri: item.uri }}
            style={styles.photoImage}
            containerStyle={styles.photoImageContainer}
            resizeMode="cover"
          />

          {isFavorite && (
            <View style={styles.favoriteBadgeContainer}>
              <Heart size={16} color="#FFFFFF" fill="#FF4D4D" strokeWidth={1.8} />
            </View>
          )}

          {item.isRaw && (
            <View style={styles.rawBadgeContainer}>
              <Text style={styles.rawBadgeText}>RAW</Text>
            </View>
          )}

          <Pressable
            onPress={e => {
              e.stopPropagation();
              if (!isUploading && !isUploaded) {
                onToggleSelection(item.id);
              }
            }}
            hitSlop={10}
            disabled={isUploading || isUploaded}
            style={styles.selectionIndicatorContainer}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={`Select photo ${item.filename || item.id}`}
          >
            {isUploading ? (
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
  (prevProps, nextProps) => {
    return (
      prevProps.item === nextProps.item &&
      prevProps.isUploading === nextProps.isUploading &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isFavorite === nextProps.isFavorite &&
      prevProps.flatIndex === nextProps.flatIndex
    );
  },
);

const MemoizedGridRow = React.memo(
  ({
    item,
    uploadingPhotoIds,
    selectedPhotoIds,
    favoritePhotoIds,
    onOpenViewer,
    onToggleSelection,
  }: {
    item: Extract<GallerySectionRow, { type: 'grid_row' }>;
    uploadingPhotoIds: Set<string>;
    selectedPhotoIds: Set<string>;
    favoritePhotoIds: Set<string>;
    onOpenViewer: (idx: number) => void;
    onToggleSelection: (id: string) => void;
  }) => {
    return (
      <View style={styles.photoRowGroup}>
        {item.photos.map(({ photo, photoIndex }) => (
          <MemoizedPhotoTile
            key={photo.id}
            item={photo}
            flatIndex={photoIndex}
            isUploading={uploadingPhotoIds.has(photo.id)}
            isSelected={selectedPhotoIds.has(photo.id)}
            isFavorite={favoritePhotoIds.has(photo.id)}
            onOpenViewer={onOpenViewer}
            onToggleSelection={onToggleSelection}
          />
        ))}
        {item.photos.length < 3 &&
          Array.from({ length: 3 - item.photos.length }).map((_, i) => (
            <View key={`spacer-${i}`} style={styles.gridCellContainer} />
          ))}
      </View>
    );
  },
  (prev, next) => {
    // Check if photos changed
    if (prev.item.photos.length !== next.item.photos.length) return false;
    for (let i = 0; i < prev.item.photos.length; i++) {
      if (prev.item.photos[i].photo !== next.item.photos[i].photo) return false;
      if (prev.item.photos[i].photoIndex !== next.item.photos[i].photoIndex) return false;
    }

    // Check if uploading, selection, or favorite state changed specifically for photos in THIS row
    for (const { photo } of prev.item.photos) {
      const wasUploading = prev.uploadingPhotoIds.has(photo.id);
      const isUploading = next.uploadingPhotoIds.has(photo.id);
      if (wasUploading !== isUploading) return false;

      const wasSelected = prev.selectedPhotoIds.has(photo.id);
      const isSelected = next.selectedPhotoIds.has(photo.id);
      if (wasSelected !== isSelected) return false;

      const wasFavorite = prev.favoritePhotoIds.has(photo.id);
      const isFavorite = next.favoritePhotoIds.has(photo.id);
      if (wasFavorite !== isFavorite) return false;
    }

    return true;
  },
);

const MemoizedBatchHeader = React.memo(
  ({
    section,
    isDark,
    selectedPhotoIds,
    onToggleBatchSelection,
  }: {
    section: GalleryBatchSection;
    isDark: boolean;
    selectedPhotoIds: Set<string>;
    onToggleBatchSelection: (batch: RuntimeBatch) => void;
  }) => {
    const { title, batch } = section;
    const selectablePhotos = batch.photos.filter(p => p.status !== 'uploaded');
    const isAllBatchSelected =
      selectablePhotos.length > 0 && selectablePhotos.every(p => selectedPhotoIds.has(p.id));

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

        <View style={styles.batchHeaderTextBlock}>
          <View style={styles.batchHeaderTitleRow}>
            <Text style={[styles.batchHeaderLabel, { color: isDark ? '#F4F4F5' : '#161616' }]}>
              {title}
            </Text>
          </View>
        </View>

        {selectablePhotos.length > 0 && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onToggleBatchSelection(batch)}
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
  (prev, next) => {
    if (prev.isDark !== next.isDark) return false;
    if (prev.section.title !== next.section.title) return false;

    if (prev.section.batch.photos.length !== next.section.batch.photos.length) return false;
    for (let i = 0; i < prev.section.batch.photos.length; i++) {
      if (
        prev.selectedPhotoIds.has(prev.section.batch.photos[i].id) !==
        next.selectedPhotoIds.has(next.section.batch.photos[i].id)
      )
        return false;
      if (prev.section.batch.photos[i].status !== next.section.batch.photos[i].status) return false;
    }

    return true;
  },
);

MemoizedPhotoTile.displayName = 'MemoizedPhotoTile';
MemoizedGridRow.displayName = 'MemoizedGridRow';
MemoizedBatchHeader.displayName = 'MemoizedBatchHeader';

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
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  topSpinnerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
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
  favoriteBadgeContainer: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 3,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.6,
        shadowRadius: 2,
      },
      android: {
        elevation: 3,
      },
    }),
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
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
  emptyIllustrationContainer: {
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#D97757',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  emptyIllustration: {
    width: '100%',
    height: '100%',
  },
  emptyTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  emptySubtitle: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
    width: '100%',
    ...Platform.select({
      ios: {
        shadowColor: '#D97757',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 14,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  emptyInfoIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  emptyInfoTextGroup: {
    flex: 1,
  },
  emptyInfoText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 18,
    borderRadius: 32,
    width: '100%',
    marginBottom: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#1A1A1E',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  emptyRefreshBtnText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // ── 4. Floating Bottom Action Dock Styles ──
  floatingDockContainer: {
    position: 'absolute',
    left: 18,
    right: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  floatingDockSurface: {
    height: 74,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 56,
    borderWidth: 1,
    borderTopWidth: 1.5,
    overflow: 'hidden',
  },
  dockNormalStateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'space-between',
  },
  dockUploadStateContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  dockUploadTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dockUploadTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dockAllUploadRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dockStatusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 2,
  },
  dockStatusBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  dockStatusIdleText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
  },
  dockIdleBottomRow: {
    flex: 1,
    justifyContent: 'center',
  },
  dockIdleBottomText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11.5,
  },
  dockUploadBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dockProgressTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  dockProgressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  dockProgressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  dockProgressCount: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
  },
  dockLeftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    flex: 1,
  },
  dockThumbnailStackContainer: {
    width: 38,
    height: 38,
    marginRight: 14,
    marginLeft: 8,
    position: 'relative',
  },
  dockThumbnailUnderlay2: {
    position: 'absolute',
    top: -3,
    left: -4,
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: '#6B7280',
    transform: [{ rotate: '-8deg' }],
  },
  dockThumbnailUnderlay1: {
    position: 'absolute',
    top: -1,
    left: -2,
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: '#9CA3AF',
    transform: [{ rotate: '-4deg' }],
  },
  dockThumbnailTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dockThumbnailImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  dockTextStack: {
    justifyContent: 'center',
  },
  dockSelectedCountText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  dockSecondaryText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11.5,
    marginTop: 2,
  },
  dockVerticalDivider: {
    width: 1,
    height: 32,
    marginHorizontal: 12,
  },
  dockRightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dockActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 32,
    gap: 6,
  },
  dockActionText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13,
    fontWeight: '700',
  },
  dockUploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366F1', // Premium periwinkle purple
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 32,
    gap: 6,
  },
  dockUploadButtonDisabled: {
    opacity: 0.65,
  },
  dockUploadText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
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
