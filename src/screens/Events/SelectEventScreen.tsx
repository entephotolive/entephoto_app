import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  StyleSheet,
  Image,
  TextInput,
  TouchableOpacity,
  FlatList,
  Platform,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
  Linking,
  InteractionManager,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  Search,
  Plus,
  Calendar,
  Image as ImageIcon,
  Smartphone,
  Inbox,
  Mail,
  Phone,
  LogOut,
  Sun,
  Moon,
  X,
  Shield,
  AlertCircle,
  Globe,
  MoreVertical,
  QrCode,
  Download,
} from 'lucide-react-native';
import { QRCodeView } from '@/components/QRCodeView';
import { tryGenerateEventLiveQrUrl } from '@/utils/eventQr';
import { qrExportService } from '@/services/qrExportService';
import { useNavigation } from '@react-navigation/native';
import { AppNavigationProp } from '@/navigation/types';
import { Text } from '@/components/Text';
import { COLORS, SPACING, useTheme } from '@/constants/theme';
import { FONTS } from '@/constants/typography';
import { useEvents, EventModel } from '@/hooks/useEvents';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/authService';
import { formatEventDate } from '@/utils/date';
import { AppBackground } from '@/components/AppBackground';
import { ensurePhotoDirectoryExists } from '@/services/localPhotoService';
import { permissionCoordinator } from '@/services/permissionCoordinator';

// Static asset mapping for local illustrations & photos
const LOCAL_ASSETS: Record<string, any> = {
  'assets/image.png': require('../../../assets/image.png'),
  hero3DArtwork: require('../../../assets/selectEvent/9e434fa2-04d9-4ac1-866e-19273e6d2658.png'),
};

