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
  Easing,
  Image,
  useWindowDimensions,
  StatusBar,
  InteractionManager,
  Modal,
  BackHandler,
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
  AlertTriangle,
  X,
  Square,
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
  PHOTO_STORAGE_DISPLAY_PATH,
  addPhotoScanListener,
  isPhotoScanInProgress,
  getPhotoScanSequenceId,
} from '@/services/localPhotoService';
import {
  uploadPreparedPhoto,
  UploadLookaheadPipeline,
  isValidObjectId,
  UploadCancellationControl,
  isUploadCancelledError,
  checkExistingPhotos,
} from '@/services/photoUploadService';
import { storageService } from '@/services/storageService';
import { notificationService } from '@/services/notifications/notificationService';
import { FullScreenPhotoViewer } from './components/FullScreenPhotoViewer';
import { GalleryActionsSheet } from './components/GalleryActionsSheet';
import { ClaymorphismLoader } from './components/ClaymorphismLoader';
import { Image as ExpoImage } from 'expo-image';
import { ImageWithSkeleton } from './components/ImageWithSkeleton';
import {
  RuntimeBatch,
  GalleryBatchSection,
  GallerySectionRow,
  buildPhotoBatchesSync,
  buildGallerySections,
} from '@/services/photoBatchingService';
import {
  useCameraConnection,
  GalleryCameraState,
  DiscoveryOutcome,
} from '@/services/cameraConnectionManager';
import { addPhotoSkippedListener } from 'entephoto-camera';

function isPhotoInUploadedSet(
  photo: { id: string; filename?: string; status?: string },
  uploadedSet: Set<string>,
): boolean {
  return (
    photo.status === 'uploaded' ||
    uploadedSet.has(photo.id) ||
    Boolean(photo.filename && uploadedSet.has(photo.filename))
  );
}

export type DisplayedCameraStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'searching'
  | 'permission_required'
  | 'camera_not_found'
  | 'not_connected';

function getDisplayedCameraStatus(
  connectionState: GalleryCameraState,
  discoveryOutcome: DiscoveryOutcome,
  isNotFound: boolean,
): DisplayedCameraStatus {
  switch (connectionState) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'permission_required':
      return 'permission_required';
    case 'searching':
      return 'searching';
    case 'disconnected':
    default:
      if (isNotFound || discoveryOutcome === 'not_found') {
        return 'camera_not_found';
      }
      return 'not_connected';
  }
}

function getCameraStatusStyle(status: DisplayedCameraStatus, isDark: boolean) {
  switch (status) {
    case 'connected':
      return {
        backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#D2F4E2',
        borderColor: isDark ? '#34D399' : '#10B981',
      };
    case 'reconnecting':
      return {
        backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7',
        borderColor: isDark ? '#FBBF24' : '#F59E0B',
      };
    case 'searching':
    case 'connecting':
      return {
        backgroundColor: isDark ? 'rgba(14, 165, 233, 0.2)' : '#E0F2FE',
        borderColor: isDark ? '#38BDF8' : '#0284C7',
      };
    case 'permission_required':
      return {
        backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7',
        borderColor: isDark ? '#FBBF24' : '#F59E0B',
      };
    case 'camera_not_found':
    case 'not_connected':
    default:
      return {
        backgroundColor: isDark ? 'rgba(239, 68, 68, 0.18)' : '#FEE2E2',
        borderColor: isDark ? '#F87171' : '#EF4444',
      };
  }
}

function getCameraStatusTextColor(status: DisplayedCameraStatus, isDark: boolean) {
  switch (status) {
    case 'connected':
      return isDark ? '#6EE7B7' : '#065F46';
    case 'reconnecting':
    case 'permission_required':
      return isDark ? '#FDE68A' : '#92400E';
    case 'searching':
    case 'connecting':
      return isDark ? '#BAE6FD' : '#0369A1';
    case 'camera_not_found':
    case 'not_connected':
    default:
      return isDark ? '#FCA5A5' : '#991B1B';
  }
}

function getCameraStatusLabel(status: DisplayedCameraStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'searching':
      return 'Searching…';
    case 'connecting':
      return 'Connecting…';
    case 'permission_required':
      return 'Permission Required';
    case 'camera_not_found':
      return 'Camera not found';
    case 'not_connected':
    default:
      return 'Not connected';
  }
}

