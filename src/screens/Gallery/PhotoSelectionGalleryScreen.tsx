import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Pressable,
  FlatList,
  Alert,
  Platform,
  ActivityIndicator,
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
  CANONICAL_DCIM_DIR_URI,
} from '@/services/localPhotoService';
import { uploadSinglePhoto } from '@/services/photoUploadService';
import { FullScreenPhotoViewer } from './components/FullScreenPhotoViewer';
import { GalleryActionsSheet } from './components/GalleryActionsSheet';

export type PhotoStatus = 'new' | 'marked' | 'uploaded';

export interface GalleryPhotoItem {
  id: string;
  uri: string;
  filename?: string;
  isRaw: boolean;
  status: PhotoStatus;
  selected: boolean;
  timestamp: string;
  aperture?: string;
  iso?: string;
  shutter?: string;
  dimensions?: string;
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

  // Subscribe to real-time DCIM folder changes
  useEffect(() => {
    const unsubscribe = subscribeToDcimPhotos(dcimPhotos => {
      setPhotos(prevPhotos => {
        if (prevPhotos.length === 0) {
          return dcimPhotos;
        }

        // Preserve user's local selections across file scans
        const statusMap = new Map<string, { selected: boolean; status: PhotoStatus }>();
        for (const p of prevPhotos) {
          statusMap.set(p.id, { selected: p.selected, status: p.status });
          statusMap.set(p.uri, { selected: p.selected, status: p.status });
        }

        return dcimPhotos.map(item => {
          const existing = statusMap.get(item.id) || statusMap.get(item.uri);
          if (existing) {
            return { ...item, selected: existing.selected, status: existing.status };
          }
          return item;
        });
      });
    }, 2000);

    return () => {
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

    if (!eventId) {
      Alert.alert(
        'Event Not Specified',
        'No event ID is associated with this session. Please select a valid event first.',
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
                console.error(
                  `[PhotoGallery] Upload error for ${photo.filename}:`,
                  err?.response?.data || err?.message || err,
                );
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
              Alert.alert(
                'Upload Finished ⚠️',
                `Uploaded: ${successCount}\nFailed: ${failCount}\n\nYou can retry uploading any remaining marked photos.`,
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
      if (!eventId) {
        Alert.alert('Event Not Specified', 'No active event ID available for upload.');
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
          `Could not upload ${photo.filename || 'photo'}: ${
            err?.response?.data?.error ||
            err?.response?.data?.details ||
            err?.message ||
            'Network error'
          }`,
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

  // Render Single Grid Tile
  const renderPhotoItem = useCallback(
    ({ item, index }: { item: GalleryPhotoItem; index: number }) => {
      const isSelected = item.selected;
      const isUploaded = item.status === 'uploaded';
      const isPhotoUploading = uploadingPhotoIds.has(item.id);

      return (
        <View style={styles.gridCellContainer}>
          <Pressable
            onPress={() => {
              setViewerInitialIndex(index);
              setViewerVisible(true);
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
            {/* Main Photo Thumbnail */}
            <Image source={{ uri: item.uri }} style={styles.photoImage} resizeMode="cover" />

            {/* Bottom-left RAW Tag */}
            {item.isRaw && (
              <View style={styles.rawBadgeContainer}>
                <Text style={styles.rawBadgeText}>RAW</Text>
              </View>
            )}

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

        {/* ── 3. PHOTO GRID ── */}
        <FlatList
          data={filteredPhotos}
          renderItem={renderPhotoItem}
          keyExtractor={item => item.id}
          numColumns={3}
          contentContainerStyle={[
            styles.gridContentContainer,
            { paddingBottom: insets.bottom + 120 },
          ]}
          columnWrapperStyle={filteredPhotos.length > 0 ? styles.gridColumnWrapper : undefined}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={12}
          windowSize={7}
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
                No photos in DCIM/Entephoto
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
                  {isRefreshing ? 'Scanning...' : 'Rescan DCIM Folder'}
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
    flex: 1 / 3,
    aspectRatio: 1,
    borderRadius: 14,
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
  photoTileSelectedBorder: {
    borderColor: '#FF5E3A',
    borderWidth: 3,
  },
  photoTileUploadedDimmed: {
    opacity: 0.65,
  },
  photoImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2A2A32',
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
});
