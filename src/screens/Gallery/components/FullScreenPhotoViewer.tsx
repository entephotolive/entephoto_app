/**
 * FullScreenPhotoViewer.tsx
 *
 * Layout:  Full-bleed black background, photo shown at native aspect ratio
 *          (resizeMode="contain"), chrome overlaid as absolute layers.
 *
 * Physical Device Orientation Photo-Only Rotation:
 *   - Screen orientation remains strictly locked in portrait so UI and overlays never reflow.
 *   - Physical device orientation (portrait, landscape-left, landscape-right) is detected via expo-sensors DeviceMotion.
 *   - Stable angle thresholds with hysteresis prevent flicker and ignore uncertain/flat readings.
 *   - ONLY the main photo image container rotates (0deg in portrait, +90deg / -90deg in landscape).
 *   - Header, navigation arrows, filename, filmstrip, and bottom dock remain upright and locked in their portrait positions.
 *   - Fitted visual dimensions and zoom pan bounds adapt dynamically to the rotated bounding box within the locked portrait viewport.
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
 *     `selected`.
 *   - Because the gallery passes its live state down, changes in the viewer
 *     are immediately reflected in the gallery grid badges, and vice-versa.
 *
 * Dock buttons:
 *   Select    – marks/unmarks photo for BULK upload (synced with grid checkbox)
 *   Favourite – toggles a "keeper" heart flag (kept as `status='marked'`)
 *   Upload    – uploads THIS single photo immediately
 *   Delete    – deletes file from device (confirmation dialog)
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
  Animated,
  PanResponder,
  StatusBar,
  Platform,
  UIManager,
  LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { DeviceMotion } from 'expo-sensors';
import LottieView from 'lottie-react-native';
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

// ── Lottie Cloud Upload Icon ─────────────────────────────────────────────────
// Primary asset: Free Cloud Upload Animation by Esko Ahonen (bundled locally).
// - Idle state: displays the static white Lucide CloudUpload icon (no animation playback).
// - Uploading state: plays the bundled Lottie cloud-upload animation (pure white on EntePhoto orange),
//   looping continuously while the upload operation is active.
// - Finished / Stopped: cleanly resets and returns to the static icon.
// - Safety guard: verifies native LottieAnimationViewManager presence before mounting LottieView
//   to protect against crashes on pre-rebuild dev-client APKs.
const cloudUploadAnimation = require('../../../../assets/animations/cloud-upload.json');

const isLottieNativeAvailable = Boolean(
  UIManager.getViewManagerConfig?.('LottieAnimationView') ||
  (UIManager as any)?.LottieAnimationView,
);

interface AnimatedUploadIconProps {
  isUploading: boolean;
  color?: string;
  size?: number;
}

const AnimatedUploadIcon = React.memo(
  ({ isUploading, color = '#FFFFFF', size = 26 }: AnimatedUploadIconProps) => {
    const animationRef = useRef<LottieView>(null);

    useEffect(() => {
      const anim = animationRef.current;
      if (isUploading && isLottieNativeAvailable) {
        anim?.play();
      } else {
        anim?.reset();
      }
      return () => {
        anim?.reset();
      };
    }, [isUploading]);

    if (!isUploading || !isLottieNativeAvailable) {
      return <CloudUpload size={size} color={color} strokeWidth={2.4} />;
    }

    return (
      <View style={styles.lottieIconContainer} pointerEvents="none">
        <LottieView
          ref={animationRef}
          source={cloudUploadAnimation}
          autoPlay
          loop
          style={styles.uploadLottie}
          renderMode="HARDWARE"
        />
      </View>
    );
  },
);
AnimatedUploadIcon.displayName = 'AnimatedUploadIcon';

// ─────────────────────────────────────────────────────────────────────────────
// Approximate height of the bottom chrome (filmstrip + dock) so we know how
// far to translate it offscreen when hidden.
const BOTTOM_CHROME_HEIGHT = 340;

/** Parses "WIDTHxHEIGHT" (e.g. "4000x3000") from photo metadata */
function parseDimensions(dimStr?: string): { width: number; height: number } | null {
  if (!dimStr) return null;
  const parts = dimStr.split('x');
  if (parts.length === 2) {
    const w = parseFloat(parts[0]);
    const h = parseFloat(parts[1]);
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return null;
}

/**
 * Calculates allowable pan translations per axis based on scaled image fit dimensions
 * and the viewport size. If the scaled image fits within the viewport on an axis,
 * maximum translation is 0 (keeping it centered).
 */
function getPanBounds(scaleVal: number, fitW: number, fitH: number, vpW: number, vpH: number) {
  const scaledW = fitW * scaleVal;
  const scaledH = fitH * scaleVal;

  const maxPanX = scaledW > vpW ? (scaledW - vpW) / 2 : 0;
  const maxPanY = scaledH > vpH ? (scaledH - vpH) / 2 : 0;

  return { maxPanX, maxPanY };
}

export type PhysicalOrientation = 'portrait' | 'landscape-left' | 'landscape-right';

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
  uploadedPhotoIds?: Set<string>;
  onUploadPhoto: (photo: GalleryPhotoItem) => void;
  onDeletePhoto: (photo: GalleryPhotoItem) => void;
  isDark?: boolean;
  /** True while a gallery-level upload is active for the current photo */
  isUploading?: boolean;
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
  uploadedPhotoIds,
  onUploadPhoto,
  onDeletePhoto,
  isUploading = false,
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // ── Native Screen Orientation (Locked to Portrait) ───────────────────────
  const previousLockRef = useRef<ScreenOrientation.OrientationLock | null>(null);

  useEffect(() => {
    if (!visible) return;

    let isMounted = true;

    async function lockScreenToPortrait() {
      try {
        const lock = await ScreenOrientation.getOrientationLockAsync();
        if (!isMounted) return;
        previousLockRef.current = lock;

        // Keep native app screen orientation fixed to portrait
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch (err) {
        console.warn('Failed to lock screen orientation to portrait:', err);
      }
    }

    lockScreenToPortrait();

    return () => {
      isMounted = false;
      if (previousLockRef.current !== null) {
        const lockToRestore = previousLockRef.current;
        ScreenOrientation.lockAsync(lockToRestore).catch(err => {
          console.warn('Failed to restore screen orientation lock:', err);
        });
      }
    };
  }, [visible]);

  // ── Physical Device Orientation (expo-sensors DeviceMotion) ────────────────
  const [physicalOrientation, setPhysicalOrientation] = useState<PhysicalOrientation>('portrait');
  const currentOriRef = useRef<PhysicalOrientation>('portrait');
  const candidateOriRef = useRef<PhysicalOrientation | null>(null);
  const consecutiveCountRef = useRef<number>(0);

  useEffect(() => {
    if (!visible) return;

    let isMounted = true;
    let subscription: { remove: () => void } | null = null;

    async function initDeviceMotion() {
      try {
        const isAvailable = await DeviceMotion.isAvailableAsync();
        console.log('[DEVICE-MOTION-AVAIL]', isAvailable);
        if (!isMounted || !isAvailable) {
          return;
        }

        // 150ms interval (~6.7 Hz) avoids battery drain and CPU overhead
        DeviceMotion.setUpdateInterval(150);

        subscription = DeviceMotion.addListener(data => {
          if (!isMounted) return;

          let candidate: PhysicalOrientation | null = null;

          // Method 1: Accelerometer with gravity vector
          if (data.accelerationIncludingGravity) {
            const { x, y, z } = data.accelerationIncludingGravity;
            const xyMagnitude = Math.hypot(x, y);
            const zMagnitude = Math.abs(z);

            // If phone is flat (screen facing ceiling or floor), readings in XY are ambiguous.
            // Ignore uncertain readings and retain the last stable orientation.
            if (xyMagnitude < 2.5 && zMagnitude > 7.5) {
              return;
            }

            // Calculate angle in device XY plane relative to upright portrait (0°):
            // In Expo, resting upright in portrait produces y ≈ -9.8.
            // Negating y aligns 0° with upright portrait:
            // - Upright portrait: x ≈ 0, y ≈ -9.8 -> Math.atan2(0, 9.8) = 0°
            // - Tilted left (top to left, CCW): x ≈ -9.8, y ≈ 0 -> Math.atan2(-9.8, 0) = -90°
            // - Tilted right (top to right, CW): x ≈ +9.8, y ≈ 0 -> Math.atan2(9.8, 0) = +90°
            const angleDeg = Math.atan2(x, -y) * (180 / Math.PI);
            const current = currentOriRef.current;

            // Stable angle thresholds with hysteresis
            if (current === 'portrait') {
              if (angleDeg <= -55 && angleDeg >= -125) {
                candidate = 'landscape-left';
              } else if (angleDeg >= 55 && angleDeg <= 125) {
                candidate = 'landscape-right';
              } else {
                candidate = 'portrait';
              }
            } else if (current === 'landscape-left') {
              // Hysteresis: requires returning above -35° or past -145° to leave landscape-left
              if (angleDeg > -35 || angleDeg < -145) {
                candidate = 'portrait';
              } else if (angleDeg >= 55 && angleDeg <= 125) {
                candidate = 'landscape-right';
              } else {
                candidate = 'landscape-left';
              }
            } else if (current === 'landscape-right') {
              // Hysteresis: requires returning below 35° or past 145° to leave landscape-right
              if (angleDeg < 35 || angleDeg > 145) {
                candidate = 'portrait';
              } else if (angleDeg <= -55 && angleDeg >= -125) {
                candidate = 'landscape-left';
              } else {
                candidate = 'landscape-right';
              }
            }
          } else if (typeof data.orientation === 'number') {
            // Method 2 fallback: DeviceMotion orientation property
            // Expo specification: LeftLandscape = -90, RightLandscape = 90
            if (data.orientation === -90) {
              candidate = 'landscape-left';
            } else if (data.orientation === 90) {
              candidate = 'landscape-right';
            } else if (data.orientation === 0 || data.orientation === 180) {
              candidate = 'portrait';
            }
          }

          if (!candidate) return;

          // Debounce: require 2 consecutive consistent readings (~300ms) before updating React state
          if (candidate !== currentOriRef.current) {
            if (candidateOriRef.current === candidate) {
              consecutiveCountRef.current += 1;
              if (consecutiveCountRef.current >= 2) {
                currentOriRef.current = candidate;
                setPhysicalOrientation(candidate);
                consecutiveCountRef.current = 0;
                candidateOriRef.current = null;
              }
            } else {
              candidateOriRef.current = candidate;
              consecutiveCountRef.current = 1;
            }
          } else {
            candidateOriRef.current = null;
            consecutiveCountRef.current = 0;
          }
        });
      } catch (err) {
        console.warn('Physical device motion sensor unavailable:', err);
      }
    }

    initDeviceMotion();

    return () => {
      isMounted = false;
      if (subscription) {
        subscription.remove();
      }
    };
  }, [visible]);

  // Smooth rotation animation for the main photo
  const isPhotoRotated = physicalOrientation !== 'portrait';
  const rotationAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    let targetAngle = 0;
    if (physicalOrientation === 'landscape-left') {
      targetAngle = 90;
    } else if (physicalOrientation === 'landscape-right') {
      targetAngle = -90;
    }

    Animated.spring(rotationAnim, {
      toValue: targetAngle,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [physicalOrientation, rotationAnim]);

  const rotationInterpolate = useMemo(
    () =>
      rotationAnim.interpolate({
        inputRange: [-90, 0, 90],
        outputRange: ['-90deg', '0deg', '90deg'],
      }),
    [rotationAnim],
  );

  // Safe area insets fixed to portrait
  const safeTop = Math.max(insets.top, 14);
  const safeBottom = Math.max(insets.bottom, 16);
  const safeLeft = Math.max(insets.left, 0);
  const safeRight = Math.max(insets.right, 0);

  // ── State ──────────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(false); // starts hidden
  const chromeVisibleRef = useRef(false);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [prevInitialIndex, setPrevInitialIndex] = useState(initialIndex);

  useEffect(() => {
    chromeVisibleRef.current = chromeVisible;
  }, [chromeVisible]);

  if (visible !== prevVisible || initialIndex !== prevInitialIndex) {
    setPrevVisible(visible);
    setPrevInitialIndex(initialIndex);
    if (visible) {
      const safeIndex = Math.max(0, Math.min(initialIndex, photos.length - 1));
      setCurrentIndex(safeIndex);
      setChromeVisible(false);
    } else if (physicalOrientation !== 'portrait') {
      setPhysicalOrientation('portrait');
    }
  }

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
  const startPanX = useRef(0);
  const startPanY = useRef(0);

  // ── Multi-touch / pinch gesture refs ─────────────────────────────────────────
  const initialPinchDistance = useRef<number | null>(null);
  const baseScale = useRef(1);
  const basePanX = useRef(0);
  const basePanY = useRef(0);
  const initialFocalPoint = useRef<{ x: number; y: number } | null>(null);
  const hasMultipleTouches = useRef(false);
  const isPinching = useRef(false);

  const filmstripRef = useRef<FlatList>(null);
  const lastTapRef = useRef<number>(0);

  const currentPhoto = photos[currentIndex] || photos[0];

  // ── Viewport and Image Fitted Dimensions ───────────────────────────────────
  const [layoutSize, setLayoutSize] = useState<{ width: number; height: number } | null>(null);

  const viewportSize = useMemo(() => {
    return layoutSize || { width: windowWidth, height: windowHeight };
  }, [layoutSize, windowWidth, windowHeight]);

  const viewportSizeRef = useRef(viewportSize);
  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  const handleImageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayoutSize(prev => {
        if (prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
          return prev;
        }
        return { width, height };
      });
    }
  }, []);

  const [loadedPhotoId, setLoadedPhotoId] = useState<string | null>(null);
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);

  if (currentPhoto && currentPhoto.id !== loadedPhotoId) {
    setLoadedPhotoId(currentPhoto.id);
    setLoadedSize(null);
  }

  const parsedDimensions = useMemo(() => {
    return parseDimensions(currentPhoto?.dimensions);
  }, [currentPhoto?.dimensions]);

  useEffect(() => {
    if (currentPhoto?.uri && !parsedDimensions && !loadedSize) {
      Image.getSize(
        currentPhoto.uri,
        (width, height) => {
          if (width > 0 && height > 0) {
            setLoadedSize({ width, height });
          }
        },
        () => {},
      );
    }
  }, [currentPhoto?.uri, parsedDimensions, loadedSize]);

  const imageSize = loadedSize || parsedDimensions;

  const { fittedDimensions, visualDimensions } = useMemo(() => {
    const vpW = viewportSize.width;
    const vpH = viewportSize.height;

    if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
      const w = isPhotoRotated ? vpH : vpW;
      const h = isPhotoRotated ? vpW : vpH;
      return {
        fittedDimensions: { width: Math.round(w), height: Math.round(h) },
        visualDimensions: {
          width: Math.round(isPhotoRotated ? h : w),
          height: Math.round(isPhotoRotated ? w : h),
        },
      };
    }

    const imgAspect = imageSize.width / imageSize.height;

    if (isPhotoRotated) {
      // Rotated 90° or -90°:
      // An image container of size fitW × fitH, when rotated 90°,
      // has on-screen visual width = fitH, and visual height = fitW.
      // Its visual aspect ratio is fitH / fitW = 1 / imgAspect.
      // It must fit within the fixed portrait viewport (vpW, vpH).
      const visualAspect = 1 / imgAspect;
      const vpAspect = vpW / vpH;

      let fitW: number;
      let fitH: number;

      if (visualAspect > vpAspect) {
        // Constrained horizontally by viewport width (visualWidth = vpW)
        fitH = vpW;
        fitW = vpW * imgAspect;
      } else {
        // Constrained vertically by viewport height (visualHeight = vpH)
        fitW = vpH;
        fitH = vpH / imgAspect;
      }

      return {
        fittedDimensions: { width: Math.round(fitW), height: Math.round(fitH) },
        visualDimensions: { width: Math.round(fitH), height: Math.round(fitW) },
      };
    } else {
      // Normal portrait (0° rotation)
      const vpAspect = vpW / vpH;
      let fitW = vpW;
      let fitH = vpH;

      if (imgAspect > vpAspect) {
        fitW = vpW;
        fitH = vpW / imgAspect;
      } else {
        fitH = vpH;
        fitW = vpH * imgAspect;
      }

      return {
        fittedDimensions: { width: Math.round(fitW), height: Math.round(fitH) },
        visualDimensions: { width: Math.round(fitW), height: Math.round(fitH) },
      };
    }
  }, [viewportSize, imageSize, isPhotoRotated]);

  const fittedDimensionsRef = useRef(fittedDimensions);
  const visualDimensionsRef = useRef(visualDimensions);

  useEffect(() => {
    fittedDimensionsRef.current = fittedDimensions;
    visualDimensionsRef.current = visualDimensions;
  }, [fittedDimensions, visualDimensions]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const resetZoom = useCallback(() => {
    scale.stopAnimation();
    panX.stopAnimation();
    panY.stopAnimation();
    currentScale.current = 1;
    currentPanX.current = 0;
    currentPanY.current = 0;
    startPanX.current = 0;
    startPanY.current = 0;
    basePanX.current = 0;
    basePanY.current = 0;
    initialPinchDistance.current = null;
    baseScale.current = 1;
    initialFocalPoint.current = null;
    hasMultipleTouches.current = false;
    isPinching.current = false;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(panX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(panY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }, [scale, panX, panY]);

  // Cleanly reset zoom when phone rotates between orientations
  const prevOrientationRef = useRef(physicalOrientation);
  useEffect(() => {
    if (prevOrientationRef.current !== physicalOrientation) {
      prevOrientationRef.current = physicalOrientation;
      resetZoom();
    }
  }, [physicalOrientation, resetZoom]);

  // ── Re-clamp pan when viewport or visual dimensions change ─────────────────
  useEffect(() => {
    if (currentScale.current > 1) {
      const { maxPanX, maxPanY } = getPanBounds(
        currentScale.current,
        visualDimensions.width,
        visualDimensions.height,
        viewportSize.width,
        viewportSize.height,
      );
      const clampedX = Math.max(-maxPanX, Math.min(currentPanX.current, maxPanX));
      const clampedY = Math.max(-maxPanY, Math.min(currentPanY.current, maxPanY));
      if (clampedX !== currentPanX.current || clampedY !== currentPanY.current) {
        currentPanX.current = clampedX;
        currentPanY.current = clampedY;
        basePanX.current = clampedX;
        basePanY.current = clampedY;
        startPanX.current = clampedX;
        startPanY.current = clampedY;
        panX.setValue(clampedX);
        panY.setValue(clampedY);
      }
    }
  }, [viewportSize, visualDimensions, panX, panY]);

  // ── Reset animations when viewer opens ─────────────────────────────────────
  useEffect(() => {
    if (visible) {
      bottomSlideY.setValue(BOTTOM_CHROME_HEIGHT);
      headerOpacity.setValue(0);
      dismissTranslateY.setValue(0);
      dismissOpacity.setValue(1);
      resetZoom();
      chromeVisibleRef.current = false;
    }
  }, [visible, bottomSlideY, headerOpacity, dismissTranslateY, dismissOpacity, resetZoom]);

  // ── Reset zoom on photo change ─────────────────────────────────────────────
  useEffect(() => {
    resetZoom();
  }, [currentIndex, resetZoom]);

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
    bottomSlideY.stopAnimation();
    headerOpacity.stopAnimation();

    if (chromeVisibleRef.current) {
      chromeVisibleRef.current = false;
      setChromeVisible(false);
      // Slide down & fade header and chevrons out
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
      ]).start();
    } else {
      chromeVisibleRef.current = true;
      setChromeVisible(true);
      // Spring-jump up from below & fade header and chevrons in
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
  }, [bottomSlideY, headerOpacity]);

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
    if (previousLockRef.current !== null) {
      ScreenOrientation.lockAsync(previousLockRef.current).catch(() => {});
    }
    Animated.parallel([
      Animated.timing(dismissTranslateY, {
        toValue: (viewportSizeRef.current?.height || windowHeight) * 0.85,
        duration: 210,
        useNativeDriver: true,
      }),
      Animated.timing(dismissOpacity, {
        toValue: 0,
        duration: 210,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [windowHeight, dismissTranslateY, dismissOpacity, onClose]);

  const handleDoubleTap = useCallback(
    (tapX?: number, tapY?: number) => {
      if (currentScale.current > 1.2) {
        resetZoom();
      } else {
        scale.stopAnimation();
        panX.stopAnimation();
        panY.stopAnimation();

        const targetScale = 2.4;
        currentScale.current = targetScale;
        initialPinchDistance.current = null;
        baseScale.current = targetScale;
        initialFocalPoint.current = null;
        hasMultipleTouches.current = false;
        isPinching.current = false;

        const vpW = viewportSizeRef.current.width;
        const vpH = viewportSizeRef.current.height;
        const vis = visualDimensionsRef.current;
        const { maxPanX, maxPanY } = getPanBounds(targetScale, vis.width, vis.height, vpW, vpH);

        let targetPanX = 0;
        let targetPanY = 0;

        if (tapX !== undefined && tapY !== undefined) {
          const fRelX = tapX - vpW / 2;
          const fRelY = tapY - vpH / 2;
          targetPanX = fRelX * (1 - targetScale);
          targetPanY = fRelY * (1 - targetScale);
        }

        targetPanX = Math.max(-maxPanX, Math.min(targetPanX, maxPanX));
        targetPanY = Math.max(-maxPanY, Math.min(targetPanY, maxPanY));

        currentPanX.current = targetPanX;
        currentPanY.current = targetPanY;
        basePanX.current = targetPanX;
        basePanY.current = targetPanY;
        startPanX.current = targetPanX;
        startPanY.current = targetPanY;

        Animated.parallel([
          Animated.spring(scale, { toValue: targetScale, useNativeDriver: true }),
          Animated.spring(panX, { toValue: targetPanX, useNativeDriver: true }),
          Animated.spring(panY, { toValue: targetPanY, useNativeDriver: true }),
        ]).start();
      }
    },
    [resetZoom, scale, panX, panY],
  );

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
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt, g) => {
        scale.stopAnimation();
        panX.stopAnimation();
        panY.stopAnimation();
        startPanX.current = currentPanX.current;
        startPanY.current = currentPanY.current;
        basePanX.current = currentPanX.current;
        basePanY.current = currentPanY.current;

        const touches = evt.nativeEvent.touches;
        if (g.numberActiveTouches >= 2 || (touches && touches.length >= 2)) {
          hasMultipleTouches.current = true;
          isPinching.current = true;
          if (touches && touches.length >= 2) {
            const t1 = touches[0];
            const t2 = touches[1];
            initialPinchDistance.current = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
            baseScale.current = currentScale.current;
            basePanX.current = currentPanX.current;
            basePanY.current = currentPanY.current;
            initialFocalPoint.current = {
              x: (t1.pageX + t2.pageX) / 2,
              y: (t1.pageY + t2.pageY) / 2,
            };
          }
        } else {
          hasMultipleTouches.current = false;
          isPinching.current = false;
          initialPinchDistance.current = null;
          initialFocalPoint.current = null;
        }
      },
      onPanResponderMove: (evt, g) => {
        const touches = evt.nativeEvent.touches;
        const activeTouchCount = touches ? touches.length : g.numberActiveTouches;

        // Multi-touch pinch detection
        if (activeTouchCount >= 2 && touches && touches.length >= 2) {
          hasMultipleTouches.current = true;
          const t1 = touches[0];
          const t2 = touches[1];
          const currentDist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
          const currentFX = (t1.pageX + t2.pageX) / 2;
          const currentFY = (t1.pageY + t2.pageY) / 2;

          if (initialPinchDistance.current == null || !isPinching.current) {
            // First moment 2 touches are detected during move
            initialPinchDistance.current = currentDist > 0 ? currentDist : 1;
            baseScale.current = currentScale.current;

            const vpW = viewportSizeRef.current.width;
            const vpH = viewportSizeRef.current.height;
            const fit = fittedDimensionsRef.current;
            const { maxPanX, maxPanY } = getPanBounds(
              currentScale.current,
              fit.width,
              fit.height,
              vpW,
              vpH,
            );

            const livePanX =
              currentScale.current > 1
                ? Math.max(-maxPanX, Math.min(startPanX.current + g.dx, maxPanX))
                : currentPanX.current;
            const livePanY =
              currentScale.current > 1
                ? Math.max(-maxPanY, Math.min(startPanY.current + g.dy, maxPanY))
                : currentPanY.current;

            basePanX.current = livePanX;
            basePanY.current = livePanY;
            currentPanX.current = livePanX;
            currentPanY.current = livePanY;

            initialFocalPoint.current = {
              x: currentFX,
              y: currentFY,
            };
            isPinching.current = true;
          } else {
            const ratio = currentDist / initialPinchDistance.current;
            const newScale = Math.max(1, Math.min(baseScale.current * ratio, 3.5));

            const vpW = viewportSizeRef.current.width;
            const vpH = viewportSizeRef.current.height;
            const vpCenterX = vpW / 2;
            const vpCenterY = vpH / 2;

            const f0 = initialFocalPoint.current || { x: currentFX, y: currentFY };
            const fRel0X = f0.x - vpCenterX;
            const fRel0Y = f0.y - vpCenterY;
            const fRel1X = currentFX - vpCenterX;
            const fRel1Y = currentFY - vpCenterY;

            const scaleRatio = baseScale.current > 0 ? newScale / baseScale.current : 1;
            let newPanX = fRel1X - (fRel0X - basePanX.current) * scaleRatio;
            let newPanY = fRel1Y - (fRel0Y - basePanY.current) * scaleRatio;

            const vis = visualDimensionsRef.current;
            const { maxPanX, maxPanY } = getPanBounds(newScale, vis.width, vis.height, vpW, vpH);

            newPanX = Math.max(-maxPanX, Math.min(newPanX, maxPanX));
            newPanY = Math.max(-maxPanY, Math.min(newPanY, maxPanY));

            currentScale.current = newScale;
            currentPanX.current = newPanX;
            currentPanY.current = newPanY;

            scale.setValue(newScale);
            panX.setValue(newPanX);
            panY.setValue(newPanY);
          }
          return;
        }

        // If this gesture interaction ever involved multiple touches, do not let
        // a remaining single finger trigger photo navigation or swipe dismiss!
        if (hasMultipleTouches.current || isPinching.current) {
          return;
        }

        // Pan when zoomed (pure 1-finger gesture)
        if (currentScale.current > 1) {
          const vpW = viewportSizeRef.current.width;
          const vpH = viewportSizeRef.current.height;
          const vis = visualDimensionsRef.current;
          const { maxPanX, maxPanY } = getPanBounds(
            currentScale.current,
            vis.width,
            vis.height,
            vpW,
            vpH,
          );

          const targetX = Math.max(-maxPanX, Math.min(startPanX.current + g.dx, maxPanX));
          const targetY = Math.max(-maxPanY, Math.min(startPanY.current + g.dy, maxPanY));

          currentPanX.current = targetX;
          currentPanY.current = targetY;
          panX.setValue(targetX);
          panY.setValue(targetY);
          return;
        }

        // Swipe-down dismiss feedback (pure 1-finger gesture at 1x)
        if (g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx)) {
          dismissTranslateY.setValue(g.dy);
          dismissOpacity.setValue(Math.max(0.3, 1 - g.dy / (viewportSizeRef.current.height * 0.6)));
        }
      },
      onPanResponderRelease: (evt, g) => {
        const hadMultiTouches = hasMultipleTouches.current || isPinching.current;

        // Reset multi-touch refs for the next interaction
        initialPinchDistance.current = null;
        baseScale.current = currentScale.current;
        basePanX.current = currentPanX.current;
        basePanY.current = currentPanY.current;
        initialFocalPoint.current = null;
        hasMultipleTouches.current = false;
        isPinching.current = false;

        // Multi-touch gestures must NEVER trigger photo navigation or tap toggles
        if (hadMultiTouches) {
          const vpW = viewportSizeRef.current.width;
          const vpH = viewportSizeRef.current.height;

          if (currentScale.current <= 1.05) {
            // Pinched back down to ~1x -> cleanly spring back to 1.0 and zero pan
            currentScale.current = 1;
            currentPanX.current = 0;
            currentPanY.current = 0;
            startPanX.current = 0;
            startPanY.current = 0;
            basePanX.current = 0;
            basePanY.current = 0;
            Animated.parallel([
              Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
              Animated.spring(panX, { toValue: 0, useNativeDriver: true }),
              Animated.spring(panY, { toValue: 0, useNativeDriver: true }),
            ]).start();
          } else {
            // Clamp pan offsets within bounds of current scale
            const vis = visualDimensionsRef.current;
            const { maxPanX, maxPanY } = getPanBounds(
              currentScale.current,
              vis.width,
              vis.height,
              vpW,
              vpH,
            );
            currentPanX.current = Math.max(-maxPanX, Math.min(currentPanX.current, maxPanX));
            currentPanY.current = Math.max(-maxPanY, Math.min(currentPanY.current, maxPanY));
            basePanX.current = currentPanX.current;
            basePanY.current = currentPanY.current;
            startPanX.current = currentPanX.current;
            startPanY.current = currentPanY.current;
            Animated.parallel([
              Animated.spring(panX, { toValue: currentPanX.current, useNativeDriver: true }),
              Animated.spring(panY, { toValue: currentPanY.current, useNativeDriver: true }),
            ]).start();
          }
          return;
        }

        const now = Date.now();
        // Tap (no significant movement)
        if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
          if (now - lastTapRef.current < 280) {
            // Double-tap
            lastTapRef.current = 0;
            handlersRef.current.handleDoubleTap(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
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
          const vpW = viewportSizeRef.current.width;
          const vpH = viewportSizeRef.current.height;
          const vis = visualDimensionsRef.current;
          const { maxPanX, maxPanY } = getPanBounds(
            currentScale.current,
            vis.width,
            vis.height,
            vpW,
            vpH,
          );

          const targetX = Math.max(-maxPanX, Math.min(startPanX.current + g.dx, maxPanX));
          const targetY = Math.max(-maxPanY, Math.min(startPanY.current + g.dy, maxPanY));
          currentPanX.current = targetX;
          currentPanY.current = targetY;
          basePanX.current = targetX;
          basePanY.current = targetY;
          startPanX.current = targetX;
          startPanY.current = targetY;
          panX.setValue(targetX);
          panY.setValue(targetY);
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

        // Horizontal swipe (only when unzoomed and pure 1-finger)
        if (Math.abs(g.dx) > 55 || Math.abs(g.vx) > 0.45) {
          if (g.dx > 0) handlersRef.current.handlePrevPhoto();
          else handlersRef.current.handleNextPhoto();
        }
      },
      onPanResponderTerminate: () => {
        initialPinchDistance.current = null;
        baseScale.current = currentScale.current;
        initialFocalPoint.current = null;
        hasMultipleTouches.current = false;
        isPinching.current = false;
        if (currentScale.current <= 1.05) {
          currentScale.current = 1;
          currentPanX.current = 0;
          currentPanY.current = 0;
          startPanX.current = 0;
          startPanY.current = 0;
          basePanX.current = 0;
          basePanY.current = 0;
          Animated.parallel([
            Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
            Animated.spring(panX, { toValue: 0, useNativeDriver: true }),
            Animated.spring(panY, { toValue: 0, useNativeDriver: true }),
          ]).start();
        } else {
          const vpW = viewportSizeRef.current.width;
          const vpH = viewportSizeRef.current.height;
          const vis = visualDimensionsRef.current;
          const { maxPanX, maxPanY } = getPanBounds(
            currentScale.current,
            vis.width,
            vis.height,
            vpW,
            vpH,
          );
          currentPanX.current = Math.max(-maxPanX, Math.min(currentPanX.current, maxPanX));
          currentPanY.current = Math.max(-maxPanY, Math.min(currentPanY.current, maxPanY));
          basePanX.current = currentPanX.current;
          basePanY.current = currentPanY.current;
          startPanX.current = currentPanX.current;
          startPanY.current = currentPanY.current;
          Animated.parallel([
            Animated.spring(panX, { toValue: currentPanX.current, useNativeDriver: true }),
            Animated.spring(panY, { toValue: currentPanY.current, useNativeDriver: true }),
          ]).start();
        }
      },
    }),
  );

  const isSelected = currentPhoto?.selected ?? false;
  const isFavorite = currentPhoto ? favoritePhotoIds.has(currentPhoto.id) : false;
  const isUploaded = currentPhoto
    ? currentPhoto.status === 'uploaded' ||
      (uploadedPhotoIds
        ? uploadedPhotoIds.has(currentPhoto.id) ||
          Boolean(currentPhoto.filename && uploadedPhotoIds.has(currentPhoto.filename))
        : false)
    : false;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!visible || !currentPhoto) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => {
        if (previousLockRef.current !== null) {
          ScreenOrientation.lockAsync(previousLockRef.current).catch(() => {});
        }
        onClose();
      }}
    >
      <StatusBar hidden barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Root viewer with dismiss transform */}
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
            LAYER 0 — Full-bleed black canvas + photo (rotated only in landscape)
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.imageLayer} onLayout={handleImageLayout} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.imageTransformWrapper,
              {
                transform: [{ translateX: panX }, { translateY: panY }, { scale }],
              },
            ]}
          >
            {/* Dedicated rotation container: rotates ONLY the main photo image based on physical device orientation */}
            <Animated.View
              style={[
                styles.photoRotationContainer,
                {
                  width: fittedDimensions.width,
                  height: fittedDimensions.height,
                  transform: [{ rotate: rotationInterpolate }],
                },
              ]}
            >
              <Image
                source={{ uri: currentPhoto.uri }}
                style={[
                  styles.photo,
                  {
                    width: fittedDimensions.width,
                    height: fittedDimensions.height,
                  },
                ]}
                resizeMode="contain"
                onLoad={evt => {
                  const { width, height } = evt.nativeEvent.source;
                  if (width > 0 && height > 0) {
                    setLoadedSize({ width, height });
                  }
                }}
              />
            </Animated.View>
          </Animated.View>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            LAYER 1 — TOP HEADER (fades in with chrome)
        ═══════════════════════════════════════════════════════════════════ */}
        <Animated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[
            styles.topHeader,
            {
              paddingTop: safeTop + 4,
              paddingLeft: safeLeft + 14,
              paddingRight: safeRight + 14,
              opacity: headerOpacity,
            },
          ]}
        >
          <Pressable
            onPress={() => {
              if (previousLockRef.current !== null) {
                ScreenOrientation.lockAsync(previousLockRef.current).catch(() => {});
              }
              onClose();
            }}
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
            LAYER 2 — SIDE CHEVRONS (fade in/out in sync with chrome)
        ═══════════════════════════════════════════════════════════════════ */}
        <Animated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[styles.sideChevronsContainer, { opacity: headerOpacity }]}
        >
          {currentIndex > 0 && (
            <TouchableOpacity
              onPress={handlePrevPhoto}
              activeOpacity={0.8}
              style={[styles.sideBtn, styles.sideBtnLeft, { left: safeLeft + 14 }]}
              accessibilityLabel="Previous photo"
            >
              <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.6} />
            </TouchableOpacity>
          )}
          {currentIndex < photos.length - 1 && (
            <TouchableOpacity
              onPress={handleNextPhoto}
              activeOpacity={0.8}
              style={[styles.sideBtn, styles.sideBtnRight, { right: safeRight + 14 }]}
              accessibilityLabel="Next photo"
            >
              <ChevronRight size={22} color="#FFFFFF" strokeWidth={2.6} />
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* ═══════════════════════════════════════════════════════════════════
            LAYER 3 — BOTTOM CHROME (spring-slides up from below on tap)
            Contains: filename overlay → filmstrip → action dock
        ═══════════════════════════════════════════════════════════════════ */}
        <Animated.View
          pointerEvents={chromeVisible ? 'box-none' : 'none'}
          style={[styles.bottomChrome, { transform: [{ translateY: bottomSlideY }] }]}
        >
          {/* Filename overlaid above filmstrip strip */}
          <View
            style={[
              styles.filenameRow,
              {
                paddingLeft: safeLeft + 16,
                paddingRight: safeRight + 16,
              },
            ]}
            pointerEvents="none"
          >
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
              contentContainerStyle={[
                styles.filmstripContent,
                {
                  paddingLeft: safeLeft + 14,
                  paddingRight: safeRight + 14,
                },
              ]}
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
          <View
            style={[
              styles.dockSheet,
              {
                paddingBottom: safeBottom + 4,
                paddingLeft: safeLeft + 16,
                paddingRight: safeRight + 16,
              },
            ]}
          >
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
                  {
                    transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }],
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isUploading ? 'Uploading…' : isUploaded ? 'Uploaded' : 'Upload photo'
                }
              >
                <View style={[styles.dockHeroBox, isUploaded && styles.dockHeroBoxUploaded]}>
                  <AnimatedUploadIcon
                    isUploading={isUploading && !isUploaded}
                    color="#FFFFFF"
                    size={26}
                  />
                </View>
                <Text style={styles.dockHeroLabel}>
                  {isUploaded ? 'Uploaded' : isUploading ? 'Uploading…' : 'Upload'}
                </Text>
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
    position: 'relative',
    overflow: 'hidden',
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
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRotationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // resizeMode="contain" kept in JSX so photo never gets cropped
  photo: {
    backgroundColor: 'transparent',
  },

  // ── LAYER 1: Top header ─────────────────────────────────────────────────────
  topHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 16,
    backgroundColor: 'rgba(10, 10, 12, 0.58)',
    zIndex: 20,
    elevation: 6,
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
  sideChevronsContainer: {
    ...StyleSheet.absoluteFill,
    zIndex: 15,
  },
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
    zIndex: 15,
    elevation: 4,
  },
  sideBtnLeft: {},
  sideBtnRight: {},

  // ── LAYER 3: Bottom chrome ──────────────────────────────────────────────────
  bottomChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 6,
  },

  // Filename
  filenameRow: {
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
    marginBottom: 8,
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
  lottieIconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadLottie: {
    width: 32,
    height: 32,
  },
});