function renderCameraStatusIndicator(status: DisplayedCameraStatus) {
  if (status === 'searching' || status === 'connecting') {
    return <ActivityIndicator size={9} color="#0284C7" style={{ marginRight: 6 }} />;
  }
  if (status === 'reconnecting') {
    return <ActivityIndicator size={9} color="#F59E0B" style={{ marginRight: 6 }} />;
  }
  let dotColor = '#EF4444';
  if (status === 'connected') {
    dotColor = '#10B981';
  } else if (status === 'permission_required') {
    dotColor = '#F59E0B';
  }

  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: dotColor,
        marginRight: 6,
      }}
    />
  );
}

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
  const topInset =
    Platform.OS === 'android' ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;
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
  const [isPhotoScanning, setIsPhotoScanning] = useState(() => isPhotoScanInProgress());
  const [hasCompletedInitialScan, setHasCompletedInitialScan] = useState(false);
  const [isInitialScanReady, setIsInitialScanReady] = useState(false);
  const latestAppliedScanSequenceRef = React.useRef<number>(0);
  const hasCompletedInitialScanRef = React.useRef(false);
  const isDockVisibleRef = React.useRef(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [initialScanError, setInitialScanError] = useState<string | null>(null);
  const [isActionsModalVisible, setIsActionsModalVisible] = useState(false);
  // True only during an explicit user-triggered Rescan (separate from initial loading).
  // Shows the ClaymorphismLoader as an overlay even when photos are already loaded.
  const [isRescanLoading, setIsRescanLoading] = useState(false);
  const isRescanInProgressRef = React.useRef(false);

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
  const [uploadedPhotoIds, setUploadedPhotoIds] = useState<Set<string>>(new Set());
  const uploadedPhotoIdsRef = React.useRef<Set<string>>(new Set());
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const selectedPhotoIdsRef = React.useRef(selectedPhotoIds);
  // eslint-disable-next-line react-hooks/refs
  selectedPhotoIdsRef.current = selectedPhotoIds;
  const [favoritePhotoIds, setFavoritePhotoIds] = useState<Set<string>>(new Set());
  const [isFavoritesLoaded, setIsFavoritesLoaded] = useState(false);

  // Photos and event refs to access latest data inside async callbacks without stale closures
  const photosRef = React.useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const eventIdRef = React.useRef(eventId);
  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  // Authoritative camera connection state from native manager
  const {
    connectionState: cameraConnectionState,
    cameraModel,
    discoveryOutcome,
    isNotFound,
    startSearch: startCameraSearch,
    reconcile: reconcileCameraState,
  } = useCameraConnection();

  // Keep camera discovery active while on Gallery screen
  useEffect(() => {
    startCameraSearch();
  }, [startCameraSearch]);

  const displayedCameraStatus = useMemo(
    () => getDisplayedCameraStatus(cameraConnectionState, discoveryOutcome, isNotFound),
    [cameraConnectionState, discoveryOutcome, isNotFound],
  );

  const canReconnect =
    displayedCameraStatus === 'camera_not_found' || displayedCameraStatus === 'not_connected';

  const handleReconnectPress = useCallback(() => {
    console.log('[Gallery] Reconnect button pressed — starting fresh camera discovery');
    startCameraSearch();
  }, [startCameraSearch]);

  // Smooth header title collapse when camera is not found to prevent layout overflow
  const isTitleHidden = displayedCameraStatus === 'camera_not_found';
  const [titleVisibilityAnim] = useState(() => new Animated.Value(isTitleHidden ? 0 : 1));

  useEffect(() => {
    Animated.timing(titleVisibilityAnim, {
      toValue: isTitleHidden ? 0 : 1,
      duration: 250,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: false,
    }).start();
  }, [isTitleHidden, titleVisibilityAnim]);

  // Track if a camera connection has ever been established in this session.
  // This prevents showing the disconnect warning during normal initial discovery.
  const [prevConnectionState, setPrevConnectionState] = useState(cameraConnectionState);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(cameraConnectionState === 'connected');

  if (cameraConnectionState !== prevConnectionState) {
    setPrevConnectionState(cameraConnectionState);
    if (cameraConnectionState === 'connected') {
      setHasConnectedOnce(true);
    }
  }

  // Non-blocking disconnect banner is visible only if we lost an established connection
  const isDisconnectBannerVisible =
    hasConnectedOnce &&
    (cameraConnectionState === 'disconnected' ||
      cameraConnectionState === 'reconnecting' ||
      cameraConnectionState === 'searching' ||
      cameraConnectionState === 'permission_required');

  const isRetryingCamera =
    cameraConnectionState === 'connecting' || cameraConnectionState === 'reconnecting';

  // Safe retry connection handler: uses existing connection manager reconciliation
  const handleRetryCameraConnection = useCallback(() => {
    if (isRetryingCamera) return;
    console.log('[Gallery] User tapped Retry Camera Connection — reconciling state');
    try {
      reconcileCameraState();
    } catch (e) {
      console.warn('[Gallery] reconcileCameraState failed, calling startCameraSearch:', e);
      startCameraSearch();
    }
  }, [isRetryingCamera, reconcileCameraState, startCameraSearch]);

  // Non-blocking notification for skipped unsupported camera files (e.g. Sony .ARW)
  const [skippedNotice, setSkippedNotice] = useState<{
    id: string;
    title: string;
    message: string;
    count: number;
  } | null>(null);
  const skippedDismissTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismissSkippedNotice = useCallback(() => {
    if (skippedDismissTimeoutRef.current) {
      clearTimeout(skippedDismissTimeoutRef.current);
      skippedDismissTimeoutRef.current = null;
    }
    setSkippedNotice(null);
  }, []);

  useEffect(() => {
    let sub: ReturnType<typeof addPhotoSkippedListener> | null = null;
    try {
      sub = addPhotoSkippedListener(event => {
        console.log('[Gallery] Camera photo skipped (unsupported format):', event);
        const filename = event.filename?.trim();
        const ext = (
          event.extension?.trim() || (filename ? filename.split('.').pop() : '')
        )?.toUpperCase();
        const isRaw = [
          'ARW',
          'CR2',
          'CR3',
          'NEF',
          'DNG',
          'RW2',
          'ORF',
          'RAF',
          'SRW',
          'PEF',
        ].includes(ext || '');

        const title = isRaw ? 'RAW file not imported' : 'Unsupported file not imported';
        const fileLabel = filename || 'File';
        const baseMessage = `${fileLabel} was skipped. EntePhoto currently imports JPEG files only.`;

        setSkippedNotice(prev => {
          const newCount = prev ? prev.count + 1 : 1;
          const displayMessage =
            newCount > 1
              ? `${fileLabel} and ${newCount - 1} other unsupported file${newCount > 2 ? 's were' : ' was'} skipped. EntePhoto currently imports JPEG files only.`
              : baseMessage;

          return {
            id: `${Date.now()}-${Math.random()}`,
            title: newCount > 1 ? `${newCount} unsupported files skipped` : title,
            message: displayMessage,
            count: newCount,
          };
        });

        if (skippedDismissTimeoutRef.current) {
          clearTimeout(skippedDismissTimeoutRef.current);
        }
        skippedDismissTimeoutRef.current = setTimeout(() => {
          setSkippedNotice(null);
          skippedDismissTimeoutRef.current = null;
        }, 6000);
      });
    } catch (e) {
      console.warn('[Gallery] Failed to register addPhotoSkippedListener:', e);
    }

    return () => {
      sub?.remove();
      if (skippedDismissTimeoutRef.current) {
        clearTimeout(skippedDismissTimeoutRef.current);
        skippedDismissTimeoutRef.current = null;
      }
    };
  }, []);

  const handleCameraIndicatorPress = useCallback(() => {
    if (cameraConnectionState === 'connected') {
      navigation.navigate('CameraConnected', {
        eventId,
        eventTitle,
        eventDate: route.params?.eventDate,
        eventCategory,
        coverImage: route.params?.coverImage,
        cameraModel: cameraModel || route.params?.cameraModel || 'Sony Camera',
        photoCount: photos.length,
      });
    } else if (cameraConnectionState === 'permission_required') {
      startCameraSearch();
    } else {
      navigation.navigate('CameraConnect', {
        eventId,
        eventTitle,
        eventDate: route.params?.eventDate,
        eventCategory,
        coverImage: route.params?.coverImage,
      });
    }
  }, [
    cameraConnectionState,
    navigation,
    eventId,
    eventTitle,
    route.params?.eventDate,
    route.params?.coverImage,
    route.params?.cameraModel,
    eventCategory,
    cameraModel,
    photos.length,
    startCameraSearch,
  ]);

  // All Upload Queue & Session State
  const allUploadQueueRef = React.useRef<string[]>([]);
  const allUploadSessionProcessedRef = React.useRef<number>(0);
  const allUploadFailedIdsRef = React.useRef<Set<string>>(new Set());
  const isAllUploadActiveRef = React.useRef(false);
  const [isAllUploadActive, setIsAllUploadActive] = useState(false);
  const isAllUploadPausedRef = React.useRef(false);
  const [isAllUploadPaused, setIsAllUploadPaused] = useState(false);
  const isAllUploadWorkerRunningRef = React.useRef(false);
  const currentUploadControlRef = React.useRef<UploadCancellationControl | null>(null);
  const currentPipelineRef = React.useRef<UploadLookaheadPipeline | null>(null);
  const currentUploadingPhotoIdRef = React.useRef<string | null>(null);
  const processAllUploadQueueRef = React.useRef<() => void>(() => {});

  // Selected-photo batch upload: stop-after-current state & pipeline ref
  const isBatchStopRequestedRef = React.useRef(false);
  const [isBatchStopRequested, setIsBatchStopRequested] = useState(false);
  const currentBatchPipelineRef = React.useRef<UploadLookaheadPipeline | null>(null);
  const currentBatchControlRef = React.useRef<UploadCancellationControl | null>(null);
  const isExitingGalleryRef = React.useRef(false);

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
      if (currentPipelineRef.current) {
        currentPipelineRef.current.cleanup();
        currentPipelineRef.current = null;
      }
      isBatchStopRequestedRef.current = false;
      if (currentBatchPipelineRef.current) {
        currentBatchPipelineRef.current.cleanup();
        currentBatchPipelineRef.current = null;
      }
      if (currentBatchControlRef.current) {
        currentBatchControlRef.current.cancel();
        currentBatchControlRef.current = null;
      }
      allUploadQueueRef.current = [];
      allUploadSessionProcessedRef.current = 0;
      failedIds.clear();
      isAllUploadWorkerRunningRef.current = false;
      currentUploadingPhotoIdRef.current = null;
      notificationService.stopUploadProgress();
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

  // Flow: Fetch existing server uploaded photos first, then signal readiness for local scan
  useEffect(() => {
    let isCancelled = false;

    async function initUploadedAndScan() {
      setIsInitialScanReady(false);
      setIsInitialLoading(true);

      if (!eventId) {
        if (!isCancelled) {
          setIsInitialScanReady(true);
        }
        return;
      }

      // 1. Restore local storage uploaded photo keys for this event
      try {
        const savedKeys = await storageService.getUploadedPhotoKeys(eventId);
        if (isCancelled) return;
        if (savedKeys && savedKeys.length > 0) {
          const keySet = new Set(savedKeys);
          uploadedPhotoIdsRef.current = keySet;
          setUploadedPhotoIds(keySet);

          // Synchronously reflect uploaded status on already-loaded photos
          photosRef.current = photosRef.current.map(p =>
            isPhotoInUploadedSet(p, keySet) ? { ...p, status: 'uploaded' } : p,
          );
          setPhotos(prev =>
            prev.map(p => (isPhotoInUploadedSet(p, keySet) ? { ...p, status: 'uploaded' } : p)),
          );
        }
      } catch (error) {
        console.error('[Gallery] Failed to load uploaded photos from storage:', error);
      }

      // 2. Fetch server filenames BEFORE starting initial local scan
      if (isValidObjectId(eventId)) {
        try {
          console.log(`[Gallery] Fetching existing photos from server for event: ${eventId}`);
          const serverFilenames = await checkExistingPhotos(eventId);

          if (isCancelled) {
            console.log(
              `[Gallery] Event changed or screen unmounted while fetching server photos for ${eventId} — discarding results.`,
            );
            return;
          }

          if (serverFilenames.length > 0) {
            console.log(
              `[Gallery] Server returned ${serverFilenames.length} existing photo filenames for event ${eventId}`,
            );
            const currentSet = new Set(uploadedPhotoIdsRef.current);
            serverFilenames.forEach(name => currentSet.add(name));
            uploadedPhotoIdsRef.current = currentSet;
            setUploadedPhotoIds(new Set(currentSet));

            // Persist the confirmed server filenames to local storage
            await storageService.markPhotosUploaded(eventId, serverFilenames);

            // Synchronously reflect uploaded status on already-loaded photos
            photosRef.current = photosRef.current.map(p =>
              isPhotoInUploadedSet(p, currentSet) ? { ...p, status: 'uploaded' } : p,
            );
            setPhotos(prev =>
              prev.map(p =>
                isPhotoInUploadedSet(p, currentSet) ? { ...p, status: 'uploaded' } : p,
              ),
            );
          }
        } catch (apiError) {
          if (isCancelled) return;
          // Record failure, preserve existing local uploaded statuses, continue to local scan
          console.warn(
            '[Gallery] Failed to fetch existing photos from server API (proceeding with local scan):',
            apiError,
          );
        }
      } else {
        console.warn(
          `[Gallery] eventId is not a valid 24-character hex ObjectId ("${eventId}"), skipping server existing-photo check`,
        );
      }

      // 3. API request settled (success or failure) — signal readiness to start local scan
      if (!isCancelled) {
        setIsInitialScanReady(true);
      }
    }

    initUploadedAndScan();

    return () => {
      isCancelled = true;
    };
  }, [eventId]);

  // Subscribe to photo scanning / fetching state across all background & foreground triggers
  useEffect(() => {
    const unsubscribeScanListener = addPhotoScanListener(scanning => {
      setIsPhotoScanning(scanning);
    });
    return () => {
      unsubscribeScanListener();
    };
  }, []);

  // Helper to merge newly scanned photos with authoritative upload state and queue uploads
  const applyScannedPhotos = useCallback((scanned: GalleryPhotoItem[]) => {
    const seq = getPhotoScanSequenceId(scanned);
    if (seq < latestAppliedScanSequenceRef.current) {
      console.log(
        `[Gallery] Dropping stale photos event (seq #${seq} < latest #${latestAppliedScanSequenceRef.current})`,
      );
      return;
    }
    latestAppliedScanSequenceRef.current = seq;

    const currentPhotos = photosRef.current;
    const uploadedSet = uploadedPhotoIdsRef.current;

    // Map any local photo whose exact filename matches an entry in uploadedSet to its ID
    const newlyMatchedIds: string[] = [];
    for (const p of scanned) {
      if (p.filename && uploadedSet.has(p.filename) && !uploadedSet.has(p.id)) {
        uploadedSet.add(p.id);
        newlyMatchedIds.push(p.id);
      }
    }

    if (newlyMatchedIds.length > 0) {
      uploadedPhotoIdsRef.current = new Set(uploadedSet);
      setUploadedPhotoIds(new Set(uploadedSet));
      const currentEvId = eventIdRef.current;
      if (currentEvId) {
        storageService.markPhotosUploaded(currentEvId, newlyMatchedIds).catch(err => {
          console.warn('[Gallery] Failed to persist matched photo IDs to storage:', err);
        });
      }
    }

    let merged: GalleryPhotoItem[];

    if (currentPhotos.length === 0) {
      merged = scanned.map(p =>
        isPhotoInUploadedSet(p, uploadedSet) ? { ...p, status: 'uploaded' as const } : p,
      );
    } else {
      const prevMap = new Map<string, GalleryPhotoItem>();
      for (const p of currentPhotos) {
        prevMap.set(p.id, p);
        if (p.uri) {
          prevMap.set(p.uri, p);
        }
      }

      merged = scanned.map(item => {
        const existing = prevMap.get(item.id) || prevMap.get(item.uri);
        const isUploaded =
          isPhotoInUploadedSet(item, uploadedSet) || existing?.status === 'uploaded';

        if (existing) {
          if (isUploaded && existing.status !== 'uploaded') {
            return { ...existing, status: 'uploaded' };
          }
          return existing;
        }
        if (isUploaded) {
          return { ...item, status: 'uploaded' };
        }
        return item;
      });
    }

    // Check if anything actually changed
    const isSame =
      merged.length === currentPhotos.length &&
      merged.every((item, i) => item === currentPhotos[i]);

    if (!isSame) {
      photosRef.current = merged;
      setPhotos(merged);
    }

    // OUTSIDE setPhotos updater: if All Upload is active, queue newly arrived unuploaded photos
    if (isAllUploadActiveRef.current) {
      let hasNewQueueItems = false;
      merged.forEach(p => {
        const isUploaded = isPhotoInUploadedSet(p, uploadedSet);

        if (
          !isUploaded &&
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
  }, []);

  const handleRetryScan = useCallback(async () => {
    setIsInitialLoading(true);
    setInitialScanError(null);
    try {
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 0);
        });
      });
      const scanned = await scanDcimEntephotoPhotos(false, true);
      applyScannedPhotos(scanned);
      setInitialScanError(null);
      setHasCompletedInitialScan(true);
      hasCompletedInitialScanRef.current = true;
    } catch (err: any) {
      console.error('[Gallery] Retry scan failed:', err);
      setInitialScanError(
        err?.message || `Failed to scan photos from ${PHOTO_STORAGE_DISPLAY_PATH}`,
      );
    } finally {
      setIsInitialLoading(false);
    }
  }, [applyScannedPhotos]);

  // Background reconciliation rescan (focus listener, subscription callbacks).
  // Does NOT show the ClaymorphismLoader — must stay silent and fast.
  const handleManualRescan = useCallback(async () => {
    try {
      const scanned = await scanDcimEntephotoPhotos(false, true);
      applyScannedPhotos(scanned);
      setInitialScanError(null);
      setHasCompletedInitialScan(true);
      hasCompletedInitialScanRef.current = true;
    } catch (err: any) {
      console.error('[Gallery] Rescan failed:', err);
      if (photosRef.current.length === 0) {
        setInitialScanError(
          err?.message || `Failed to scan photos from ${PHOTO_STORAGE_DISPLAY_PATH}`,
        );
      }
    }
  }, [applyScannedPhotos]);

  // Explicit user-triggered rescan (Action Sheet + empty-gallery button).
  // Shows the ClaymorphismLoader for the duration of the scan. Guards against
  // duplicate concurrent taps via isRescanInProgressRef.
  const handleUserRescan = useCallback(async () => {
    if (isRescanInProgressRef.current) {
      console.log('[Gallery] Rescan already in progress — ignoring duplicate request.');
      return;
    }
    isRescanInProgressRef.current = true;
    setIsRescanLoading(true);
    try {
      // Yield to allow React Native to render and paint the loader overlay before heavy scan,
      // and allow any open modal dismiss animations to settle smoothly.
      await new Promise<void>(resolve => {
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
      const scanned = await scanDcimEntephotoPhotos(false, true);
      applyScannedPhotos(scanned);
      setInitialScanError(null);
      setHasCompletedInitialScan(true);
      hasCompletedInitialScanRef.current = true;
    } catch (err: any) {
      console.error('[Gallery] User rescan failed:', err);
      if (photosRef.current.length === 0) {
        setInitialScanError(
          err?.message || `Failed to scan photos from ${PHOTO_STORAGE_DISPLAY_PATH}`,
        );
      }
    } finally {
      setIsRescanLoading(false);
      isRescanInProgressRef.current = false;
    }
  }, [applyScannedPhotos]);

  // Subscribe to real-time DCIM folder changes (event-driven, no 2-second polling)
  // Gated on isInitialScanReady so server existing-photos GET completes first.
  useEffect(() => {
    if (!isInitialScanReady) return;
    let isMounted = true;

    const unsubscribe = subscribeToDcimPhotos(
      dcimPhotos => {
        if (!isMounted) return;
        setIsInitialLoading(false);
        setHasCompletedInitialScan(true);
        hasCompletedInitialScanRef.current = true;
        setInitialScanError(null);
        applyScannedPhotos(dcimPhotos);
      },
      {
        onError: (err: any) => {
          if (!isMounted) return;
          console.error('[Gallery] Subscription scan failed:', err);
          setInitialScanError(
            err?.message || `Failed to scan photos from ${PHOTO_STORAGE_DISPLAY_PATH}`,
          );
          setIsInitialLoading(false);
          setHasCompletedInitialScan(true);
          hasCompletedInitialScanRef.current = true;
        },
      },
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isInitialScanReady, applyScannedPhotos]);

  // Reconcile on screen focus (only if initial loading has already finished)
  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (hasCompletedInitialScanRef.current) {
        console.log('[Gallery] Screen focused — running reconciliation scan');
        handleManualRescan();
      }
    });
    return unsubscribeFocus;
  }, [navigation, handleManualRescan]);

  // Dynamic live counts based on real photos
  const totalCount = photos.length;

  const selectedCount = useMemo(() => {
    return selectedPhotoIds.size;
  }, [selectedPhotoIds]);

  const favoriteCount = favoritePhotoIds.size;

  const newCount = useMemo(() => {
    return photos.filter(p => p.status === 'new' && !isPhotoInUploadedSet(p, uploadedPhotoIds))
      .length;
  }, [photos, uploadedPhotoIds]);

  const markedCount = useMemo(() => {
    return photos.filter(p => p.status === 'marked' && !isPhotoInUploadedSet(p, uploadedPhotoIds))
      .length;
  }, [photos, uploadedPhotoIds]);

  const uploadedCount = useMemo(() => {
    return photos.filter(p => isPhotoInUploadedSet(p, uploadedPhotoIds)).length;
  }, [photos, uploadedPhotoIds]);

  const unuploadedCount = useMemo(() => {
    return photos.filter(p => !isPhotoInUploadedSet(p, uploadedPhotoIds)).length;
  }, [photos, uploadedPhotoIds]);

  // Filtered Photo List (Only recompute on selection/favorite changes when activeFilter is 'Marked' or 'Favorites')
  const filteredPhotos = useMemo(() => {
    switch (activeFilter) {
      case 'Favorites':
        return photos.filter(p => favoritePhotoIds.has(p.id));
      case 'Marked':
        return photos.filter(p => p.status === 'marked');
      case 'Uploaded':
        return photos.filter(p => isPhotoInUploadedSet(p, uploadedPhotoIds));
      case 'All':
      default:
        return photos;
    }
  }, [photos, activeFilter, favoritePhotoIds, uploadedPhotoIds]);

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

  // Exit Confirmation State & Back Navigation
  type ExitUploadState = 'actively_uploading' | 'paused_with_pending' | 'none';
  const [isExitModalVisible, setIsExitModalVisible] = useState(false);
  const [exitUploadState, setExitUploadState] = useState<ExitUploadState>('none');
  const isLeavingRef = React.useRef(false);

  const determineUploadState = useCallback((): ExitUploadState => {
    // 1. Actively uploading:
    // Selected-photo upload in progress or All Upload actively transferring
    const isActivelyUploading =
      !isAllUploadPausedRef.current &&
      (isUploadingRef.current ||
        isAllUploadWorkerRunningRef.current ||
        (isAllUploadActiveRef.current &&
          (allUploadQueueRef.current.length > 0 || currentUploadingPhotoIdRef.current !== null)));

    if (isActivelyUploading) {
      return 'actively_uploading';
    }

    // 2. Paused with pending photos:
    const pendingPhotosCount =
      allUploadQueueRef.current.length + (currentUploadingPhotoIdRef.current ? 1 : 0);
    if (isAllUploadActiveRef.current && isAllUploadPausedRef.current && pendingPhotosCount > 0) {
      return 'paused_with_pending';
    }

    // 3. No active or pending upload session (including completed, cancelled or failed batches)
    return 'none';
  }, []);

  const handleRequestExit = useCallback(() => {
    // If full-screen photo viewer is open, close it before attempting to leave Gallery
    if (viewerVisible) {
      setViewerVisible(false);
      return;
    }
    // If gallery actions sheet is open, close it before attempting to leave Gallery
    if (isActionsModalVisible) {
      setIsActionsModalVisible(false);
      return;
    }
    // Prevent duplicate dialogs or triggering while exit cleanup is in flight
    if (isLeavingRef.current || isExitModalVisible) {
      return;
    }

    const currentState = determineUploadState();
    setExitUploadState(currentState);
    setIsExitModalVisible(true);
  }, [viewerVisible, isActionsModalVisible, isExitModalVisible, determineUploadState]);

  const handleCancelExit = useCallback(() => {
    // Stay in gallery: dismiss dialog without interrupting upload, queue or notification
    if (isLeavingRef.current) return;
    setIsExitModalVisible(false);
  }, []);

  const handleConfirmExit = useCallback(async () => {
    if (isLeavingRef.current) return;
    isLeavingRef.current = true;
    isExitingGalleryRef.current = true;

    // Immediately dismiss modal to prevent duplicate interactions
    setIsExitModalVisible(false);

    try {
      if (exitUploadState === 'actively_uploading') {
        // Case 2: Explicitly cancel active upload session, handle cleanup safely,
        // and stop associated progress notification/service.
        isBatchStopRequestedRef.current = true;

        // Cancel selected-photo batch transfer if in flight
        if (currentBatchControlRef.current) {
          await currentBatchControlRef.current.cancel();
          currentBatchControlRef.current = null;
        }
        if (currentBatchPipelineRef.current) {
          await currentBatchPipelineRef.current.cleanup();
          currentBatchPipelineRef.current = null;
        }

        // Cancel All Upload session if active
        if (isAllUploadActiveRef.current) {
          isAllUploadActiveRef.current = false;
          isAllUploadPausedRef.current = false;
          setIsAllUploadActive(false);
          setIsAllUploadPaused(false);
          allUploadQueueRef.current = [];
          allUploadSessionProcessedRef.current = 0;
          allUploadFailedIdsRef.current.clear();
          isAllUploadWorkerRunningRef.current = false;
          currentUploadingPhotoIdRef.current = null;

          if (currentUploadControlRef.current) {
            await currentUploadControlRef.current.cancel();
            currentUploadControlRef.current = null;
          }
          if (currentPipelineRef.current) {
            await currentPipelineRef.current.cleanup();
            currentPipelineRef.current = null;
          }
        }

        notificationService.stopUploadProgress();
        isUploadingRef.current = false;
        setIsUploading(false);
        setUploadProgress(null);
      } else if (exitUploadState === 'paused_with_pending') {
        // Case 3: Clean up paused session according to existing unmount cleanup logic
        isAllUploadActiveRef.current = false;
        isAllUploadPausedRef.current = false;
        setIsAllUploadActive(false);
        setIsAllUploadPaused(false);
        allUploadQueueRef.current = [];
        allUploadSessionProcessedRef.current = 0;
        allUploadFailedIdsRef.current.clear();
        isAllUploadWorkerRunningRef.current = false;
        currentUploadingPhotoIdRef.current = null;

        if (currentUploadControlRef.current) {
          await currentUploadControlRef.current.cancel();
          currentUploadControlRef.current = null;
        }
        if (currentPipelineRef.current) {
          await currentPipelineRef.current.cleanup();
          currentPipelineRef.current = null;
        }

        notificationService.stopUploadProgress();
        isUploadingRef.current = false;
        setIsUploading(false);
        setUploadProgress(null);
      } else {
        // Case 1: No active or pending upload. Clean up any completed/idle All Upload flags
        if (isAllUploadActiveRef.current) {
          isAllUploadActiveRef.current = false;
          isAllUploadPausedRef.current = false;
          setIsAllUploadActive(false);
          setIsAllUploadPaused(false);
          allUploadQueueRef.current = [];
          allUploadSessionProcessedRef.current = 0;
          notificationService.stopUploadProgress();
        }
      }
    } catch (err) {
      console.warn('[PhotoGallery] Error during exit cleanup:', err);
    } finally {
      // Navigate back only after cancellation has been fully handled
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('CameraConnected', {
          eventId,
          eventTitle,
        });
      }
    }
  }, [exitUploadState, navigation, eventId, eventTitle]);

  const handleBack = handleRequestExit;

  // Handle Android hardware back button
  useEffect(() => {
    const onHardwareBack = () => {
      // If full-screen photo viewer is open, let the viewer handle closing itself
      if (viewerVisible) {
        return false;
      }
      // If gallery actions sheet is open, let the sheet handle closing itself
      if (isActionsModalVisible) {
        return false;
      }
      // If exit/navigation is already in progress, absorb the back press
      if (isLeavingRef.current) {
        return true;
      }
      // If the exit confirmation dialog is already open, dismiss it (stay in gallery)
      if (isExitModalVisible) {
        setIsExitModalVisible(false);
        return true;
      }
      // Otherwise, show confirmation dialog via shared function
      handleRequestExit();
      return true;
    };

    const backSubscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => backSubscription.remove();
  }, [viewerVisible, isActionsModalVisible, isExitModalVisible, handleRequestExit]);

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
      if (targetPhoto && isPhotoInUploadedSet(targetPhoto, uploadedPhotoIds)) {
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
    [photos, uploadedPhotoIds],
  );

  // Toggle Select All photos within a specific batch (unrestricted selection count)
  const toggleBatchSelection = useCallback(
    (batch: RuntimeBatch) => {
      setSelectedPhotoIds(prev => {
        const selectableIds = batch.photos
          .filter(p => !isPhotoInUploadedSet(p, uploadedPhotoIds))
          .map(p => p.id);
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
    },
    [uploadedPhotoIds],
  );

  // Open Gallery Actions Sheet
  const handleMoreOptions = useCallback(() => {
    setIsActionsModalVisible(true);
  }, []);

  // Select All Photos (unrestricted selection count)
  const handleSelectAll = useCallback(() => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      filteredPhotos.forEach(p => {
        if (!isPhotoInUploadedSet(p, uploadedPhotoIds)) {
          next.add(p.id);
        }
      });
      return next;
    });
    setIsActionsModalVisible(false);
  }, [filteredPhotos, uploadedPhotoIds]);

  // Select All New Photos (unrestricted selection count)
  const handleSelectAllNew = useCallback(() => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      filteredPhotos.forEach(p => {
        if (p.status === 'new' && !isPhotoInUploadedSet(p, uploadedPhotoIds)) {
          next.add(p.id);
        }
      });
      return next;
    });
    setIsActionsModalVisible(false);
  }, [filteredPhotos, uploadedPhotoIds]);

  // Invert Selection (unrestricted selection count)
  const handleInvertSelection = useCallback(() => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      filteredPhotos.forEach(p => {
        if (isPhotoInUploadedSet(p, uploadedPhotoIds)) {
          return;
        }
        if (prev.has(p.id)) {
          next.delete(p.id);
        } else {
          next.add(p.id);
        }
      });
      return next;
    });
    setIsActionsModalVisible(false);
  }, [filteredPhotos, uploadedPhotoIds]);

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

  // Rescan Trigger from Action Sheet — uses explicit user rescan with loading overlay
  const handleRescanFromSheet = useCallback(async () => {
    setIsActionsModalVisible(false);
    await handleUserRescan();
  }, [handleUserRescan]);

  // ── ALL UPLOAD QUEUE WORKER & CONTROLLER ──

  // Shared handler for confirmed upload success (used by All Upload, Manual Batch, and Single Photo)
  const handlePhotoUploadSuccess = useCallback(
    (photo: GalleryPhotoItem) => {
      const photoId = photo.id;

      // 1. Update authoritative uploadedPhotoIds ref and reactive state
      uploadedPhotoIdsRef.current.add(photoId);
      if (photo.filename) {
        uploadedPhotoIdsRef.current.add(photo.filename);
      }
      setUploadedPhotoIds(prev => {
        const next = new Set(prev);
        next.add(photoId);
        if (photo.filename) {
          next.add(photo.filename);
        }
        return next;
      });

      // 2. Persist to storage scoped by eventId
      if (eventId) {
        const keysToPersist = photo.filename ? [photoId, photo.filename] : [photoId];
        storageService
          .markPhotosUploaded(eventId, keysToPersist)
          .catch(err => console.error('[Gallery] Failed to persist uploaded status:', err));
      }

      // 3. Update photosRef.current and setPhotos
      photosRef.current = photosRef.current.map(p =>
        p.id === photo.id || p.uri === photo.uri
          ? { ...p, selected: false, status: 'uploaded' }
          : p,
      );
      setPhotos(prev =>
        prev.map(p =>
          p.id === photo.id || p.uri === photo.uri
            ? { ...p, selected: false, status: 'uploaded' }
            : p,
        ),
      );

      // 4. Deselect if it was selected
      setSelectedPhotoIds(prev => {
        if (prev.has(photo.id)) {
          const next = new Set(prev);
          next.delete(photo.id);
          return next;
        }
        return prev;
      });
    },
    [eventId],
  );

  // Process the All Upload queue sequentially one photo at a time
  const processAllUploadQueue = useCallback(async () => {
    if (isAllUploadWorkerRunningRef.current || !isAllUploadActiveRef.current) {
      return;
    }

    isAllUploadWorkerRunningRef.current = true;
    const pipeline = new UploadLookaheadPipeline();
    currentPipelineRef.current = pipeline;

    try {
      while (isAllUploadActiveRef.current && !isAllUploadPausedRef.current) {
        if (allUploadQueueRef.current.length === 0) {
          console.log(
            '[AllUpload] Queue empty. Remaining in active state for future new photos...',
          );
          setUploadProgress(null);
          if (allUploadSessionProcessedRef.current > 0) {
            notificationService.showUploadComplete(allUploadSessionProcessedRef.current);
          } else {
            notificationService.stopUploadProgress();
          }
          break;
        }

        const nextPhotoId = allUploadQueueRef.current.shift()!;
        const photo = photosRef.current.find(p => p.id === nextPhotoId);

        // If photo cannot be resolved yet, preserve it in the queue for the next cycle
        if (!photo) {
          console.warn(
            `[AllUpload] Photo ${nextPhotoId} not resolved in photosRef. Preserving in queue.`,
          );
          allUploadQueueRef.current.unshift(nextPhotoId);
          break;
        }

        // Skip if already uploaded
        if (photo.status === 'uploaded') {
          continue;
        }

        currentUploadingPhotoIdRef.current = photo.id;
        setUploadingPhotoIds(prev => new Set(prev).add(photo.id));

        const cancelControl = new UploadCancellationControl();
        currentUploadControlRef.current = cancelControl;

        const currentNum = allUploadSessionProcessedRef.current + 1;
        const totalNum =
          allUploadSessionProcessedRef.current + allUploadQueueRef.current.length + 1;

        progressAnim.setValue(0);
        setUploadProgress({
          current: currentNum,
          total: totalNum,
          filename: photo.filename,
          bytePercentage: 0,
        });

        isUploadingRef.current = true;
        setIsUploading(true);

        const initialBatchPct = (allUploadSessionProcessedRef.current / totalNum) * 100;
        notificationService.updateUploadProgress(currentNum, totalNum, initialBatchPct);

        try {
          // 1. Await preparation for the active photo (uses background lookahead if available)
          const prepared = await pipeline.getPrepared(photo, cancelControl);

          // 2. Look ahead: find next eligible photo in queue and prepare it in the background
          if (
            isAllUploadActiveRef.current &&
            !isAllUploadPausedRef.current &&
            !cancelControl.isCancelled
          ) {
            for (let q = 0; q < allUploadQueueRef.current.length; q++) {
              const peekId = allUploadQueueRef.current[q];
              const peekPhoto = photosRef.current.find(p => p.id === peekId);
              if (
                peekPhoto &&
                peekPhoto.status !== 'uploaded' &&
                !allUploadFailedIdsRef.current.has(peekId)
              ) {
                pipeline.prepareNext(peekPhoto);
                break;
              }
            }
          }

          // 3. Network upload — strictly 1 active network transfer at any time
          let lastStateUpdate = 0;
          let lastNotificationUpdate = 0;
          await uploadPreparedPhoto(
            eventId,
            prepared,
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

              if (now - lastNotificationUpdate > 500 || percentage >= 99.9) {
                lastNotificationUpdate = now;
                const batchPct =
                  ((allUploadSessionProcessedRef.current + percentage / 100) / totalNum) * 100;
                notificationService.updateUploadProgress(currentNum, totalNum, batchPct);
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

          allUploadSessionProcessedRef.current += 1;
          const completedBatchPct = (allUploadSessionProcessedRef.current / totalNum) * 100;
          notificationService.updateUploadProgress(
            allUploadSessionProcessedRef.current,
            totalNum,
            completedBatchPct,
          );
          handlePhotoUploadSuccess(photo);
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
      await pipeline.cleanup();
      currentPipelineRef.current = null;
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
      if (!isAllUploadActiveRef.current || isAllUploadPausedRef.current) {
        notificationService.stopUploadProgress();
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
  }, [eventId, handlePhotoUploadSuccess, progressAnim]);

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

    // Ensure notification permission requested if needed (non-blocking)
    notificationService.ensurePermission().catch(() => {});

    isAllUploadActiveRef.current = true;
    setIsAllUploadActive(true);
    isAllUploadPausedRef.current = false;
    setIsAllUploadPaused(false);
    allUploadSessionProcessedRef.current = 0;

    // Initial population: every photo in the entire gallery where status !== 'uploaded'
    const unuploaded = photosRef.current.filter(
      p =>
        p.status !== 'uploaded' &&
        !uploadedPhotoIdsRef.current.has(p.id) &&
        (!p.filename || !uploadedPhotoIdsRef.current.has(p.filename)),
    );
    allUploadFailedIdsRef.current.clear();
    allUploadQueueRef.current = unuploaded.map(p => p.id);

    console.log(
      `[AllUpload] Session started with ${allUploadQueueRef.current.length} unuploaded photos.`,
    );

    if (allUploadQueueRef.current.length > 0) {
      notificationService.startUploadProgress(1, allUploadQueueRef.current.length, 0);
    }

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

    // Stop ongoing foreground progress notification safely without claiming complete or cancel
    notificationService.stopUploadProgress();

    // Cancel active upload task if one is currently in flight
    if (currentUploadControlRef.current) {
      currentUploadControlRef.current.cancel();
    }
    if (currentPipelineRef.current) {
      currentPipelineRef.current.cancel();
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

    if (isUploadingRef.current) {
      Alert.alert(
        'Upload in Progress',
        'Please wait for the current upload to finish before resuming All Upload.',
      );
      return;
    }

    console.log('[AllUpload] Resuming All Upload session...');
    isAllUploadPausedRef.current = false;
    setIsAllUploadPaused(false);

    // Ensure notification permission requested if needed (non-blocking)
    notificationService.ensurePermission().catch(() => {});

    const totalRemaining = allUploadSessionProcessedRef.current + allUploadQueueRef.current.length;
    if (totalRemaining > 0) {
      const currentNum = allUploadSessionProcessedRef.current + 1;
      const currentPct = (allUploadSessionProcessedRef.current / totalRemaining) * 100;
      notificationService.startUploadProgress(currentNum, totalRemaining, currentPct);
    }

    // Resume processing existing queue (the previously paused photo is at the front)
    processAllUploadQueue();
  }, [processAllUploadQueue]);

  // Stop after current photo handler for selected-photo batch upload
  const handleStopBatchAfterCurrent = useCallback(() => {
    if (isBatchStopRequestedRef.current || !isUploadingRef.current) {
      return;
    }
    console.log('[PhotoGallery] Stop after current photo requested by user.');
    isBatchStopRequestedRef.current = true;
    setIsBatchStopRequested(true);

    // Cancel and clean up background lookahead immediately so no unneeded work continues
    if (currentBatchPipelineRef.current) {
      currentBatchPipelineRef.current.cancel();
      currentBatchPipelineRef.current.cleanup().catch(err => {
        console.warn('[PhotoGallery] Error cleaning up lookahead on batch stop:', err);
      });
    }
  }, []);

  // ── CORE UPLOAD BATCH HANDLER ──
  // This single function owns the upload process to strictly prevent concurrent upload bugs.
  const executeUploadBatch = useCallback(
    async (batchToUpload: GalleryPhotoItem[], showConfirmation: boolean = true) => {
      if (isAllUploadActiveRef.current && !isAllUploadPausedRef.current) {
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

        // Ensure notification permission requested if needed (non-blocking)
        notificationService.ensurePermission().catch(() => {});

        isUploadingRef.current = true;
        setIsUploading(true);

        const total = batchToUpload.length;
        let successCount = 0;
        let failCount = 0;
        const failReasons: string[] = [];

        console.log(`[PhotoGallery] Starting batch upload of ${total} photos.`);
        setUploadProgress({ current: 0, total });

        // Start ongoing foreground notification
        notificationService.startUploadProgress(1, total, 0);

        const pipeline = new UploadLookaheadPipeline();
        currentBatchPipelineRef.current = pipeline;
        isBatchStopRequestedRef.current = false;
        setIsBatchStopRequested(false);
        isExitingGalleryRef.current = false;

        try {
          for (let i = 0; i < total; i++) {
            // Guard before starting a new photo if stop was requested
            if (isBatchStopRequestedRef.current) {
              console.log(
                `[PhotoGallery] Batch stopped before photo ${i + 1}/${total} as requested.`,
              );
              break;
            }

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

            // Update notification for current photo start
            const photoStartBatchPct = (i / total) * 100;
            notificationService.updateUploadProgress(i + 1, total, photoStartBatchPct);

            const cancelControl = new UploadCancellationControl();
            currentBatchControlRef.current = cancelControl;

            try {
              // 1. Prepare active photo (reuses lookahead prepared in previous iteration)
              const prepared = await pipeline.getPrepared(photo, cancelControl);

              // 2. Pre-compress the next photo in the background only if stop has not been requested
              if (
                !isBatchStopRequestedRef.current &&
                i + 1 < total &&
                batchToUpload[i + 1].status !== 'uploaded'
              ) {
                pipeline.prepareNext(batchToUpload[i + 1]);
              }

              // 3. Network upload — strictly 1 active network transfer at any time
              let lastStateUpdate = 0;
              let lastNotificationUpdate = 0;
              await uploadPreparedPhoto(
                eventId,
                prepared,
                null,
                percentage => {
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

                  // Throttle notification updates (~500ms) with accurate overall batch progress
                  if (now - lastNotificationUpdate > 500 || percentage >= 99.9) {
                    lastNotificationUpdate = now;
                    const currentBatchPct = ((i + percentage / 100) / total) * 100;
                    notificationService.updateUploadProgress(i + 1, total, currentBatchPct);
                  }
                },
                cancelControl,
              );

              // Ensure we show 100% when success is confirmed
              progressAnim.setValue(100);
              setUploadProgress(prev => (prev ? { ...prev, bytePercentage: 100 } : prev));

              successCount++;
              const completedBatchPct = ((i + 1) / total) * 100;
              notificationService.updateUploadProgress(i + 1, total, completedBatchPct);
              console.log(`[PhotoGallery] Photo ${photo.filename} uploaded successfully.`);

              // Mark individual photo as uploaded immediately upon success via shared handler
              handlePhotoUploadSuccess(photo);
            } catch (err: any) {
              if (isUploadCancelledError(err) || cancelControl.isCancelled) {
                console.log(`[PhotoGallery] Batch photo ${photo.filename} upload cancelled.`);
                break;
              }
              const errorMsg = err?.message || 'Upload failed';
              console.error(`[PhotoGallery] Upload error for ${photo.filename}:`, errorMsg);
              failReasons.push(`${photo.filename}: ${errorMsg}`);
              failCount++;
            } finally {
              currentBatchControlRef.current = null;
              setUploadingPhotoIds(prev => {
                const next = new Set(prev);
                next.delete(photo.id);
                return next;
              });
            }

            // Guard immediately after the current photo settles
            if (isBatchStopRequestedRef.current) {
              console.log(`[PhotoGallery] Batch stopped after photo ${i + 1}/${total} settled.`);
              break;
            }
          }
        } finally {
          const wasStopped = isBatchStopRequestedRef.current;
          await pipeline.cleanup();
          currentBatchPipelineRef.current = null;
          currentBatchControlRef.current = null;
          // ALWAYS release the lock
          isUploadingRef.current = false;
          setIsUploading(false);
          setUploadProgress(null);
          isBatchStopRequestedRef.current = false;
          setIsBatchStopRequested(false);
          console.log(
            `[PhotoGallery] Batch complete. Success: ${successCount}, Failed: ${failCount}, Stopped: ${wasStopped}`,
          );

          // Update Android notification results safely
          try {
            if (isExitingGalleryRef.current) {
              notificationService.stopUploadProgress();
            } else if (wasStopped && successCount + failCount < total) {
              notificationService.showUploadCancelled(successCount, total);
            } else if (failCount === 0) {
              notificationService.showUploadComplete(successCount);
            } else if (successCount > 0) {
              const errorSummary = `${failCount} of ${total} photo${failCount > 1 ? 's' : ''} failed`;
              notificationService.showUploadFailed(errorSummary, successCount, total);
            } else {
              const errorSummary = failReasons[0] || 'Upload failed';
              notificationService.showUploadFailed(errorSummary, 0, total);
            }
          } catch (notifErr) {
            console.warn('[PhotoGallery] Error updating final upload notification:', notifErr);
            notificationService.stopUploadProgress();
          }

          if (!isExitingGalleryRef.current && wasStopped && successCount + failCount < total) {
            Alert.alert(
              'Upload Stopped',
              `Batch stopped after current photo settled.\n\nUploaded: ${successCount}\nRemaining: ${total - successCount - failCount}${failCount > 0 ? `\nFailed: ${failCount}` : ''}`,
            );
          } else if (!isExitingGalleryRef.current && failCount === 0) {
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
    [eventId, eventTitle, handlePhotoUploadSuccess, progressAnim],
  );

  // Upload Selected Photos (Gallery Bulk Upload)
  const handleUploadPhotos = useCallback(() => {
    if (isUploadingRef.current) return;

    const selectedPhotos = photos.filter(
      p =>
        selectedPhotoIds.has(p.id) &&
        p.status !== 'uploaded' &&
        !uploadedPhotoIds.has(p.id) &&
        (!p.filename || !uploadedPhotoIds.has(p.filename)),
    );

    if (selectedPhotos.length === 0) {
      Alert.alert(
        'No Photos Selected',
        'Please tap on the photos you wish to mark and upload to the event cloud.',
      );
      return;
    }

    executeUploadBatch(selectedPhotos, true);
  }, [photos, selectedPhotoIds, uploadedPhotoIds, executeUploadBatch]);

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
      if (isPhotoInUploadedSet(photo, uploadedPhotoIds)) {
        return;
      }
      // Do not show an alert prompt when uploading a single photo directly from the viewer
      executeUploadBatch([photo], false);
    },
    [executeUploadBatch, uploadedPhotoIds],
  );

  // Floating Dock Animation & Visibility Transition
  const isDockVisible = selectedCount > 0 || isUploading;

  useEffect(() => {
    // Only animate when transitioning between hidden and visible states
    if (isDockVisible === isDockVisibleRef.current) {
      return;
    }
    isDockVisibleRef.current = isDockVisible;

    const anim = isDockVisible
      ? Animated.spring(dockSlideAnim, {
          toValue: 1,
          useNativeDriver: true,
          damping: 24,
          stiffness: 250,
        })
      : Animated.timing(dockSlideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        });

    anim.start();

    return () => {
      anim.stop();
    };
  }, [isDockVisible, dockSlideAnim]);

  // Efficiently derive the first selected photo for the dock thumbnail without full array scans
  const firstSelectedPhoto = useMemo(() => {
    if (selectedPhotoIds.size === 0) return null;
    const firstId = selectedPhotoIds.values().next().value;
    if (!firstId) return null;
    return photos.find(p => p.id === firstId) || null;
  }, [selectedPhotoIds, photos]);

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

  // ── Stable Viewer Navigation Callback ────────────────────────────────────
  const handleOpenViewer = useCallback((flatIndex: number) => {
    setViewerInitialIndex(flatIndex);
    setViewerVisible(true);
  }, []);

  // ── Render: Batch Section Header (SectionList) ───────────────────────────
  const renderSectionHeader = useCallback(
    ({ section }: { section: GalleryBatchSection }) => {
      return (
        <MemoizedBatchHeader
          section={section}
          isDark={isDark}
          selectedPhotoIds={selectedPhotoIdsRef.current}
          uploadedPhotoIds={uploadedPhotoIds}
          onToggleBatchSelection={toggleBatchSelection}
        />
      );
    },
    [isDark, uploadedPhotoIds, toggleBatchSelection],
  );

  // ── Render: Section Item (3-Column Grid Row for all batch photos) ──────────
  const renderSectionItem = useCallback(
    ({ item }: { item: GallerySectionRow }) => {
      if (item.type !== 'grid_row') return null;

      return (
        <MemoizedGridRow
          item={item}
          uploadingPhotoIds={uploadingPhotoIds}
          selectedPhotoIds={selectedPhotoIdsRef.current}
          favoritePhotoIds={favoritePhotoIds}
          uploadedPhotoIds={uploadedPhotoIds}
          onOpenViewer={handleOpenViewer}
          onToggleSelection={togglePhotoSelection}
        />
      );
    },
    [uploadingPhotoIds, favoritePhotoIds, uploadedPhotoIds, handleOpenViewer, togglePhotoSelection],
  );

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        {/* ── 1. HEADER ROW ── */}
        <View
          style={[
            styles.headerRow,
            { paddingTop: topInset + (Platform.OS === 'android' ? 10 : 8) },
          ]}
        >
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

          {/* Animated Event Title Block */}
          <Animated.View
            style={[
              styles.headerTitleBlock,
              {
                opacity: titleVisibilityAnim.interpolate({
                  inputRange: [0, 0.35, 1],
                  outputRange: [0, 0, 1],
                }),
                maxWidth: titleVisibilityAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 360],
                }),
                marginHorizontal: titleVisibilityAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 14],
                }),
                transform: [
                  {
                    translateX: titleVisibilityAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-8, 0],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents={isTitleHidden ? 'none' : 'auto'}
            aria-hidden={isTitleHidden}
          >
            <Text
              style={[styles.eventTitleText, { color: isDark ? '#F4F4F5' : '#161616' }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {eventTitle}
            </Text>
          </Animated.View>

          {/* Right Header Actions: Camera Status Badge & More Menu */}
          <View style={styles.headerRightActions}>
            {/* Dynamic Camera Connection Status Pill */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleCameraIndicatorPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[
                styles.connectedStatusPill,
                getCameraStatusStyle(displayedCameraStatus, isDark),
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Camera status: ${getCameraStatusLabel(displayedCameraStatus)}`}
            >
              {renderCameraStatusIndicator(displayedCameraStatus)}
              <Text
                style={[
                  styles.connectedPillLabel,
                  { color: getCameraStatusTextColor(displayedCameraStatus, isDark) },
                ]}
              >
                {getCameraStatusLabel(displayedCameraStatus)}
              </Text>
            </TouchableOpacity>

            {/* Reconnect button: visible when Camera not found or Not connected */}
            {canReconnect && (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={handleReconnectPress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[
                  styles.reconnectButton,
                  {
                    backgroundColor: isDark ? 'rgba(255, 107, 74, 0.16)' : '#FCEEE8',
                    borderColor: isDark ? 'rgba(255, 107, 74, 0.35)' : '#F6C5B8',
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Reconnect camera"
                accessibilityHint="Starts a fresh 10-second camera discovery attempt"
              >
                <RefreshCw
                  size={11}
                  color={isDark ? '#FF8A65' : '#161616'}
                  strokeWidth={2.4}
                  style={styles.reconnectButtonIcon}
                />
                <Text
                  style={[styles.reconnectButtonText, { color: isDark ? '#F4F4F5' : '#161616' }]}
                >
                  Reconnect
                </Text>
              </TouchableOpacity>
            )}

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
                      transform: [{ translateY: pressed ? 1.5 : 0 }],
                    },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View
                    style={[
                      styles.filterChipFace,
                      isSelected
                        ? [
                            styles.filterChipSelectedFace,
                            {
                              backgroundColor: isDark ? '#2A2A30' : '#222226',
                              borderColor: isDark ? '#3F3F46' : '#161616',
                              borderBottomColor: isDark ? '#09090B' : '#000000',
                            },
                          ]
                        : [
                            styles.filterChipDefaultFace,
                            {
                              backgroundColor: isDark ? '#1A1A1E' : '#FAF7F2',
                              borderColor: isDark ? '#3F3F46' : '#161616',
                              borderBottomColor: isDark ? '#161618' : '#161616',
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

        {/* ── UNSUPPORTED FORMAT SKIPPED BANNER (Non-blocking, inline) ── */}
        {skippedNotice && (
          <View style={styles.skippedBannerWrapper}>
            <View
              style={[
                styles.skippedBannerFace,
                {
                  backgroundColor: isDark ? '#261F18' : '#FFF9F2',
                  borderColor: isDark ? '#5C3E1B' : '#E0922F',
                },
              ]}
            >
              <View style={styles.skippedBannerLeft}>
                <Info
                  size={18}
                  color={isDark ? '#FBBF24' : '#D97706'}
                  strokeWidth={2.4}
                  style={styles.skippedBannerIcon}
                />
                <View style={styles.skippedBannerTextContainer}>
                  <Text
                    style={[styles.skippedBannerTitle, { color: isDark ? '#FDF4DC' : '#1C1917' }]}
                  >
                    {skippedNotice.title}
                  </Text>
                  <Text
                    style={[styles.skippedBannerBody, { color: isDark ? '#E5D5B8' : '#78716C' }]}
                  >
                    {skippedNotice.message}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={handleDismissSkippedNotice}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.75}
                style={styles.skippedDismissButton}
                accessibilityRole="button"
                accessibilityLabel="Dismiss notice"
              >
                <X size={16} color={isDark ? '#E5D5B8' : '#78716C'} strokeWidth={2} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── CAMERA DISCONNECTION PROMPT BANNER (Non-blocking, inline) ── */}
        {isDisconnectBannerVisible && (
          <View style={styles.disconnectBannerWrapper}>
            <View
              style={[
                styles.disconnectBannerFace,
                {
                  backgroundColor: isDark ? '#2A1515' : '#FFF0ED',
                  borderColor: isDark ? '#5E2020' : '#FF6B4A',
                },
              ]}
            >
              <View style={styles.disconnectBannerLeft}>
                <AlertTriangle
                  size={18}
                  color="#FF6B4A"
                  strokeWidth={2.4}
                  style={styles.disconnectBannerIcon}
                />
                <View style={styles.disconnectBannerTextContainer}>
                  <Text
                    style={[
                      styles.disconnectBannerTitle,
                      { color: isDark ? '#F4F4F5' : '#161616' },
                    ]}
                  >
                    {cameraConnectionState === 'reconnecting'
                      ? 'Camera reconnecting…'
                      : 'Camera disconnected'}
                  </Text>
                  <Text
                    style={[styles.disconnectBannerBody, { color: isDark ? '#FFA384' : '#7A7571' }]}
                  >
                    Reconnect the camera cable. Your Gallery and ongoing uploads will remain
                    available.
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={handleRetryCameraConnection}
                disabled={isRetryingCamera}
                activeOpacity={0.75}
                style={[
                  styles.disconnectRetryButton,
                  { backgroundColor: isDark ? '#E5484D' : '#161616' },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Retry camera connection"
              >
                {isRetryingCamera ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.disconnectRetryText}>Retry</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── TOP REFRESH SPINNER (Visible during subsequent background or manual refreshes when photos exist and full overlay is not active) ── */}
        {isPhotoScanning && !isRescanLoading && photos.length > 0 && (
          <View
            style={styles.topSpinnerContainer}
            pointerEvents="none"
            accessibilityRole="progressbar"
            accessibilityLabel="Refreshing photos"
          >
            <ActivityIndicator size="small" color={isDark ? '#818CF8' : '#6366F1'} />
            <Text style={[styles.topSpinnerText, { color: isDark ? '#A1A1AA' : '#71717A' }]}>
              Refreshing photos…
            </Text>
          </View>
        )}

        {/* ── 3. PHOTO GRID (SectionList, one section per PhotoBatch) ── */}
        <SectionList<GallerySectionRow, GalleryBatchSection>
          sections={gallerySections}
          extraData={useMemo(
            () => [
              selectedPhotoIds,
              favoritePhotoIds,
              uploadedPhotoIds,
              isInitialLoading,
              initialScanError,
            ],
            [
              selectedPhotoIds,
              favoritePhotoIds,
              uploadedPhotoIds,
              isInitialLoading,
              initialScanError,
            ],
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
            if (isInitialLoading || (isPhotoScanning && !hasCompletedInitialScan)) {
              return <ClaymorphismLoader isVisible isDark={isDark} />;
            }

            if (initialScanError) {
              return (
                <View style={styles.errorContainer}>
                  <View
                    style={[
                      styles.errorIconCircle,
                      { backgroundColor: isDark ? '#3E2222' : '#FEE2E2' },
                    ]}
                  >
                    <AlertTriangle size={34} color="#EF4444" strokeWidth={1.8} />
                  </View>
                  <Text style={[styles.errorTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                    Unable to Load Photos
                  </Text>
                  <Text style={[styles.errorSubtitle, { color: isDark ? '#A1A1AA' : '#71717A' }]}>
                    {initialScanError}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={handleRetryScan}
                    style={[
                      styles.errorRetryButton,
                      { backgroundColor: isDark ? '#26262E' : '#1A1A1E' },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Retry scanning photos"
                  >
                    <RefreshCw
                      size={18}
                      color="#FFFFFF"
                      strokeWidth={2.2}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.errorRetryButtonText}>Retry Scan</Text>
                  </TouchableOpacity>
                </View>
              );
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
                  onPress={handleUserRescan}
                  style={[
                    styles.emptyRefreshBtn,
                    {
                      backgroundColor: isDark ? '#26262E' : '#1A1A1E',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Rescan photos"
                >
                  {isPhotoScanning ? (
                    <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 12 }} />
                  ) : (
                    <RefreshCw
                      size={20}
                      color="#FFFFFF"
                      strokeWidth={2.2}
                      style={{ marginRight: 12 }}
                    />
                  )}
                  <Text style={styles.emptyRefreshBtnText}>
                    {isPhotoScanning ? 'Scanning...' : 'Rescan Photos'}
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

        {/* ── RESCAN OVERLAY LOADER — absolute overlay within gallery content area, visible
             even when photos already exist (ListEmptyComponent does not render in that case) ── */}
        {isRescanLoading && (
          <View
            style={[styles.rescanOverlay, isDark && { backgroundColor: 'rgba(18, 18, 18, 0.88)' }]}
            pointerEvents="none"
            accessibilityRole="progressbar"
            accessibilityLabel="Rescanning photos"
          >
            <ClaymorphismLoader isVisible isDark={isDark} />
          </View>
        )}

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
          pointerEvents={isDockVisible ? 'box-none' : 'none'}
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
            {isAllUploadActive && !isAllUploadPaused && isUploading ? (
              <View style={styles.dockUploadStateContainer}>
                {/* Top Row: Title + Progress/Status */}
                <View style={styles.dockUploadTopRow}>
                  <View style={styles.dockUploadTopLeft}>
                    <Cloud size={18} color="#6366F1" strokeWidth={2.2} />
                    <Text
                      style={[styles.dockProgressTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                    >
                      All Upload
                    </Text>
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
            ) : isUploading ? (
              <View style={styles.dockUploadStateContainer}>
                {/* Top Row */}
                <View style={styles.dockUploadTopRow}>
                  <View style={styles.dockUploadTopLeft}>
                    <Cloud size={18} color="#6366F1" strokeWidth={2.2} />
                    <Text
                      style={[styles.dockProgressTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                    >
                      {isBatchStopRequested ? 'Stopping after photo...' : 'Uploading photos'}
                    </Text>
                  </View>
                  <View style={styles.dockUploadRightRow}>
                    <Text style={[styles.dockProgressTitle, { color: '#6366F1' }]}>
                      {uploadProgress?.current || 1} / {uploadProgress?.total || 0}
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={handleStopBatchAfterCurrent}
                      disabled={isBatchStopRequested}
                      style={[
                        styles.dockStopButton,
                        {
                          backgroundColor: isBatchStopRequested
                            ? isDark
                              ? '#2E2225'
                              : '#FEE2E2'
                            : isDark
                              ? '#2A1B1F'
                              : '#FFF1F2',
                          borderColor: isBatchStopRequested
                            ? isDark
                              ? '#4A2A2E'
                              : '#FCA5A5'
                            : isDark
                              ? '#5B252E'
                              : '#FECDD3',
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Stop after current"
                    >
                      <Square
                        size={10}
                        color={isBatchStopRequested ? '#9CA3AF' : '#E11D48'}
                        fill={isBatchStopRequested ? '#9CA3AF' : '#E11D48'}
                      />
                      <Text
                        style={[
                          styles.dockStopButtonText,
                          { color: isBatchStopRequested ? '#9CA3AF' : '#E11D48' },
                        ]}
                      >
                        {isBatchStopRequested ? 'Stopping...' : 'Stop after current'}
                      </Text>
                    </TouchableOpacity>
                  </View>
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
                      {firstSelectedPhoto && (
                        <DockThumbnail key={firstSelectedPhoto.id} uri={firstSelectedPhoto.uri} />
                      )}
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
                      {selectedCount}
                    </Text>
                    <Text
                      style={[styles.dockSecondaryText, { color: isDark ? '#A1A1AA' : '#71717A' }]}
                      numberOfLines={1}
                    >
                      Selected
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
          uploadedPhotoIds={uploadedPhotoIds}
          onUploadPhoto={handleUploadSinglePhoto}
          onDeletePhoto={handleDeletePhoto}
          isDark={isDark}
          isUploading={isUploading}
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

        {/* ── 7. THEMED EXIT CONFIRMATION DIALOG ── */}
        <Modal
          visible={isExitModalVisible}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={handleCancelExit}
        >
          <View style={styles.exitModalBackdrop}>
            <Pressable
              style={styles.exitModalBackdropTouch}
              onPress={handleCancelExit}
              accessibilityLabel="Dismiss confirmation dialog"
            />
            <View
              style={[
                styles.exitModalCard,
                {
                  backgroundColor: isDark ? '#1C1C22' : '#FFFDF9',
                  borderColor: isDark ? '#2E2E38' : '#E8DFD4',
                },
              ]}
              accessibilityRole="alert"
              accessibilityLabel={
                exitUploadState === 'actively_uploading'
                  ? 'Upload in progress confirmation'
                  : exitUploadState === 'paused_with_pending'
                    ? 'Upload paused confirmation'
                    : 'Leave Gallery confirmation'
              }
            >
              {/* Icon Container */}
              <View
                style={[
                  styles.exitModalIconCircle,
                  {
                    backgroundColor: isDark ? 'rgba(255, 94, 58, 0.16)' : '#FFF0EB',
                    borderColor: isDark ? 'rgba(255, 94, 58, 0.32)' : '#FFE2D8',
                  },
                ]}
              >
                <AlertTriangle size={24} color="#FF5E3A" strokeWidth={2.4} />
              </View>

              {/* Title */}
              <Text
                style={[
                  styles.exitModalTitle,
                  {
                    color: isDark ? '#F4F4F5' : '#161616',
                  },
                ]}
              >
                {exitUploadState === 'actively_uploading'
                  ? 'Upload in Progress'
                  : exitUploadState === 'paused_with_pending'
                    ? 'Upload Paused'
                    : 'Leave Gallery?'}
              </Text>

              {/* Message */}
              <Text
                style={[
                  styles.exitModalMessage,
                  {
                    color: isDark ? '#D4D4D8' : '#52525B',
                  },
                ]}
              >
                {exitUploadState === 'actively_uploading'
                  ? "If you leave Gallery now, the current upload will stop. Photos that haven't finished uploading may need to be uploaded again. Do you want to leave?"
                  : exitUploadState === 'paused_with_pending'
                    ? 'Your upload is paused. If you leave Gallery now, the remaining photos in the upload queue will be cleared. You may need to select and upload them again. Do you want to leave?'
                    : 'Your photos may take a little time to load when you return to the Gallery. Are you sure you want to leave now?'}
              </Text>

              {/* Action Buttons */}
              <View style={styles.exitModalButtonContainer}>
                {/* Primary Button */}
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={handleConfirmExit}
                  style={styles.exitModalPrimaryButton}
                  accessibilityRole="button"
                  accessibilityLabel={
                    exitUploadState === 'actively_uploading'
                      ? 'Leave & Stop Upload'
                      : 'Leave Gallery'
                  }
                >
                  <Text style={styles.exitModalPrimaryButtonText}>
                    {exitUploadState === 'actively_uploading'
                      ? 'Leave & Stop Upload'
                      : 'Leave Gallery'}
                  </Text>
                </TouchableOpacity>

                {/* Secondary Button: Stay in Gallery */}
                <TouchableOpacity
                  activeOpacity={0.78}
                  onPress={handleCancelExit}
                  style={[
                    styles.exitModalSecondaryButton,
                    {
                      backgroundColor: isDark ? '#26262E' : '#F1E9DF',
                      borderColor: isDark ? '#383842' : '#DFCFC2',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Stay in Gallery"
                >
                  <Text
                    style={[
                      styles.exitModalSecondaryButtonText,
                      {
                        color: isDark ? '#F4F4F5' : '#161616',
                      },
                    ]}
                  >
                    Stay in Gallery
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </AppBackground>
  );
};

// ── Memoized Components for Scroll Performance ──

const DockThumbnail = React.memo(({ uri }: { uri: string }) => {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return null;
  }

  return (
    <ExpoImage
      source={{ uri }}
      style={styles.dockThumbnailImage}
      contentFit="cover"
      cachePolicy="disk"
      onError={() => setHasError(true)}
      accessibilityIgnoresInvertColors
    />
  );
});
DockThumbnail.displayName = 'DockThumbnail';

const MemoizedPhotoTile = React.memo(
  ({
    item,
    flatIndex,
    isUploading,
    isSelected,
    isFavorite,
    isUploaded,
    onOpenViewer,
    onToggleSelection,
  }: {
    item: GalleryPhotoItem;
    flatIndex: number;
    isUploading: boolean;
    isSelected: boolean;
    isFavorite: boolean;
    isUploaded: boolean;
    onOpenViewer: (idx: number) => void;
    onToggleSelection: (id: string) => void;
  }) => {
    // effectiveUploaded considers both authoritative prop and item.status
    const effectiveUploaded = isUploaded || item.status === 'uploaded';

    return (
      <View style={styles.gridCellContainer}>
        <Pressable
          onPress={() => onOpenViewer(flatIndex)}
          style={({ pressed }) => [
            styles.photoTileWrapper,
            isSelected && styles.photoTileSelectedBorder,
            effectiveUploaded && styles.photoTileUploadedDimmed,
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
              if (!isUploading && !effectiveUploaded) {
                onToggleSelection(item.id);
              }
            }}
            hitSlop={10}
            disabled={isUploading || effectiveUploaded}
            style={styles.selectionIndicatorContainer}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={`Select photo ${item.filename || item.id}`}
          >
            {isUploading ? (
              <View style={styles.uploadingSpinnerBadge}>
                <ActivityIndicator size={11} color="#FFFFFF" />
              </View>
            ) : effectiveUploaded ? (
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
      prevProps.isUploaded === nextProps.isUploaded &&
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
    uploadedPhotoIds,
    onOpenViewer,
    onToggleSelection,
  }: {
    item: Extract<GallerySectionRow, { type: 'grid_row' }>;
    uploadingPhotoIds: Set<string>;
    selectedPhotoIds: Set<string>;
    favoritePhotoIds: Set<string>;
    uploadedPhotoIds: Set<string>;
    onOpenViewer: (idx: number) => void;
    onToggleSelection: (id: string) => void;
  }) => {
    return (
      <View style={styles.photoRowGroup}>
        {item.photos.map(({ photo, photoIndex }) => {
          const isUploaded = isPhotoInUploadedSet(photo, uploadedPhotoIds);

          return (
            <MemoizedPhotoTile
              key={photo.id}
              item={photo}
              flatIndex={photoIndex}
              isUploading={uploadingPhotoIds.has(photo.id)}
              isSelected={selectedPhotoIds.has(photo.id)}
              isFavorite={favoritePhotoIds.has(photo.id)}
              isUploaded={isUploaded}
              onOpenViewer={onOpenViewer}
              onToggleSelection={onToggleSelection}
            />
          );
        })}
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

    // Check if uploading, selection, favorite, or uploaded state changed specifically for photos in THIS row
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

      const wasUploaded = isPhotoInUploadedSet(photo, prev.uploadedPhotoIds);
      const isUploaded = isPhotoInUploadedSet(photo, next.uploadedPhotoIds);
      if (wasUploaded !== isUploaded) return false;
    }

    return true;
  },
);

const MemoizedBatchHeader = React.memo(
  ({
    section,
    isDark,
    selectedPhotoIds,
    uploadedPhotoIds,
    onToggleBatchSelection,
  }: {
    section: GalleryBatchSection;
    isDark: boolean;
    selectedPhotoIds: Set<string>;
    uploadedPhotoIds: Set<string>;
    onToggleBatchSelection: (batch: RuntimeBatch) => void;
  }) => {
    const { title, batch } = section;
    const selectablePhotos = batch.photos.filter(p => !isPhotoInUploadedSet(p, uploadedPhotoIds));
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
      const photo = prev.section.batch.photos[i];
      if (prev.selectedPhotoIds.has(photo.id) !== next.selectedPhotoIds.has(photo.id)) return false;
      if (photo.status !== next.section.batch.photos[i].status) return false;

      const wasUploaded = isPhotoInUploadedSet(photo, prev.uploadedPhotoIds);
      const isUploaded = isPhotoInUploadedSet(photo, next.uploadedPhotoIds);
      if (wasUploaded !== isUploaded) return false;
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
    paddingTop: 8,
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
    justifyContent: 'center',
    overflow: 'hidden',
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
    flexShrink: 0,
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
  reconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.2,
  },
  reconnectButtonIcon: {
    marginRight: 4,
  },
  reconnectButtonText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: -0.2,
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
    paddingBottom: 6,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 3,
    paddingBottom: 8,
    gap: 10,
  },
  filterChipWrapper: {
    position: 'relative',
  },
  filterChipFace: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipDefaultFace: {},
  filterChipSelectedFace: {},
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  rescanOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Slightly translucent so the user can see there is a gallery beneath
    backgroundColor: 'rgba(250, 246, 240, 0.88)',
    zIndex: 50,
    ...Platform.select({
      android: { elevation: 20 },
    }),
  },

  topSpinnerText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
    letterSpacing: -0.1,
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
  dockUploadRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dockStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  dockStopButtonText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11,
    fontWeight: '700',
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
  // Camera Disconnection Prompt Banner
  disconnectBannerWrapper: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  disconnectBannerFace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  disconnectBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  disconnectBannerIcon: {
    flexShrink: 0,
  },
  disconnectBannerTextContainer: {
    flex: 1,
  },
  disconnectBannerTitle: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13,
    lineHeight: 18,
  },
  disconnectBannerBody: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
  },
  disconnectRetryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  disconnectRetryText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 12,
  },
  // Skipped Format Notice Banner
  skippedBannerWrapper: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  skippedBannerFace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  skippedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  skippedBannerIcon: {
    flexShrink: 0,
  },
  skippedBannerTextContainer: {
    flex: 1,
  },
  skippedBannerTitle: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13,
    lineHeight: 18,
  },
  skippedBannerBody: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
  },
  skippedDismissButton: {
    padding: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  loadingIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  loadingTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  loadingSubtitle: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  errorIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
  },
  errorRetryButtonText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Exit Confirmation Modal Styles
  exitModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  exitModalBackdropTouch: {
    ...StyleSheet.absoluteFill,
  },
  exitModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 28,
    borderWidth: 1.5,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.28,
        shadowRadius: 20,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  exitModalIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  exitModalTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  exitModalMessage: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 6,
  },
  exitModalButtonContainer: {
    width: '100%',
    gap: 10,
  },
  exitModalPrimaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FF5E3A',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#FF5E3A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  exitModalPrimaryButtonText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  exitModalSecondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitModalSecondaryButtonText: {
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
});