// 4-point Sparkle Star Component
const SparkleStarSvg: React.FC<{ size?: number; color?: string; opacity?: number }> = ({
  size = 20,
  color = '#F5C242',
  opacity = 0.8,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 0L14.8 9.2L24 12L14.8 14.8L12 24L9.2 14.8L0 12L9.2 9.2L12 0Z"
      fill={color}
      opacity={opacity}
    />
  </Svg>
);

// Heuristic category extractor
const getCategoryFromTitle = (title: string, category?: string): string => {
  if (category) return category.toUpperCase();
  const t = title.toLowerCase();
  if (t.includes('wedding') && !t.includes('reception')) return 'WEDDING';
  if (t.includes('reception')) return 'RECEPTION';
  if (t.includes('birthday')) return 'BIRTHDAY';
  if (t.includes('corporate') || t.includes('meet') || t.includes('launch') || t.includes('summit'))
    return 'CORPORATE';
  if (t.includes('engagement')) return 'ENGAGEMENT';
  if (t.includes('baby shower')) return 'BABY SHOWER';
  if (t.includes('housewarming')) return 'HOUSEWARMING';
  if (t.includes('graduation')) return 'GRADUATION';
  if (t.includes('bridal')) return 'BRIDAL';
  if (t.includes('sports')) return 'SPORTS';
  return 'EVENT';
};

// Subtitle formatter
const getSubtitleFromTitle = (title: string, category?: string): string => {
  const cat = getCategoryFromTitle(title, category);
  switch (cat) {
    case 'WEDDING':
      return 'Wedding';
    case 'RECEPTION':
      return 'Reception';
    case 'BIRTHDAY':
      return 'Birthday';
    case 'CORPORATE':
      return 'Corporate Event';
    case 'ENGAGEMENT':
      return 'Engagement';
    case 'BABY SHOWER':
      return 'Baby Shower';
    case 'HOUSEWARMING':
      return 'Housewarming';
    case 'GRADUATION':
      return 'Graduation Day';
    case 'BRIDAL':
      return 'Bridal Shoot';
    case 'SPORTS':
      return 'Sports Event';
    default:
      return 'Special Event';
  }
};

export const SelectEventScreen: React.FC = () => {
  const navigation = useNavigation<AppNavigationProp>();
  const { isDark, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const logout = useAuthStore(state => state.logout);

  // Data Hooks - Connected to real backend API (/mobile/events/)
  const {
    data: events,
    isLoading: isEventsLoading,
    isRefetching,
    error: eventsError,
    refetch: refetchEvents,
  } = useEvents();
  const { data: currentUser } = useCurrentUser();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isProfileModalVisible, setIsProfileModalVisible] = useState(false);
  const [isMobileWarningModalVisible, setIsMobileWarningModalVisible] = useState(false);

  // ── 3-Dot Menu & QR Code Modal State ──────────────────────────────────────
  const [selectedMenuEvent, setSelectedMenuEvent] = useState<EventModel | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [selectedQrEvent, setSelectedQrEvent] = useState<EventModel | null>(null);
  const [isQrModalVisible, setIsQrModalVisible] = useState(false);
  const [isExportingQr, setIsExportingQr] = useState(false);
  const isMenuActionRef = useRef(false);

  const handleOpenEventMenu = useCallback((event: EventModel) => {
    isMenuActionRef.current = true;
    setSelectedMenuEvent(event);
    setIsMenuVisible(true);
    setTimeout(() => {
      isMenuActionRef.current = false;
    }, 400);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setIsMenuVisible(false);
  }, []);

  const handleShowQrCode = useCallback(() => {
    if (!selectedMenuEvent) return;
    const targetEvent = selectedMenuEvent;
    setIsMenuVisible(false);
    setSelectedQrEvent(targetEvent);
    setIsQrModalVisible(true);
  }, [selectedMenuEvent]);

  const handleCloseQrModal = useCallback(() => {
    setIsQrModalVisible(false);
  }, []);

  const handleDownloadQrCode = useCallback(async () => {
    if (!selectedQrEvent || isExportingQr) return;
    setIsExportingQr(true);
    try {
      const result = await qrExportService.downloadAndSaveEventQr(selectedQrEvent);
      if (result.success) {
        Alert.alert(
          'QR Code Saved',
          `The QR code for "${selectedQrEvent.title}" has been saved to your photo gallery.`,
        );
      } else if (result.permissionDenied) {
        Alert.alert(
          'Permission Required',
          'Storage permission is required to save the QR code to your gallery. Please grant access in app settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => permissionCoordinator.openAppSettings(),
            },
          ],
        );
      } else {
        Alert.alert('Download Failed', result.error || 'Failed to save QR code.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'An unexpected error occurred while saving.');
    } finally {
      setIsExportingQr(false);
    }
  }, [selectedQrEvent, isExportingQr]);

  // Compute QR URL dynamically from the selected QR event using Step 1 utility
  const qrUrlResult = useMemo(() => {
    if (!selectedQrEvent) {
      return { success: false, error: 'No event selected' };
    }
    return tryGenerateEventLiveQrUrl(selectedQrEvent);
  }, [selectedQrEvent]);

  // ── Permission Notice State & Folder Initialization (Trigger #1) ───────────
  const [permissionNotice, setPermissionNotice] = useState<{
    visible: boolean;
    type: 'denied' | 'blocked' | 'limited';
    message: string;
  }>({ visible: false, type: 'denied', message: '' });

  const hasInitializedFolderRef = useRef(false);

  const initPermissionsAndFolder = useCallback(async (force = false) => {
    try {
      const status = await permissionCoordinator.requestAppPermissions(force);

      if (status.isPhotoGranted || status.isPhotoLimited) {
        // Trigger 1: Folder creation when SelectEvent screen opens after permissions check
        if (!hasInitializedFolderRef.current) {
          const success = await ensurePhotoDirectoryExists(false);
          hasInitializedFolderRef.current = success;
        }

        if (status.isPhotoLimited) {
          setPermissionNotice({
            visible: true,
            type: 'limited',
            message:
              'Partial photo access granted. EntePhoto may not see all photos in the album until full access is granted.',
          });
        } else {
          setPermissionNotice(prev => (prev.visible ? { ...prev, visible: false } : prev));
        }
      } else {
        setPermissionNotice({
          visible: true,
          type: status.photo === 'blocked' ? 'blocked' : 'denied',
          message:
            'EntePhoto needs photo access to view and sync camera photos from your device storage.',
        });
      }
    } catch (err) {
      console.error('[SelectEventScreen] Permission and directory init error:', err);
    }
  }, []);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      initPermissionsAndFolder(false);
    });
    return () => handle.cancel();
  }, [initPermissionsAndFolder]);

  // ── Filtered + sorted event list ───────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    let result = events;
    if (query) {
      result = events.filter(event => {
        return (
          event.title.toLowerCase().includes(query) ||
          event.location.toLowerCase().includes(query) ||
          getCategoryFromTitle(event.title, event.category).toLowerCase().includes(query)
        );
      });
    }

    // Default newest-first date ordering
    return [...result].sort((a, b) => {
      return new Date(b.date.$date).getTime() - new Date(a.date.$date).getTime();
    });
  }, [events, searchQuery]);

  // Find selected event (used by mobile upload restriction explanation modal)
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find(e => e._id.$oid === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  // Guard against accidental double navigation while transition is underway
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      isNavigatingRef.current = false;
    });
    return unsubscribe;
  }, [navigation]);

  const handleCardPress = useCallback(
    async (event: EventModel) => {
      if (isNavigatingRef.current || isMenuActionRef.current) return;

      if (!event.mobile) {
        setSelectedEventId(event._id.$oid);
        setIsMobileWarningModalVisible(true);
        return;
      }

      // Check photo access before navigating to CameraConnect
      const photoStatus = await permissionCoordinator.checkPhotoPermission();
      if (photoStatus !== 'granted' && photoStatus !== 'limited') {
        Alert.alert(
          'Photo Access Required',
          `EntePhoto requires photo access to sync and save camera photos for "${event.title}".`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: photoStatus === 'blocked' ? 'Open Settings' : 'Grant Access',
              onPress: () => {
                if (photoStatus === 'blocked') {
                  permissionCoordinator.openAppSettings();
                } else {
                  initPermissionsAndFolder(true);
                }
              },
            },
          ],
        );
        return;
      }

      isNavigatingRef.current = true;
      console.log('[SelectEventScreen] Opening Event:', event.title);
      navigation.navigate('CameraConnect', {
        eventId: event._id.$oid,
        eventTitle: event.title,
        eventDate: event.date.$date,
        eventCategory: event.category,
        coverImage: event.coverImage,
      });

      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 1500);
    },
    [navigation, initPermissionsAndFolder],
  );

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setIsProfileModalVisible(false);
          await authService.signOut();
          logout();
        },
      },
    ]);
  }, [logout]);

  const handleCreateEvent = useCallback(async () => {
    const rawUrl = process.env.EXPO_PUBLIC_REDIRECT_URL;
    const trimmedBase = rawUrl?.trim();

    if (
      !trimmedBase ||
      (!trimmedBase.startsWith('http://') && !trimmedBase.startsWith('https://'))
    ) {
      Alert.alert(
        'Configuration Error',
        'No valid redirect URL configured. Please check your application settings.',
      );
      return;
    }

    const cleanBase = trimmedBase.replace(/\/+$/, '');
    const destinationUrl = `${cleanBase}/photographer/events`;

    try {
      await Linking.openURL(destinationUrl);
    } catch (error) {
      console.error('[SelectEventScreen] Failed to open create event URL:', error);
      Alert.alert('Error', 'Unable to open the create event page. Please try again later.');
    }
  }, []);

  const renderEventCard = useCallback(
    ({ item }: { item: EventModel }) => {
      const category = getCategoryFromTitle(item.title, item.category);
      const subtitle = getSubtitleFromTitle(item.title, item.category);
      const formattedDate = formatEventDate(item.date.$date);

      // Resolve cover image
      const localImageSource = item.coverImage ? LOCAL_ASSETS[item.coverImage] : null;
      const remoteImageSource =
        item.coverImage && item.coverImage.startsWith('http') ? { uri: item.coverImage } : null;
      const imageSource = localImageSource || remoteImageSource;

      return (
        <Pressable
          onPress={() => handleCardPress(item)}
          style={({ pressed }) => [
            styles.cardPressable,
            {
              transform: [{ scale: pressed ? 0.985 : 1 }],
              opacity: pressed ? 0.92 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${subtitle}, ${formattedDate}, ${item.photoCount} photos`}
          accessibilityHint="Tap to open this event"
        >
          {/*
           * Dedicated cardBox View: Owns the card's surface background, delicate border,
           * border-radius, elevation shadow, and padding. Using a dedicated View inside Pressable
           * guarantees Android/Hermes renders the unified rounded rectangle reliably without
           * dropping layout or background properties across renders.
           */}
          <View
            style={[
              styles.cardBox,
              {
                backgroundColor: isDark ? '#1E1E24' : '#F2ECE2',
                borderColor: isDark ? '#2E2E36' : '#DDD3C3',
              },
            ]}
          >
            {/* Thumbnail — outer container + inner clip with rounded corners */}
            <View style={styles.thumbnailContainer}>
              <View style={styles.thumbnailClip}>
                {imageSource ? (
                  <Image
                    source={imageSource}
                    style={styles.thumbnailImage}
                    resizeMode="cover"
                    accessibilityLabel={`${item.title} cover preview`}
                  />
                ) : (
                  <View
                    style={[
                      styles.thumbnailPlaceholder,
                      { backgroundColor: isDark ? '#2A2A32' : '#ECE5DB' },
                    ]}
                  >
                    <ImageIcon size={26} color={isDark ? '#5C5C6A' : '#A89E92'} strokeWidth={1.5} />
                  </View>
                )}

                {/* Category Tag pill on bottom-left of placeholder */}
                {!imageSource && (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryPillText}>{category}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Event Details — vertically centered beside thumbnail */}
            <View style={styles.eventInfo}>
              <View style={[styles.titleBlock, styles.eventTitleBlockWithMenu]}>
                <Text
                  style={[
                    styles.eventTitle,
                    { color: isDark ? COLORS.textHighContrast : '#161616' },
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.title}
                </Text>

                <Text
                  style={[styles.eventSubtitle, { color: isDark ? COLORS.textMuted : '#7A7571' }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {subtitle}
                </Text>
              </View>

              {/* Metadata Rows */}
              <View style={styles.metaContainer}>
                {/* Date Row */}
                <View style={styles.metaItem}>
                  <Calendar size={12} color={isDark ? COLORS.textDim : '#8B847D'} strokeWidth={2} />
                  <Text style={[styles.metaText, { color: isDark ? COLORS.textMuted : '#7A7571' }]}>
                    {formattedDate}
                  </Text>
                </View>

                {/* Photos Count Row */}
                <View style={styles.metaItem}>
                  <ImageIcon
                    size={12}
                    color={isDark ? COLORS.textDim : '#8B847D'}
                    strokeWidth={2}
                  />
                  <Text style={[styles.metaText, { color: isDark ? COLORS.textMuted : '#7A7571' }]}>
                    {item.photoCount.toLocaleString()} photos
                  </Text>
                </View>

                {/* Mobile indicator if enabled / disabled */}
                {item.mobile ? (
                  <View style={styles.metaItem} accessibilityLabel="Mobile upload enabled">
                    <Smartphone size={11} color="#22C55E" strokeWidth={2.2} />
                    <Text style={[styles.metaText, { color: '#22C55E', fontWeight: '700' }]}>
                      Mobile
                    </Text>
                  </View>
                ) : (
                  <View style={styles.metaItem} accessibilityLabel="Mobile upload not supported">
                    <Smartphone
                      size={11}
                      color={isDark ? '#71717A' : '#A89E92'}
                      strokeWidth={1.8}
                    />
                    <Text style={[styles.metaText, { color: isDark ? '#71717A' : '#A89E92' }]}>
                      No Mobile
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Three-Dot Menu Button */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={e => {
                e.stopPropagation?.();
                handleOpenEventMenu(item);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[
                styles.cardMenuBtn,
                {
                  backgroundColor: isDark ? '#26262E' : '#E8DFD4',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Options for ${item.title}`}
            >
              <MoreVertical size={16} color={isDark ? '#A1A1AA' : '#6B6560'} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        </Pressable>
      );
    },
    [isDark, handleCardPress, handleOpenEventMenu],
  );

  return (
    <AppBackground>
      {/* Floating Geometric Accent Shapes are scoped to the headerWrapper below */}

      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/*
         * headerWrapper — all decorative absolute elements live HERE,
         * so their % positions resolve against the header height (~290px),
         * not the full screen height. They can never drift into the list.
         */}
        <View style={styles.headerWrapper}>
          {/* ── DECORATIVE GEO SHAPES (absolute, scoped to header) ── */}
          {/* Gold sparkle — near the 3D illustration, top-right of hero */}
          <View pointerEvents="none" style={styles.geoGoldSparkle}>
            <SparkleStarSvg size={18} color="#F5C242" opacity={0.8} />
          </View>
          {/* Mint triangle — just above the gold sparkle */}
          <View pointerEvents="none" style={styles.geoMintTriangle} />
          {/* White/dark sparkle — lower edge of header, right side */}
          <View pointerEvents="none" style={styles.geoBlackSparkle}>
            <SparkleStarSvg size={20} color={isDark ? '#F4F4F5' : '#1A1A1A'} opacity={0.7} />
          </View>

          {/* ── HEADER BAR ── */}
          <View style={styles.headerRow}>
            {/* Brand Wordmark */}
            <View style={styles.brandContainer}>
              <Text style={[styles.brandText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                EntePhoto
                <Text style={{ color: '#FF6B4A' }}>.</Text>
              </Text>
            </View>

            {/* User Profile Avatar (Interactive Button) */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => setIsProfileModalVisible(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.avatarContainer, { borderColor: isDark ? '#3F3F46' : '#FFFFFF' }]}
              accessibilityRole="button"
              accessibilityLabel={`User profile: ${currentUser.name}. Tap to view options`}
            >
              <Image
                source={{ uri: currentUser.avatarUrl }}
                style={styles.avatarImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          </View>

          {/* ── HERO TITLE BLOCK WITH 3D CLAY CAMERA & CALENDAR ARTWORK ── */}
          <View style={styles.heroSection}>
            <View style={styles.heroTextCol}>
              <Text style={[styles.heroHeadline, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                Select{'\n'}your{'\n'}event
                <Text style={{ color: '#FF6B4A' }}>.</Text>
              </Text>
              <Text style={[styles.heroSubtext, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                Where would you like to{'\n'}send your photos?
              </Text>
            </View>

            {/* 3D Clay Camera & Calendar Visual Asset — flex sibling, not absolute */}
            <View pointerEvents="none" style={styles.heroGraphicContainer}>
              <Image
                source={LOCAL_ASSETS.hero3DArtwork}
                style={styles.hero3DImage}
                resizeMode="contain"
                accessibilityLabel="3D Camera and Calendar"
              />
            </View>
          </View>

          {/* ── PERMISSION NOTICE BANNER ── */}
          {permissionNotice.visible && (
            <View
              style={[
                styles.permissionBanner,
                {
                  backgroundColor: isDark ? '#1F1B18' : '#FFF7ED',
                  borderColor: isDark ? '#FF6B4A' : '#FDBA74',
                },
              ]}
            >
              <View style={styles.permissionBannerIconCol}>
                <AlertCircle size={20} color="#FF6B4A" strokeWidth={2.4} />
              </View>
              <View style={styles.permissionBannerContent}>
                <Text
                  style={[styles.permissionBannerTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                >
                  {permissionNotice.type === 'limited'
                    ? 'Partial Photo Access'
                    : 'Photo Access Needed'}
                </Text>
                <Text
                  style={[styles.permissionBannerText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                >
                  {permissionNotice.message}
                </Text>
                <View style={styles.permissionBannerActions}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      if (
                        permissionNotice.type === 'blocked' ||
                        permissionNotice.type === 'limited'
                      ) {
                        permissionCoordinator.openAppSettings();
                      } else {
                        initPermissionsAndFolder(true);
                      }
                    }}
                    style={styles.permissionActionBtn}
                  >
                    <Text style={styles.permissionActionBtnText}>
                      {permissionNotice.type === 'blocked' || permissionNotice.type === 'limited'
                        ? 'Open Settings'
                        : 'Grant Permission'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setPermissionNotice(prev => ({ ...prev, visible: false }))}
                    style={styles.permissionDismissBtn}
                    accessibilityLabel="Dismiss permission notice"
                  >
                    <X size={16} color={isDark ? '#71717A' : '#A1A1AA'} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ── SEARCH & FILTER ROW ── */}
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchInputContainer,
                {
                  backgroundColor: isDark ? '#1A1A1E' : 'rgba(239, 233, 223, 0.65)',
                  borderColor: isDark ? '#2E2E36' : 'transparent',
                },
              ]}
            >
              <Search
                size={17}
                color={isDark ? '#71717A' : '#756E68'}
                strokeWidth={2.2}
                style={styles.searchIcon}
              />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search events"
                placeholderTextColor={isDark ? '#71717A' : '#8B847D'}
                style={[styles.searchInput, { color: isDark ? '#F4F4F5' : '#161616' }]}
                clearButtonMode="while-editing"
                returnKeyType="search"
                accessibilityLabel="Search events"
              />
            </View>

            {/* Create Event (+) Button */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleCreateEvent}
              accessibilityRole="button"
              accessibilityLabel="Create new event"
              style={[
                styles.createEventButton,
                {
                  backgroundColor: isDark ? '#1A1A1E' : 'rgba(239, 233, 223, 0.65)',
                  borderColor: isDark ? '#2E2E36' : 'transparent',
                },
              ]}
            >
              <Plus size={20} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        </View>
        {/* end headerWrapper */}

        {/* ── EVENT LIST (FLATLIST) ── */}
        {isEventsLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FF6B4A" />
          </View>
        ) : (
          <FlatList
            data={filteredEvents}
            keyExtractor={item => item._id.$oid || item.id}
            renderItem={renderEventCard}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Math.max(insets.bottom + 16, 24) },
            ]}
            showsVerticalScrollIndicator={false}
            refreshing={isRefetching}
            onRefresh={refetchEvents}
            ListEmptyComponent={
              eventsError ? (
                <View style={styles.emptyContainer}>
                  <AlertCircle size={36} color="#FF6B4A" strokeWidth={1.5} />
                  <Text style={[styles.emptyTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                    Failed to load events
                  </Text>
                  <Text style={[styles.emptySubtext, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                    {eventsError.message || 'Unable to connect to server. Please try again.'}
                  </Text>
                  <TouchableOpacity onPress={() => refetchEvents()} style={styles.emptyRetryButton}>
                    <Text style={styles.emptyRetryButtonText}>Tap to Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Inbox size={36} color={isDark ? '#71717A' : '#A89E92'} strokeWidth={1.5} />
                  <Text style={[styles.emptyTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                    No events found
                  </Text>
                  <Text style={[styles.emptySubtext, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                    {searchQuery
                      ? `No events matching "${searchQuery}".`
                      : 'No active events available to display.'}
                  </Text>
                </View>
              )
            }
          />
        )}
      </SafeAreaView>

      {/* ── INTERACTIVE PROFILE BOTTOM SHEET / MODAL ── */}
      <Modal
        visible={isProfileModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsProfileModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropTouch}
            onPress={() => setIsProfileModalVisible(false)}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFFDF9',
                borderColor: isDark ? '#2E2E36' : '#E8DFD4',
              },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHandle} />
              <TouchableOpacity
                onPress={() => setIsProfileModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#26262E' : '#F1E9DF' }]}
              >
                <X size={18} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>

            {/* Profile Info Header */}
            <View style={styles.modalProfileRow}>
              <View style={styles.modalAvatarBox}>
                <Image
                  source={{ uri: currentUser.avatarUrl }}
                  style={styles.modalAvatarImage}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.modalProfileTexts}>
                <Text style={[styles.modalName, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  {currentUser.name}
                </Text>
                <View style={styles.modalRoleBadge}>
                  <Shield size={11} color="#FF6B4A" strokeWidth={2.4} />
                  <Text style={styles.modalRoleText}>{currentUser.role.toUpperCase()}</Text>
                </View>
              </View>
            </View>

            {/* Details List */}
            <View
              style={[
                styles.modalDetailsBox,
                {
                  backgroundColor: isDark ? '#131315' : '#F5EFE6',
                  borderColor: isDark ? '#2E2E36' : '#E8DFD4',
                },
              ]}
            >
              <View style={styles.detailRow}>
                <Mail size={16} color={isDark ? '#A1A1AA' : '#7A7571'} strokeWidth={2} />
                <Text style={[styles.detailText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  {currentUser.email}
                </Text>
              </View>

              <View style={styles.detailDivider} />

              <View style={styles.detailRow}>
                <Phone size={16} color={isDark ? '#A1A1AA' : '#7A7571'} strokeWidth={2} />
                <Text style={[styles.detailText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  +91 {currentUser.phoneNumber}
                </Text>
              </View>
            </View>

            {/* Actions: Theme Toggle & Sign Out */}
            <View style={styles.modalActionsRow}>
              {/* Theme Toggle Button */}
              <TouchableOpacity
                onPress={toggleTheme}
                activeOpacity={0.8}
                style={[
                  styles.modalActionBtn,
                  {
                    backgroundColor: isDark ? '#26262E' : '#EFE9DF',
                    borderColor: isDark ? '#3F3F46' : '#DFCFC2',
                  },
                ]}
              >
                {isDark ? (
                  <Sun size={17} color="#FBBF24" strokeWidth={2.2} />
                ) : (
                  <Moon size={17} color="#2563EB" strokeWidth={2.2} />
                )}
                <Text style={[styles.modalActionText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  {isDark ? 'Light Mode' : 'Dark Mode'}
                </Text>
              </TouchableOpacity>

              {/* Sign Out Button */}
              <TouchableOpacity
                onPress={handleSignOut}
                activeOpacity={0.8}
                style={[
                  styles.modalActionBtn,
                  {
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                  },
                ]}
              >
                <LogOut size={17} color="#EF4444" strokeWidth={2.2} />
                <Text style={[styles.modalActionText, { color: '#EF4444', fontWeight: '700' }]}>
                  Sign Out
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MOBILE UPLOAD RESTRICTION EXPLANATION MODAL ── */}
      <Modal
        visible={isMobileWarningModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsMobileWarningModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropTouch}
            onPress={() => setIsMobileWarningModalVisible(false)}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFFDF9',
                borderColor: isDark ? '#2E2E36' : '#E8DFD4',
              },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHandle} />
              <TouchableOpacity
                onPress={() => setIsMobileWarningModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#26262E' : '#F1E9DF' }]}
              >
                <X size={18} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>

            {/* Icon & Event Badge */}
            <View style={styles.warningModalIconContainer}>
              <View
                style={[
                  styles.warningModalIconCircle,
                  { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.18)' : '#FEF2F2' },
                ]}
              >
                <Globe size={28} color={isDark ? '#F87171' : '#DC2626'} strokeWidth={2} />
              </View>
              {selectedEvent && (
                <View
                  style={[
                    styles.warningEventTag,
                    { backgroundColor: isDark ? '#26262E' : 'rgba(239, 233, 223, 0.8)' },
                  ]}
                >
                  <Text
                    style={[styles.warningEventTagText, { color: isDark ? '#F4F4F5' : '#161616' }]}
                    numberOfLines={1}
                  >
                    {selectedEvent.title}
                  </Text>
                </View>
              )}
            </View>

            {/* Title & Core Explanation */}
            <Text style={[styles.warningModalTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
              Browser Upload Only
            </Text>

            <Text style={[styles.warningModalMessage, { color: isDark ? '#D4D4D8' : '#4B4643' }]}>
              You chose the basic plan for uploading photos, so you can only upload from browser.
            </Text>

            {/* Feature Information Cards */}
            <View
              style={[
                styles.warningInfoCard,
                {
                  backgroundColor: isDark ? '#141416' : '#F9F6F0',
                  borderColor: isDark ? '#2E2E36' : '#E8DFD4',
                },
              ]}
            >
              <View style={styles.warningInfoItem}>
                <Globe size={18} color="#FF6B4A" strokeWidth={2} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.warningInfoItemTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                  >
                    Web Dashboard
                  </Text>
                  <Text
                    style={[styles.warningInfoItemDesc, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                  >
                    Open your event portal on any desktop or tablet browser to upload and curate
                    photos.
                  </Text>
                </View>
              </View>

              <View
                style={[styles.warningDivider, { backgroundColor: isDark ? '#2E2E36' : '#E8DFD4' }]}
              />

              <View style={styles.warningInfoItem}>
                <Smartphone size={18} color="#45DFA4" strokeWidth={2} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.warningInfoItemTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                  >
                    Need Mobile Upload?
                  </Text>
                  <Text
                    style={[styles.warningInfoItemDesc, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                  >
                    Upgrade this event to a Pro or Mobile-enabled plan via the web dashboard to
                    enable direct mobile uploads.
                  </Text>
                </View>
              </View>
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsMobileWarningModalVisible(false)}
              style={[styles.warningModalBtn, { backgroundColor: isDark ? '#FF6B4A' : '#161616' }]}
            >
              <Text style={styles.warningModalBtnText}>Got It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── EVENT CARD OPTIONS POPUP (3-DOT MENU) ── */}
      <Modal
        visible={isMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMenu}
      >
        <View style={styles.popupBackdrop}>
          <Pressable style={styles.popupBackdropTouch} onPress={handleCloseMenu} />
          <View
            style={[
              styles.popupCard,
              {
                backgroundColor: isDark ? '#1E1E24' : '#FAF6F0',
                borderColor: isDark ? '#2E2E36' : '#DDD3C3',
              },
            ]}
          >
            {/* Header displaying event name */}
            <View style={styles.popupHeader}>
              <Text
                style={[styles.popupEventName, { color: isDark ? '#F4F4F5' : '#161616' }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {selectedMenuEvent?.title}
              </Text>
            </View>
            <View
              style={[styles.popupDivider, { backgroundColor: isDark ? '#2E2E36' : '#E8DFD4' }]}
            />

            {/* Exactly ONE option: Show QR Code */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleShowQrCode}
              style={[styles.popupActionRow, { backgroundColor: isDark ? '#26262E' : '#F2ECE2' }]}
              accessibilityRole="button"
              accessibilityLabel="Show QR Code"
            >
              <View
                style={[
                  styles.popupIconCircle,
                  { backgroundColor: isDark ? '#32323A' : '#E5DDD0' },
                ]}
              >
                <QrCode size={18} color="#FF6B4A" strokeWidth={2.2} />
              </View>
              <Text style={[styles.popupActionLabel, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                Show QR Code
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── EVENT QR CODE MODAL / BOTTOM SHEET ── */}
      <Modal
        visible={isQrModalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseQrModal}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropTouch} onPress={handleCloseQrModal} />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: isDark ? '#18181B' : '#FAF6F0',
                borderColor: isDark ? '#2E2E36' : '#E8DFD4',
              },
            ]}
          >
            {/* Modal Header Handle & Close Button */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHandle} />
              <TouchableOpacity
                onPress={handleCloseQrModal}
                accessibilityRole="button"
                accessibilityLabel="Close QR Code dialog"
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#26262E' : '#F1E9DF' }]}
              >
                <X size={16} color={isDark ? '#A1A1AA' : '#7A7571'} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.qrScrollContent}
            >
              {/* Heading & Subtitle */}
              <View style={styles.qrHeaderBlock}>
                <View style={styles.qrTitleRow}>
                  <Text style={[styles.qrModalTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                    Event QR Code
                  </Text>
                  {/* Subtle teal accent tag */}
                  <View
                    style={[
                      styles.qrTealBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(69, 223, 164, 0.15)'
                          : 'rgba(27, 184, 122, 0.12)',
                      },
                    ]}
                  >
                    <Text
                      style={[styles.qrTealBadgeText, { color: isDark ? '#45DFA4' : '#1BB87A' }]}
                    >
                      LIVE
                    </Text>
                  </View>
                </View>
                <Text style={[styles.qrModalSubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                  Scan this QR code to upload photos to this event.
                </Text>
              </View>

              {/* Event Context Card (Name and Date) */}
              <View
                style={[
                  styles.qrEventContextCard,
                  {
                    backgroundColor: isDark ? '#222228' : '#F2ECE2',
                    borderColor: isDark ? '#2E2E36' : '#DDD3C3',
                  },
                ]}
              >
                <Text
                  style={[styles.qrEventName, { color: isDark ? '#F4F4F5' : '#161616' }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {selectedQrEvent?.title || 'Event'}
                </Text>
                <View style={styles.qrEventMetaRow}>
                  <Calendar size={13} color={isDark ? '#A1A1AA' : '#7A7571'} strokeWidth={2} />
                  <Text style={[styles.qrEventDate, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                    {selectedQrEvent?.date?.$date
                      ? formatEventDate(selectedQrEvent.date.$date)
                      : 'Upcoming'}
                  </Text>
                </View>
              </View>

              {/* QR Code Scannable Surface */}
              <View style={styles.qrCodeWrapper}>
                <View
                  style={[
                    styles.qrCodeClaySurface,
                    {
                      backgroundColor: '#FFFFFF',
                      borderColor: isDark ? '#3F3F46' : '#E8DFD4',
                    },
                  ]}
                >
                  {qrUrlResult.success && qrUrlResult.url ? (
                    <QRCodeView
                      value={qrUrlResult.url}
                      size={200}
                      quietZone={4}
                      color="#000000"
                      backgroundColor="#FFFFFF"
                    />
                  ) : (
                    <View style={styles.qrErrorState}>
                      <AlertCircle size={32} color="#EF4444" strokeWidth={2} />
                      <Text
                        style={[styles.qrErrorTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                      >
                        Unable to generate QR
                      </Text>
                      <Text
                        style={[
                          styles.qrErrorDescription,
                          { color: isDark ? '#A1A1AA' : '#7A7571' },
                        ]}
                      >
                        {qrUrlResult.error || 'Invalid event or configuration'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Download QR Code Button (Prominent tactile button) */}
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={handleDownloadQrCode}
                disabled={isExportingQr}
                style={[
                  styles.downloadQrBtn,
                  {
                    backgroundColor: isDark ? '#FF6B4A' : '#161616',
                    opacity: isExportingQr ? 0.72 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isExportingQr ? 'Saving QR code...' : 'Download QR Code'}
              >
                {isExportingQr ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Download size={19} color="#FFFFFF" strokeWidth={2.4} />
                )}
                <Text style={styles.downloadQrBtnText}>
                  {isExportingQr ? 'Saving QR Code...' : 'Download QR Code'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppBackground>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
  },
  safeArea: {
    flex: 1,
  },

  // Ambient Blurry Blobs
  blobTopLeft: {
    position: 'absolute',
    top: -55,
    left: -70,
    width: 220,
    height: 220,
  },
  blobMidLeft: {
    position: 'absolute',
    top: '26%',
    left: -60,
    width: 160,
    height: 160,
  },
  blobBottomRight: {
    position: 'absolute',
    bottom: -70,
    right: -60,
    width: 260,
    height: 260,
  },

  // ── Floating Geo Shapes ───────────────────────────────────────────────────
  // These are children of headerWrapper, so % resolves against header height
  // (~290px), not the full screen. They are guaranteed to stay within the
  // header zone and never bleed into the event list below.
  //
  // Header zones (approx):
  //   0%–25%  → headerRow (logo/avatar bar)
  //   25%–75% → heroSection (title + 3D illustration)
  //   75%–100%→ searchRow
  //
  geoGoldSparkle: {
    position: 'absolute',
    top: '38%', // mid-hero, near illustration
    right: '28%', // left of the illustration's left edge
    zIndex: 2,
  },
  geoMintTriangle: {
    position: 'absolute',
    top: '28%', // upper hero, just above gold sparkle
    right: '22%',
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#7FE0B5',
    transform: [{ rotate: '28deg' }],
    opacity: 0.75,
    zIndex: 2,
  },
  // Small sparkle near the bottom-right of the search row
  geoBlackSparkle: {
    position: 'absolute',
    bottom: 18,
    right: 10,
    width: 22,
    height: 22,
    zIndex: 2,
  },

  // ── Header Wrapper ─────────────────────────────────────────────────────────
  // Scopes all decorative absolute-positioned children to the header area.
  // overflow: 'visible' so blob gradients can bleed out of bounds.
  headerWrapper: {
    overflow: 'visible',
  },

  // Header Row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    zIndex: 10,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: '#D6CEBF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },

  // Hero Section
  heroSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
    minHeight: 140,
    zIndex: 10,
  },
  // Takes remaining width after the graphic; shrinks on smaller phones
  heroTextCol: {
    flex: 1,
    paddingRight: 8,
  },
  heroHeadline: {
    fontFamily: FONTS.syne.extraBold,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  heroSubtext: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    fontFamily: FONTS.plusJakartaSans.medium,
  },
  // Flex sibling — no absolute positioning; stays in flow next to text
  heroGraphicContainer: {
    width: 155,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  hero3DImage: {
    width: '100%',
    height: '100%',
  },

  // Search & Filter
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    marginTop: 4,
    marginBottom: 16,
    zIndex: 10,
  },
  searchInputContainer: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.plusJakartaSans.medium,
    height: '100%',
  },

  // FlatList & Cards
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  cardPressable: {
    width: '100%',
    alignSelf: 'stretch',
  },
  cardBox: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1.2,
    shadowColor: '#2D2218',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  thumbnailContainer: {
    width: 88,
    height: 88,
    flexShrink: 0,
    backgroundColor: '#E5E5E5',
    borderRadius: 14,
  },
  thumbnailClip: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryPill: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  categoryPillText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Event Info (matching 88px thumbnail height, vertically centered)
  eventInfo: {
    flex: 1,
    height: 88,
    marginLeft: 14,
    justifyContent: 'center',
    minWidth: 0,
  },
  titleBlock: {
    marginBottom: 5,
  },
  eventTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  eventSubtitle: {
    fontSize: 12.5,
    lineHeight: 16,
    fontFamily: FONTS.plusJakartaSans.medium,
    marginTop: 1,
  },
  metaContainer: {
    gap: 2.5,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 11.5,
    fontFamily: FONTS.plusJakartaSans.medium,
    lineHeight: 15,
  },

  // Empty & Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING['3xl'],
  },
  emptyContainer: {
    paddingVertical: SPACING['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: SPACING.xl,
  },
  emptyTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  emptySubtext: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: FONTS.plusJakartaSans.regular,
  },
  emptyRetryButton: {
    marginTop: 14,
    backgroundColor: '#FF6B4A',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRetryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONTS.plusJakartaSans.bold,
  },

  // Profile Modal / Bottom Sheet
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    flex: 1,
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalHandle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(128, 128, 128, 0.4)',
    alignSelf: 'center',
    marginLeft: 32,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 16,
  },
  modalAvatarBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#FF6B4A',
    overflow: 'hidden',
  },
  modalAvatarImage: {
    width: '100%',
    height: '100%',
  },
  modalProfileTexts: {
    flex: 1,
    gap: 4,
  },
  modalName: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  modalRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 107, 74, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  modalRoleText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FF6B4A',
    letterSpacing: 0.6,
  },
  modalDetailsBox: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailText: {
    fontSize: 14,
    fontFamily: FONTS.plusJakartaSans.medium,
    fontWeight: '500',
  },
  detailDivider: {
    height: 1,
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modalActionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalActionText: {
    fontSize: 13,
    fontFamily: FONTS.plusJakartaSans.bold,
    fontWeight: '700',
  },

  // Mobile Warning Modal Styles
  warningModalIconContainer: {
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  warningModalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningEventTag: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: '85%',
  },
  warningEventTagText: {
    fontSize: 12,
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontWeight: '600',
  },
  warningModalTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  warningModalMessage: {
    fontSize: 14,
    fontFamily: FONTS.plusJakartaSans.medium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  warningInfoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
    gap: 14,
  },
  warningInfoItem: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  warningInfoItemTitle: {
    fontSize: 14,
    fontFamily: FONTS.plusJakartaSans.bold,
    fontWeight: '700',
    marginBottom: 2,
  },
  warningInfoItemDesc: {
    fontSize: 12,
    fontFamily: FONTS.plusJakartaSans.regular,
    lineHeight: 17,
  },
  warningDivider: {
    height: 1,
  },
  warningModalBtn: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningModalBtnText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
    fontWeight: '700',
  },

  // Create Event Button
  createEventButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Permission Notice Banner
  permissionBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    zIndex: 10,
  },
  permissionBannerIconCol: {
    marginTop: 2,
  },
  permissionBannerContent: {
    flex: 1,
  },
  permissionBannerTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14,
    marginBottom: 2,
  },
  permissionBannerText: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  permissionBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  permissionActionBtn: {
    backgroundColor: '#FF6B4A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  permissionActionBtnText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  permissionDismissBtn: {
    padding: 4,
  },

  // Card Three-Dot Menu Button
  cardMenuBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  eventTitleBlockWithMenu: {
    paddingRight: 26,
  },

  // ── 3-Dot Menu Popup Styles ──
  popupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  popupBackdropTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  popupCard: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 20,
    borderWidth: 1.2,
    padding: 16,
    shadowColor: '#2D2218',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 20,
  },
  popupHeader: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  popupEventName: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    lineHeight: 19,
  },
  popupDivider: {
    height: 1,
    marginVertical: 10,
  },
  popupActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 12,
  },
  popupIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupActionLabel: {
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontSize: 14,
  },

  // ── QR Code Modal Styles ──
  qrScrollContent: {
    paddingBottom: 8,
  },
  qrHeaderBlock: {
    marginBottom: 14,
  },
  qrTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  qrModalTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  qrTealBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  qrTealBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  qrModalSubtitle: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  qrEventContextCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 4,
  },
  qrEventName: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    lineHeight: 19,
  },
  qrEventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qrEventDate: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
  },
  qrCodeWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  qrCodeClaySurface: {
    padding: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    shadowColor: '#2D2218',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 232,
    minHeight: 232,
  },
  qrErrorState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 6,
    maxWidth: 200,
  },
  qrErrorTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14,
    textAlign: 'center',
  },
  qrErrorDescription: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
  },
  downloadQrBtn: {
    height: 52,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#2D2218',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 4,
  },
  downloadQrBtnText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
