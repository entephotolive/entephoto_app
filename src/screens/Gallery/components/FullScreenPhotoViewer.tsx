/**
 * FullScreenPhotoViewer.tsx
 *
 * Layout:  Full-bleed black background, photo shown at native aspect ratio
 *          (resizeMode="contain"), chrome overlaid as absolute layers.
 *
 * Interaction model:
 *   - Tap centre  → chrome slides up (spring animation from below)
 *   - Tap centre again → chrome slides down (dismissed)
 *   - Swipe left/right → navigate between photos
 *   - Swipe down → dismiss viewer back to gallery
 *   - Double-tap → zoom 2.4×; double-tap again → reset
 *   - Pinch → zoom up to 3.5×
 *
 * State sync with PhotoSelectionGalleryScreen:
 *   - `photos` prop is the live filteredPhotos array from the gallery.
 *   - `onToggleSelect(id)` (for bulk upload selection) calls the gallery's
 *     togglePhotoSelection which updates `photo.selected` and `photo.status`.
 *   - `onToggleFavourite(id)` sets a separate `marked` flag without toggling
 *     `selected`.  (Implemented below by setting status='marked' without
 *     changing selected.)
 *   - Because the gallery passes its live state down, changes in the viewer
 *     are immediately reflected in the gallery grid badges, and vice-versa.
 *
 * Dock buttons:
 *   Select   – marks/unmarks photo for BULK upload (synced with grid checkbox)
 *   Favourite – toggles a "keeper" heart flag (kept as `status='marked'`)
 *   Upload   – uploads THIS single photo immediately
 *   Delete   – deletes file from device (confirmation dialog)
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Pressable,
  FlatList,
  Modal,
  Alert,
  Dimensions,
  Animated,
  PanResponder,
  StatusBar,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Heart,
  MoreVertical,
  Trash2,
  CloudUpload,
  CheckCircle2,
} from 'lucide-react-native';
import { Text } from '@/components/Text';
import { FONTS } from '@/constants/typography';
import { GalleryPhotoItem } from '@/screens/Gallery/PhotoSelectionGalleryScreen';

// ─────────────────────────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Approximate height of the bottom chrome (filmstrip + dock) so we know how
// far to translate it offscreen when hidden.
const BOTTOM_CHROME_HEIGHT = 220;

// ─────────────────────────────────────────────────────────────────────────────
export interface FullScreenPhotoViewerProps {
  visible: boolean;
  photos: GalleryPhotoItem[];
  initialIndex: number;
  eventTitle?: string;
  eventSubtitle?: string;
  onClose: () => void;
  /** Toggles photo.selected (for BULK upload queue) – synced with gallery grid */
  onToggleMark: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  favoritePhotoIds: Set<string>;
  onUploadPhoto: (photo: GalleryPhotoItem) => void;
  onDeletePhoto: (photo: GalleryPhotoItem) => void;
  isDark?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
