import React, { useState, useMemo, useCallback } from 'react';
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
  Alert,
  Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  Search,
  SlidersHorizontal,
  Calendar,
  Image as ImageIcon,
  Check,
  ChevronRight,
  ArrowRight,
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
} from 'lucide-react-native';
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

  // ── Filter sheet state ──────────────────────────────────────────────────────
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  // Draft (inside sheet, not yet applied)
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [draftStatus, setDraftStatus] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [draftSort, setDraftSort] = useState<'newest' | 'oldest'>('newest');
  // Applied (actually used to filter the list)
  const [appliedCategories, setAppliedCategories] = useState<string[]>([]);
  const [appliedStatus, setAppliedStatus] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [appliedSort, setAppliedSort] = useState<'newest' | 'oldest'>('newest');

  const hasActiveFilters =
    appliedCategories.length > 0 || appliedStatus !== 'all' || appliedSort !== 'newest';

  // Sheet slide animation
  const sheetTranslateY = useMemo(() => new Animated.Value(500), []);
  const sheetOpacity = useMemo(() => new Animated.Value(0), []);

  // Filter button animations
  const filterPressScale = useMemo(() => new Animated.Value(1), []);
  const filterRotate = useMemo(() => new Animated.Value(0), []);

  const openFilterSheet = useCallback(() => {
    // Sync draft with applied
    setDraftCategories(appliedCategories);
    setDraftStatus(appliedStatus);
    setDraftSort(appliedSort);
    setIsFilterSheetOpen(true);
    // Animate in
    Animated.parallel([
      Animated.timing(sheetTranslateY, { toValue: 0, duration: 340, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [appliedCategories, appliedStatus, appliedSort, sheetTranslateY, sheetOpacity]);

  const closeFilterSheet = useCallback(
    (apply = false) => {
      if (apply) {
        setAppliedCategories(draftCategories);
        setAppliedStatus(draftStatus);
        setAppliedSort(draftSort);
      }
      Animated.parallel([
        Animated.timing(sheetTranslateY, { toValue: 500, duration: 280, useNativeDriver: true }),
        Animated.timing(sheetOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setIsFilterSheetOpen(false));
    },
    [draftCategories, draftStatus, draftSort, sheetTranslateY, sheetOpacity],
  );

  const handleFilterPress = useCallback(() => {
    // Scale bounce
    Animated.sequence([
      Animated.spring(filterPressScale, {
        toValue: 0.82,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }),
      Animated.spring(filterPressScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 14,
      }),
    ]).start();
    // Icon rotation
    Animated.timing(filterRotate, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start(() =>
      Animated.timing(filterRotate, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }).start(),
    );
    openFilterSheet();
  }, [filterPressScale, filterRotate, openFilterSheet]);

  const toggleDraftCategory = useCallback((cat: string) => {
    setDraftCategories(prev => (prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]));
  }, []);

  const clearAllFilters = useCallback(() => {
    setAppliedCategories([]);
    setAppliedStatus('all');
    setAppliedSort('newest');
    setDraftCategories([]);
    setDraftStatus('all');
    setDraftSort('newest');
  }, []);

  // ── Filtered + sorted event list ───────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    const now = new Date();
    const query = searchQuery.trim().toLowerCase();

    let result = events.filter(event => {
      // Text search
      if (
        query &&
        !event.title.toLowerCase().includes(query) &&
        !event.location.toLowerCase().includes(query) &&
        !getCategoryFromTitle(event.title, event.category).toLowerCase().includes(query)
      )
        return false;

      // Category filter
      if (
        appliedCategories.length > 0 &&
        !appliedCategories.includes(getCategoryFromTitle(event.title, event.category))
      )
        return false;

      // Status filter
      const eventDate = new Date(event.date.$date);
      if (appliedStatus === 'upcoming' && eventDate <= now) return false;
      if (appliedStatus === 'completed' && eventDate > now) return false;

      return true;
    });

    // Sort
    result = [...result].sort((a, b) => {
      const diff = new Date(a.date.$date).getTime() - new Date(b.date.$date).getTime();
      return appliedSort === 'newest' ? -diff : diff;
    });

    return result;
  }, [events, searchQuery, appliedCategories, appliedStatus, appliedSort]);

  // Find selected event and check if mobile access is allowed
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find(e => e._id.$oid === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const isMobileAllowed = Boolean(selectedEvent && selectedEvent.mobile === true);
  const isContinueDisabled = !selectedEvent || !isMobileAllowed;

  const handleSelectEvent = useCallback((eventId: string) => {
    setSelectedEventId(prev => (prev === eventId ? null : eventId));
  }, []);

  const handleContinue = useCallback(() => {
    if (!selectedEvent) return;
    if (!selectedEvent.mobile) {
      setIsMobileWarningModalVisible(true);
      return;
    }
    console.log('[SelectEventScreen] Continuing with Event:', selectedEvent.title);
    navigation.navigate('CameraConnect', {
      eventId: selectedEvent._id.$oid,
      eventTitle: selectedEvent.title,
      eventDate: selectedEvent.date.$date,
      eventCategory: selectedEvent.category,
      coverImage: selectedEvent.coverImage,
    });
  }, [selectedEvent, navigation]);

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

  const renderEventCard = useCallback(
    ({ item }: { item: EventModel }) => {
      const isSelected = selectedEventId === item._id.$oid;
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
          onPress={() => handleSelectEvent(item._id.$oid)}
          style={({ pressed }) => [
            styles.cardWrapper,
            {
              backgroundColor: isSelected
                ? isDark
                  ? 'rgba(255, 107, 74, 0.16)'
                  : '#FFF1ED'
                : isDark
                  ? '#1A1A1E'
                  : 'rgba(255, 253, 251, 0.85)',
              borderColor: isSelected ? '#FF7D5C' : isDark ? '#2E2E36' : 'rgba(220, 214, 206, 0.7)',
              borderWidth: isSelected ? 2 : 1,
              shadowColor: isSelected ? '#FF6B4A' : '#161616',
              shadowOpacity: isSelected ? 0.14 : 0.04,
              shadowRadius: isSelected ? 14 : 6,
              elevation: isSelected ? 3 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
          ]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`${item.title}, ${subtitle}, ${formattedDate}, ${item.photoCount} photos. ${isSelected ? 'Selected' : 'Not selected'}`}
          accessibilityHint="Double tap to select this event"
        >
          {/*
           * cardRow: an inner plain-object-style View that owns ALL flex row geometry.
           * Pressable's function-style prop creates a new array every render; on Android
           * (RN 0.86 + Hermes) this can silently drop flexDirection from the merged base
           * stylesheet. A dedicated child View with a static style is immune to this.
           */}
          <View style={styles.cardRow}>
            {/* Thumbnail — outer container (no overflow) + inner clip (overflow:hidden) */}
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
                      { backgroundColor: isDark ? '#2A2A32' : '#E8E2D8' },
                    ]}
                  >
                    <ImageIcon size={26} color={isDark ? '#5C5C6A' : '#A89E92'} strokeWidth={1.5} />
                  </View>
                )}

                {/* Category Tag pill on bottom-left — absolute relative to thumbnailClip */}
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryPillText}>{category}</Text>
                </View>
              </View>
            </View>

            {/* Event Details (Strictly Height-Aligned 82px) */}
            <View style={styles.eventInfo}>
              <View>
                <Text
                  style={[
                    styles.eventTitle,
                    { color: isDark ? COLORS.textHighContrast : '#161616' },
                  ]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>

                <Text
                  style={[styles.eventSubtitle, { color: isDark ? COLORS.textMuted : '#7A7571' }]}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              </View>

              {/* Metadata Rows (Pinned to bottom) */}
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
                    <Smartphone size={11} color="#45DFA4" strokeWidth={2.2} />
                    <Text style={[styles.metaText, { color: '#45DFA4', fontWeight: '700' }]}>
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

            {/* Right Action Column (Strictly Height-Aligned 82px) */}
            <View style={styles.rightActionCol}>
              {/* Top Circle Badge (Tick / Chevron) */}
              {isSelected ? (
                <View
                  style={[styles.checkCircle, { backgroundColor: isDark ? '#FF6B4A' : '#161616' }]}
                >
                  <Check size={14} color="#FFFFFF" strokeWidth={3} />
                </View>
              ) : (
                <View
                  style={[
                    styles.chevronCircle,
                    { backgroundColor: isDark ? '#26262E' : 'rgba(239, 233, 223, 0.8)' },
                  ]}
                >
                  <ChevronRight
                    size={14}
                    color={isDark ? COLORS.textHighContrast : '#161616'}
                    strokeWidth={2.4}
                  />
                </View>
              )}
            </View>
          </View>
        </Pressable>
      );
    },
    [selectedEventId, isDark, handleSelectEvent],
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
                Select{'\n'}your event
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

            {/* Filter Button — animated */}
            <Animated.View
              style={[styles.filterButtonWrapper, { transform: [{ scale: filterPressScale }] }]}
            >
              <Pressable
                onPress={handleFilterPress}
                accessibilityLabel="Filter events"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.filterButton,
                  {
                    backgroundColor: hasActiveFilters
                      ? isDark
                        ? 'rgba(255, 107, 74, 0.18)'
                        : 'rgba(255, 107, 74, 0.12)'
                      : isDark
                        ? '#1A1A1E'
                        : 'rgba(239, 233, 223, 0.65)',
                    borderColor: hasActiveFilters ? '#FF6B4A' : isDark ? '#2E2E36' : 'transparent',
                    shadowColor: hasActiveFilters ? '#FF6B4A' : 'transparent',
                    shadowOpacity: hasActiveFilters ? 0.45 : 0,
                    shadowRadius: hasActiveFilters ? 10 : 0,
                    elevation: hasActiveFilters ? 6 : 0,
                  },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: filterRotate.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '45deg'],
                        }),
                      },
                    ],
                  }}
                >
                  <SlidersHorizontal
                    size={18}
                    color={hasActiveFilters ? '#FF6B4A' : isDark ? '#F4F4F5' : '#161616'}
                    strokeWidth={2}
                  />
                </Animated.View>
                {/* Active badge dot */}
                {hasActiveFilters && (
                  <View style={[styles.filterBadgeDot, { backgroundColor: '#FF6B4A' }]} />
                )}
              </Pressable>
            </Animated.View>
          </View>

          {/* ── ACTIVE FILTER CHIPS (scrollable strip) ── */}
          {hasActiveFilters && (
            <View style={styles.activeChipsRow}>
              {appliedStatus !== 'all' && (
                <Pressable
                  onPress={() => setAppliedStatus('all')}
                  style={[
                    styles.activeChip,
                    {
                      backgroundColor: isDark ? 'rgba(255,107,74,0.18)' : 'rgba(255,107,74,0.12)',
                      borderColor: '#FF6B4A',
                    },
                  ]}
                >
                  <Text style={styles.activeChipText}>
                    {appliedStatus === 'upcoming' ? '⏳ Upcoming' : '✓ Completed'}
                  </Text>
                  <X size={10} color="#FF6B4A" strokeWidth={2.5} />
                </Pressable>
              )}
              {appliedCategories.map(cat => (
                <Pressable
                  key={cat}
                  onPress={() => setAppliedCategories(prev => prev.filter(c => c !== cat))}
                  style={[
                    styles.activeChip,
                    {
                      backgroundColor: isDark ? 'rgba(255,107,74,0.18)' : 'rgba(255,107,74,0.12)',
                      borderColor: '#FF6B4A',
                    },
                  ]}
                >
                  <Text style={styles.activeChipText}>{cat}</Text>
                  <X size={10} color="#FF6B4A" strokeWidth={2.5} />
                </Pressable>
              ))}
              {appliedSort !== 'newest' && (
                <Pressable
                  onPress={() => setAppliedSort('newest')}
                  style={[
                    styles.activeChip,
                    {
                      backgroundColor: isDark ? 'rgba(255,107,74,0.18)' : 'rgba(255,107,74,0.12)',
                      borderColor: '#FF6B4A',
                    },
                  ]}
                >
                  <Text style={styles.activeChipText}>↑ Oldest first</Text>
                  <X size={10} color="#FF6B4A" strokeWidth={2.5} />
                </Pressable>
              )}
              <Pressable onPress={clearAllFilters} style={styles.clearAllChip}>
                <Text style={[styles.clearAllChipText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                  Clear all
                </Text>
              </Pressable>
            </View>
          )}
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
            contentContainerStyle={styles.listContent}
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

      {/* ── FILTER BOTTOM SHEET ──────────────────────────────────────────────── */}
      <Modal
        visible={isFilterSheetOpen}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => closeFilterSheet(false)}
      >
        {/* Backdrop */}
        <Animated.View style={[styles.sheetBackdrop, { opacity: sheetOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => closeFilterSheet(false)} />
        </Animated.View>

        {/* Sheet panel */}
        <Animated.View
          style={[
            styles.sheetPanel,
            {
              backgroundColor: isDark ? '#18181B' : '#FFFFFF',
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}
        >
          {/* Handle bar */}
          <View style={[styles.sheetHandle, { backgroundColor: isDark ? '#3F3F46' : '#D4CECA' }]} />

          {/* Header row */}
          <View style={styles.sheetHeaderRow}>
            <Text style={[styles.sheetTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
              Filter Events
            </Text>
            <Pressable onPress={() => closeFilterSheet(false)} hitSlop={12}>
              <X size={20} color={isDark ? '#71717A' : '#8B847D'} strokeWidth={2} />
            </Pressable>
          </View>

          {/* ── Status ── */}
          <Text style={[styles.sheetSectionLabel, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
            STATUS
          </Text>
          <View style={styles.sheetChipRow}>
            {(['all', 'upcoming', 'completed'] as const).map(s => {
              const label = s === 'all' ? 'All' : s === 'upcoming' ? '⏳ Upcoming' : '✓ Completed';
              const active = draftStatus === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setDraftStatus(s)}
                  style={[
                    styles.sheetChip,
                    active
                      ? { backgroundColor: '#FF6B4A', borderColor: '#FF6B4A' }
                      : {
                          backgroundColor: isDark ? '#26262E' : 'rgba(239,233,223,0.6)',
                          borderColor: isDark ? '#3F3F46' : 'transparent',
                        },
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetChipText,
                      { color: active ? '#FFF' : isDark ? '#D4D4D8' : '#44403C' },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Category ── */}
          <Text style={[styles.sheetSectionLabel, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
            CATEGORY
          </Text>
          <View style={styles.sheetChipRow}>
            {[
              'WEDDING',
              'RECEPTION',
              'ENGAGEMENT',
              'BIRTHDAY',
              'HOUSEWARMING',
              'CORPORATE',
              'GRADUATION',
              'BRIDAL',
              'SPORTS',
            ].map(cat => {
              const active = draftCategories.includes(cat);
              return (
                <Pressable
                  key={cat}
                  onPress={() => toggleDraftCategory(cat)}
                  style={[
                    styles.sheetChip,
                    active
                      ? { backgroundColor: '#FF6B4A', borderColor: '#FF6B4A' }
                      : {
                          backgroundColor: isDark ? '#26262E' : 'rgba(239,233,223,0.6)',
                          borderColor: isDark ? '#3F3F46' : 'transparent',
                        },
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetChipText,
                      { color: active ? '#FFF' : isDark ? '#D4D4D8' : '#44403C' },
                    ]}
                  >
                    {cat.charAt(0) + cat.slice(1).toLowerCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Sort ── */}
          <Text style={[styles.sheetSectionLabel, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
            SORT BY DATE
          </Text>
          <View style={styles.sheetChipRow}>
            {(['newest', 'oldest'] as const).map(s => {
              const active = draftSort === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setDraftSort(s)}
                  style={[
                    styles.sheetChip,
                    active
                      ? { backgroundColor: '#FF6B4A', borderColor: '#FF6B4A' }
                      : {
                          backgroundColor: isDark ? '#26262E' : 'rgba(239,233,223,0.6)',
                          borderColor: isDark ? '#3F3F46' : 'transparent',
                        },
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetChipText,
                      { color: active ? '#FFF' : isDark ? '#D4D4D8' : '#44403C' },
                    ]}
                  >
                    {s === 'newest' ? '↓ Newest first' : '↑ Oldest first'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Action Buttons ── */}
          <View style={styles.sheetActionsRow}>
            <Pressable
              onPress={() => {
                clearAllFilters();
                closeFilterSheet(false);
              }}
              style={[styles.sheetResetBtn, { borderColor: isDark ? '#3F3F46' : '#D4CECA' }]}
            >
              <Text style={[styles.sheetResetBtnText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                Reset
              </Text>
            </Pressable>
            <Pressable onPress={() => closeFilterSheet(true)} style={styles.sheetApplyBtn}>
              <Text style={styles.sheetApplyBtnText}>Apply Filters</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Modal>

      {/* ── STICKY FOOTER BAR ── */}
      <View
        style={[
          styles.footerContainer,
          {
            backgroundColor: isDark ? '#131315' : '#FAF7F2',
            // Respect home-indicator safe area on iPhone; add minimum padding on Android
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Warning Banner when selected event does not have mobile enabled — tap to view details modal */}
        {selectedEvent && !isMobileAllowed && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setIsMobileWarningModalVisible(true)}
            style={[
              styles.warningBanner,
              {
                backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : '#FEF2F2',
                borderColor: isDark ? 'rgba(239, 68, 68, 0.3)' : '#FCA5A5',
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="You cannot use mobile for this event. Tap for details"
            accessibilityHint="Opens details explaining why mobile upload is unavailable for this event"
          >
            <AlertCircle
              size={16}
              color={isDark ? '#F87171' : '#DC2626'}
              strokeWidth={2.2}
              style={{ marginRight: 8, flexShrink: 0 }}
            />
            <Text
              style={[styles.warningBannerText, { color: isDark ? '#FCA5A5' : '#B91C1C' }]}
              numberOfLines={1}
            >
              You cannot use mobile for this event
            </Text>
            <View
              style={[
                styles.warningInfoBadge,
                { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.22)' : '#FEE2E2' },
              ]}
            >
              <Text
                style={[styles.warningInfoBadgeText, { color: isDark ? '#FCA5A5' : '#DC2626' }]}
              >
                Why?
              </Text>
              <ChevronRight size={12} color={isDark ? '#FCA5A5' : '#DC2626'} strokeWidth={2.4} />
            </View>
          </TouchableOpacity>
        )}

        <Pressable
          onPress={handleContinue}
          disabled={isContinueDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: isContinueDisabled }}
          accessibilityLabel="Continue"
          style={({ pressed }) => [
            styles.continueButtonWrapper,
            {
              opacity: isContinueDisabled ? 0.45 : 1,
              transform: [{ translateY: pressed && !isContinueDisabled ? 2 : 0 }],
            },
          ]}
        >
          {({ pressed }) => (
            <View style={styles.buttonShadowContainer}>
              {/* Tactile Coral Shadow Underneath */}
              <View
                style={[
                  styles.tactileShadowLayer,
                  {
                    top: pressed && !isContinueDisabled ? 2 : 6,
                    left: 0,
                    right: 0,
                    bottom: pressed && !isContinueDisabled ? -2 : -6,
                  },
                ]}
              />

              {/* Main Button Face */}
              <View style={styles.continueButtonFace}>
                <Text style={styles.continueButtonText}>Continue</Text>
                <ArrowRight size={20} color="#FFFFFF" strokeWidth={2.3} style={{ marginLeft: 4 }} />
              </View>
            </View>
          )}
        </Pressable>
      </View>

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
    paddingBottom: 110, // Clears sticky footer
    gap: 12,
  },
  cardWrapper: {
    // cardWrapper owns ONLY visual decoration (bg, border, shadow, radius, padding).
    // Flex geometry (flexDirection:row) lives in cardRow below — immune to Pressable
    // function-style-prop's style merging quirk on Android RN 0.86 + Hermes.
    padding: 12,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    width: '100%',
  },
  // Inner view that owns ALL flex row geometry. Static plain-object style — never
  // a function, never a dynamic array — so Yoga on Android always resolves it correctly.
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  // Outer shell: NO overflow:hidden here. overflow:hidden on a flex child forces Yoga
  // (Android) to treat it as an isolated stacking context, which collapses its
  // contribution to the parent row and causes the vertical-stack bug.
  thumbnailContainer: {
    width: 100,
    height: 82,
    flexShrink: 0,
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
  },
  // Inner clip: carries overflow:hidden and the border-radius clip so the image
  // and category pill are still visually rounded, without affecting flex sizing.
  thumbnailClip: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
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
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.80)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryPillText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Event Info (strictly 82px height matching thumbnail)
  eventInfo: {
    flex: 1,
    height: 82,
    marginLeft: 12,
    marginRight: 8,
    justifyContent: 'space-between',
    minWidth: 0,
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
    gap: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 11,
    fontFamily: FONTS.plusJakartaSans.medium,
    lineHeight: 14,
  },

  // Right Actions (strictly 82px height matching thumbnail)
  rightActionCol: {
    height: 82,
    width: 32,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4,
  },
  // elevation removed: on Android, elevation creates a separate compositing layer;
  // when the surrounding layout collapses (due to the overflow:hidden bug above) the
  // layer is sized against wrong parent dimensions, making borderRadius look like a
  // huge circle. The card's own elevation already provides the visual depth.
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreOptionsBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Sticky Footer — paddingBottom is set dynamically via insets in JSX
  footerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 8,
    zIndex: 100,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  warningBannerText: {
    fontSize: 13,
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontWeight: '600',
    flex: 1,
  },
  warningInfoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 6,
  },
  warningInfoBadgeText: {
    fontSize: 11,
    fontFamily: FONTS.plusJakartaSans.bold,
    fontWeight: '700',
  },
  continueButtonWrapper: {
    width: '100%',
  },
  buttonShadowContainer: {
    position: 'relative',
    width: '100%',
  },
  tactileShadowLayer: {
    position: 'absolute',
    backgroundColor: '#FF6F4E', // button-3d-coral #FF6F4E
    borderRadius: 28,
    zIndex: 0,
  },
  continueButtonFace: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#181818',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 16,
    letterSpacing: 0.3,
  },
  // Removed manual home bar — safe area insets handle this now

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

  // Animated Filter Button
  filterButtonWrapper: {
    borderRadius: 16,
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Active filter chips strip
  activeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  activeChipText: {
    fontSize: 11,
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontWeight: '600',
    color: '#FF6B4A',
  },
  clearAllChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clearAllChipText: {
    fontSize: 11,
    fontFamily: FONTS.plusJakartaSans.medium,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },

  // Filter bottom sheet
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 10,
  },
  sheetPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 34,
    zIndex: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sheetSectionLabel: {
    fontSize: 11,
    fontFamily: FONTS.plusJakartaSans.bold,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  sheetChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  sheetChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  sheetChipText: {
    fontSize: 13,
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontWeight: '600',
  },
  sheetActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  sheetResetBtn: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetResetBtnText: {
    fontSize: 14,
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontWeight: '600',
  },
  sheetApplyBtn: {
    flex: 2,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FF6B4A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B4A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetApplyBtnText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
    fontWeight: '700',
  },
});