export const FullScreenPhotoViewer: React.FC<FullScreenPhotoViewerProps> = ({
  visible,
  photos,
  initialIndex,
  eventTitle = 'Rahul & Fathima',
  eventSubtitle = '05 Sep 2026 • Wedding',
  onClose,
  onToggleMark,
  onToggleFavorite,
  favoritePhotoIds,
  onUploadPhoto,
  onDeletePhoto,
}) => {
  const insets = useSafeAreaInsets();

  // ── State ──────────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(false); // starts hidden
  const [prevVisible, setPrevVisible] = useState(visible);
  const [prevInitialIndex, setPrevInitialIndex] = useState(initialIndex);

  if (visible !== prevVisible || initialIndex !== prevInitialIndex) {
    setPrevVisible(visible);
    setPrevInitialIndex(initialIndex);
    if (visible) {
      const safeIndex = Math.max(0, Math.min(initialIndex, photos.length - 1));
      setCurrentIndex(safeIndex);
      setChromeVisible(false);
    }
  }

  // ── Animation values ─────────────────────────────────────────────────────────
  /** Bottom chrome (filmstrip + dock) slides up/down from the bottom edge */
  const bottomSlideY = useMemo(() => new Animated.Value(BOTTOM_CHROME_HEIGHT), []);
  /** Top header fades in/out in sync with the bottom chrome */
  const headerOpacity = useMemo(() => new Animated.Value(0), []);
  /** Whole viewer dismiss (swipe down) */
  const dismissTranslateY = useMemo(() => new Animated.Value(0), []);
  const dismissOpacity = useMemo(() => new Animated.Value(1), []);

  // ── Zoom / pan animation values ─────────────────────────────────────────────
  const scale = useMemo(() => new Animated.Value(1), []);
  const panX = useMemo(() => new Animated.Value(0), []);
  const panY = useMemo(() => new Animated.Value(0), []);
  const currentScale = useRef(1);
  const currentPanX = useRef(0);
  const currentPanY = useRef(0);

  const filmstripRef = useRef<FlatList>(null);
  const lastTapRef = useRef<number>(0);

  const currentPhoto = photos[currentIndex] || photos[0];

  // ── Helpers ────────────────────────────────────────────────────────────────
  const resetZoom = useCallback(() => {
    currentScale.current = 1;
    currentPanX.current = 0;
    currentPanY.current = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(panX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(panY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }, [scale, panX, panY]);

  // ── Reset animations when viewer opens ─────────────────────────────────────
  useEffect(() => {
    if (visible) {
      bottomSlideY.setValue(BOTTOM_CHROME_HEIGHT);
      headerOpacity.setValue(0);
      dismissTranslateY.setValue(0);
      dismissOpacity.setValue(1);
      resetZoom();
    }
  }, [visible, bottomSlideY, headerOpacity, dismissTranslateY, dismissOpacity, resetZoom]);

  // ── Scroll filmstrip to keep active photo centred ──────────────────────────
  useEffect(() => {
    if (visible && filmstripRef.current && photos.length > 0) {
      try {
        filmstripRef.current.scrollToIndex({
          index: Math.max(0, Math.min(currentIndex, photos.length - 1)),
          animated: true,
          viewPosition: 0.5,
        });
      } catch {}
    }
  }, [currentIndex, visible, photos.length]);

  /** Show/hide the chrome with a spring bounce-up from the bottom */
  const toggleChrome = useCallback(() => {
    if (chromeVisible) {
      // Slide down & fade header out
      Animated.parallel([
        Animated.spring(bottomSlideY, {
          toValue: BOTTOM_CHROME_HEIGHT,
          tension: 70,
          friction: 12,
          useNativeDriver: true,
        }),
        Animated.timing(headerOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => setChromeVisible(false));
    } else {
      setChromeVisible(true);
      // Spring-jump up from below & fade header in
      Animated.parallel([
        Animated.spring(bottomSlideY, {
          toValue: 0,
          tension: 68,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(headerOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [chromeVisible, bottomSlideY, headerOpacity]);

  const handlePrevPhoto = useCallback(() => {
    if (currentIndex > 0) {
      resetZoom();
      setCurrentIndex(i => i - 1);
    }
  }, [currentIndex, resetZoom]);

  const handleNextPhoto = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      resetZoom();
      setCurrentIndex(i => i + 1);
    }
  }, [currentIndex, photos.length, resetZoom]);

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(dismissTranslateY, {
        toValue: SCREEN_HEIGHT * 0.85,
        duration: 210,
        useNativeDriver: true,
      }),
      Animated.timing(dismissOpacity, {
        toValue: 0,
        duration: 210,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [dismissTranslateY, dismissOpacity, onClose]);

  const handleDoubleTap = useCallback(() => {
    if (currentScale.current > 1.2) {
      resetZoom();
    } else {
      currentScale.current = 2.4;
      Animated.parallel([
        Animated.spring(scale, { toValue: 2.4, useNativeDriver: true }),
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }),
        Animated.spring(panY, { toValue: 0, useNativeDriver: true }),
      ]).start();
    }
  }, [resetZoom, scale, panX, panY]);

  const handleDelete = useCallback(() => {
    if (!currentPhoto) return;
    Alert.alert(
      'Delete Photo',
      `Permanently delete "${currentPhoto.filename || 'this photo'}" from your device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDeletePhoto(currentPhoto);
            if (photos.length <= 1) {
              onClose();
            } else if (currentIndex >= photos.length - 1) {
              setCurrentIndex(photos.length - 2);
            }
          },
        },
      ],
    );
  }, [currentPhoto, onDeletePhoto, photos.length, currentIndex, onClose]);

  // ── Handlers ref to keep PanResponder stable ────────────────────────────────
  const handlersRef = useRef({
    currentIndex,
    photos,
    handleDoubleTap,
    toggleChrome,
    handleDismiss,
    handlePrevPhoto,
    handleNextPhoto,
  });
  useEffect(() => {
    handlersRef.current = {
      currentIndex,
      photos,
      handleDoubleTap,
      toggleChrome,
      handleDismiss,
      handlePrevPhoto,
      handleNextPhoto,
    };
  }, [
    currentIndex,
    photos,
    handleDoubleTap,
    toggleChrome,
    handleDismiss,
    handlePrevPhoto,
    handleNextPhoto,
  ]);

  // ── PanResponder (Created once) ─────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => {
        if (g.numberActiveTouches >= 2) return true;
        if (currentScale.current > 1) return true;
        return Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8;
      },
      onPanResponderMove: (evt, g) => {
        // Pinch-to-zoom
        if (g.numberActiveTouches >= 2 && evt.nativeEvent.touches?.length >= 2) {
          const t1 = evt.nativeEvent.touches[0];
          const t2 = evt.nativeEvent.touches[1];
          const dist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
          const ns = Math.max(1, Math.min(dist / 160, 3.5));
          currentScale.current = ns;
          scale.setValue(ns);
          return;
        }
        // Pan when zoomed
        if (currentScale.current > 1) {
          const mX = (SCREEN_WIDTH * (currentScale.current - 1)) / 2;
          const mY = (SCREEN_HEIGHT * (currentScale.current - 1)) / 2;
          panX.setValue(Math.max(-mX, Math.min(currentPanX.current + g.dx, mX)));
          panY.setValue(Math.max(-mY, Math.min(currentPanY.current + g.dy, mY)));
          return;
        }
        // Swipe-down dismiss feedback
        if (g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx)) {
          dismissTranslateY.setValue(g.dy);
          dismissOpacity.setValue(Math.max(0.3, 1 - g.dy / (SCREEN_HEIGHT * 0.6)));
        }
      },
      onPanResponderRelease: (_, g) => {
        const now = Date.now();
        // Tap (no significant movement)
        if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
          if (now - lastTapRef.current < 280) {
            // Double-tap
            lastTapRef.current = 0;
            handlersRef.current.handleDoubleTap();
          } else {
            // Single-tap → toggle chrome
            lastTapRef.current = now;
            setTimeout(() => {
              if (lastTapRef.current === now) {
                handlersRef.current.toggleChrome();
              }
            }, 290);
          }
          return;
        }
        // Zoomed pan release – commit offset
        if (currentScale.current > 1) {
          currentPanX.current += g.dx;
          currentPanY.current += g.dy;
          return;
        }
        // Swipe-down dismiss
        if (g.dy > 120 || (g.dy > 40 && g.vy > 0.6)) {
          handlersRef.current.handleDismiss();
          return;
        } else if (g.dy > 0) {
          Animated.parallel([
            Animated.spring(dismissTranslateY, { toValue: 0, useNativeDriver: true }),
            Animated.spring(dismissOpacity, { toValue: 1, useNativeDriver: true }),
          ]).start();
        }
        // Horizontal swipe
        if (Math.abs(g.dx) > 55 || Math.abs(g.vx) > 0.45) {
          if (g.dx > 0) handlersRef.current.handlePrevPhoto();
          else handlersRef.current.handleNextPhoto();
        }
      },
    }),
  );

  // ── Early exit ─────────────────────────────────────────────────────────────
  if (!visible || !currentPhoto) return null;

  const isSelected = currentPhoto.selected;
  const isFavorite = favoritePhotoIds.has(currentPhoto.id); // bulk-upload queue
  const isUploaded = currentPhoto.status === 'uploaded';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Root dismiss container */}
      <Animated.View
        style={[
          styles.root,
          {
            transform: [{ translateY: dismissTranslateY }],
            opacity: dismissOpacity,
          },
        ]}
      >
        {/* ═══════════════════════════════════════════════════════════════════
            LAYER 0 — Full-bleed black canvas + photo at natural aspect ratio
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.imageLayer} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.imageTransformWrapper,
              { transform: [{ scale }, { translateX: panX }, { translateY: panY }] },
            ]}
          >
            {/* resizeMode="contain" → photo shown at native aspect ratio,
                letterboxed with black bars so nothing is cropped */}
            <Image source={{ uri: currentPhoto.uri }} style={styles.photo} resizeMode="contain" />
          </Animated.View>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            LAYER 1 — TOP HEADER (fades in with chrome)
        ═══════════════════════════════════════════════════════════════════ */}
        <Animated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[
            styles.topHeader,
            { paddingTop: Math.max(insets.top, 14) + 4, opacity: headerOpacity },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backBtn,
              { transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Back to gallery"
          >
            <ArrowLeft size={20} color="#161616" strokeWidth={2.8} />
          </Pressable>

          <View style={styles.headerTitle}>
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {eventTitle}
            </Text>
            <Text style={styles.headerSubtitleText} numberOfLines={1}>
              {eventSubtitle}
            </Text>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.counterText}>
              {currentIndex + 1} / {photos.length}
            </Text>
            <TouchableOpacity
              onPress={() =>
                Alert.alert('Photo Options', currentPhoto.filename || 'Options', [
                  {
                    text: isSelected ? 'Remove from Upload Queue' : 'Add to Upload Queue',
                    onPress: () => onToggleMark(currentPhoto.id),
                  },
                  { text: 'Delete', style: 'destructive', onPress: handleDelete },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
              hitSlop={8}
              style={styles.moreBtn}
            >
              <MoreVertical size={20} color="#FFFFFF" strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ═══════════════════════════════════════════════════════════════════
            LAYER 2 — SIDE CHEVRONS (always available for navigation)
        ═══════════════════════════════════════════════════════════════════ */}
        {currentIndex > 0 && (
          <TouchableOpacity
            onPress={handlePrevPhoto}
            activeOpacity={0.8}
            style={[styles.sideBtn, styles.sideBtnLeft]}
            accessibilityLabel="Previous photo"
          >
            <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.6} />
          </TouchableOpacity>
        )}
        {currentIndex < photos.length - 1 && (
          <TouchableOpacity
            onPress={handleNextPhoto}
            activeOpacity={0.8}
            style={[styles.sideBtn, styles.sideBtnRight]}
            accessibilityLabel="Next photo"
          >
            <ChevronRight size={22} color="#FFFFFF" strokeWidth={2.6} />
          </TouchableOpacity>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            LAYER 3 — BOTTOM CHROME (spring-slides up from below on tap)
            Contains: filename overlay → filmstrip → action dock
        ═══════════════════════════════════════════════════════════════════ */}
        <Animated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[styles.bottomChrome, { transform: [{ translateY: bottomSlideY }] }]}
        >
          {/* Filename overlaid above filmstrip strip */}
          <View style={styles.filenameRow} pointerEvents="none">
            <Text style={styles.filenameText} numberOfLines={1}>
              {currentPhoto.filename || `Photo ${currentIndex + 1}`}
            </Text>
          </View>

          {/* Horizontal filmstrip */}
          <View style={styles.filmstripRow}>
            <FlatList
              ref={filmstripRef}
              horizontal
              data={photos}
              keyExtractor={item => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filmstripContent}
              getItemLayout={(_, idx) => ({ length: 60, offset: 60 * idx, index: idx })}
              renderItem={({ item, index }) => {
                const active = index === currentIndex;
                const itemSelected = item.selected;
                return (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      resetZoom();
                      setCurrentIndex(index);
                    }}
                    style={[styles.thumbWrapper, active && styles.thumbActive]}
                  >
                    <Image source={{ uri: item.uri }} style={styles.thumbImg} resizeMode="cover" />
                    {/* Selection indicator on filmstrip thumbnail */}
                    {itemSelected && !active && (
                      <View style={styles.thumbSelectedDot}>
                        <CheckCircle2 size={10} color="#FFFFFF" strokeWidth={2.5} fill="#FF5E3A" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>

          {/* ── ACTION DOCK ────────────────────────────────────────────────── */}
          {/* Light cream card that slides up from below as one unit with the filmstrip */}
          <View style={[styles.dockSheet, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
            <View style={styles.dockHandle} />

            <View style={styles.dockRow}>
              {/* SELECT — adds to bulk upload queue, synced with gallery grid */}
              <Pressable
                onPress={() => onToggleMark(currentPhoto.id)}
                style={({ pressed }) => [styles.dockItem, { opacity: pressed ? 0.75 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={isSelected ? 'Remove from upload queue' : 'Add to upload queue'}
              >
                <Animated.View style={[styles.dockIconBox, isSelected && styles.dockIconBoxActive]}>
                  <CheckCircle2
                    size={24}
                    color={isSelected ? '#FF5E3A' : '#3F3F46'}
                    strokeWidth={2}
                    fill={isSelected ? '#FFF0EB' : 'transparent'}
                  />
                </Animated.View>
                <Text style={[styles.dockLabel, isSelected && styles.dockLabelActive]}>Select</Text>
              </Pressable>

              {/* FAVOURITE — keeper/heart flag (does NOT add to upload queue) */}
              <Pressable
                onPress={() => {
                  onToggleFavorite(currentPhoto.id);
                }}
                style={({ pressed }) => [styles.dockItem, { opacity: pressed ? 0.75 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <View style={[styles.dockIconBox, isFavorite && styles.dockIconBoxHeart]}>
                  <Heart
                    size={24}
                    color={isFavorite ? '#FF5E3A' : '#3F3F46'}
                    strokeWidth={2}
                    fill={isFavorite ? '#FF5E3A' : 'transparent'}
                  />
                </View>
                <Text style={[styles.dockLabel, isFavorite && styles.dockLabelActive]}>
                  Favourite
                </Text>
              </Pressable>

              {/* UPLOAD — hero action, uploads THIS photo now */}
              <Pressable
                onPress={() => onUploadPhoto(currentPhoto)}
                style={({ pressed }) => [
                  styles.dockItem,
                  { transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Upload photo"
              >
                <View style={[styles.dockHeroBox, isUploaded && styles.dockHeroBoxUploaded]}>
                  <CloudUpload size={26} color="#FFFFFF" strokeWidth={2.4} />
                </View>
                <Text style={styles.dockHeroLabel}>{isUploaded ? 'Uploaded' : 'Upload'}</Text>
              </Pressable>

              {/* DELETE */}
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.dockItem, { opacity: pressed ? 0.75 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Delete photo"
              >
                <View style={[styles.dockIconBox, styles.dockIconBoxDelete]}>
                  <Trash2 size={24} color="#DC2626" strokeWidth={2} />
                </View>
                <Text style={[styles.dockLabel, styles.dockLabelDelete]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },

  // ── LAYER 0: Image ──────────────────────────────────────────────────────────
  imageLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0C',
  },
  imageTransformWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // resizeMode="contain" kept in JSX so photo never gets cropped
  photo: {
    width: '100%',
    height: '100%',
  },

  // ── LAYER 1: Top header ─────────────────────────────────────────────────────
  topHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 18,
    backgroundColor: 'rgba(10, 10, 12, 0.58)',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF5E3A',
    borderWidth: 2,
    borderColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 4 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.85,
        shadowRadius: 0,
      },
    }),
  },
  headerTitle: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitleText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitleText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
    color: '#D4D4D8',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerQualityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1.2,
  },
  headerQualityTextReview: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  headerQualityTextPass: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  counterText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  moreBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── LAYER 2: Side nav ───────────────────────────────────────────────────────
  sideBtn: {
    position: 'absolute',
    top: '46%',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(26, 26, 30, 0.72)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBtnLeft: { left: 14 },
  sideBtnRight: { right: 14 },

  // ── LAYER 3: Bottom chrome ──────────────────────────────────────────────────
  bottomChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Filename
  filenameRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  filenameText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  // Filmstrip
  filmstripRow: {
    backgroundColor: 'rgba(10, 10, 12, 0.54)',
    paddingVertical: 8,
  },
  filmstripContent: {
    paddingHorizontal: 14,
    gap: 8,
  },
  thumbWrapper: {
    width: 52,
    height: 52,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    opacity: 0.65,
  },
  thumbActive: {
    borderColor: '#FF5E3A',
    borderWidth: 2.5,
    opacity: 1,
    transform: [{ scale: 1.07 }],
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbSelectedDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Dock sheet
  dockSheet: {
    backgroundColor: '#FAF7F2',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#161616',
    paddingTop: 8,
    paddingHorizontal: 10,
    ...Platform.select({
      android: { elevation: 10 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
      },
    }),
  },
  dockHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
    alignSelf: 'center',
    marginBottom: 10,
  },

  // Dock row — evenly spaces all 4 buttons
  dockRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
  },

  // Each dock item = icon box stacked above label, centred
  dockItem: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flex: 1,
  },
  dockIconBox: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.8,
    borderColor: '#E4E4E8',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: '#161616',
        shadowOffset: { width: 1, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 0,
      },
    }),
  },
  dockIconBoxActive: {
    backgroundColor: '#FFF0EB',
    borderColor: '#FF5E3A',
  },
  dockIconBoxHeart: {
    backgroundColor: '#FFF0EB',
    borderColor: '#FF5E3A',
  },
  dockIconBoxDelete: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  dockLabel: {
    fontFamily: FONTS.syne.bold,
    fontSize: 11,
    fontWeight: '700',
    color: '#52525B',
    textAlign: 'center',
  },
  dockLabelActive: {
    color: '#FF5E3A',
  },
  dockLabelDelete: {
    color: '#DC2626',
  },

  // Upload hero — taller box with coral fill
  dockHeroBox: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: '#FF5E3A',
    borderWidth: 2,
    borderColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 5 },
      ios: {
        shadowColor: '#161616',
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.9,
        shadowRadius: 0,
      },
    }),
  },
  dockHeroBoxUploaded: {
    backgroundColor: '#10B981',
    borderColor: '#065F46',
  },
  dockHeroLabel: {
    fontFamily: FONTS.syne.bold,
    fontSize: 12,
    fontWeight: '800',
    color: '#161616',
    textAlign: 'center',
  },
});
