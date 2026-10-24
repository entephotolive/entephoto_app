/**
 * ClaymorphismLoader — ClayUI Squares Loading Indicator Variant
 *
 * A clean, native React Native implementation inspired by ClayUI's official
 * Squares Loading Indicator (https://www.clayui.com/docs/components/loading-indicator).
 *
 * Visual design:
 * - Two prominent square shapes with modest corner rounding and restrained
 *   depth shadows, maintaining an unmistakably square silhouette.
 * - Indigo & violet palette (#6366F1, #8B5CF6) with subtle lighting accents,
 *   coordinated with EntePhoto's warm cream/peach Gallery background.
 * - Staggered, coordinated animation cycle: the two squares rhythmically scale,
 *   rotate slightly, and translate along alternating paths.
 * - Clear text hierarchy: "Loading photos" headline, dynamic scan-progress
 *   filename (or "Preparing your gallery…" fallback) with clean middle truncation,
 *   and sequential 3-dot pulse indicator.
 * - 100% native-driver transforms and opacities (zero JS-thread pressure).
 * - Full reduced-motion and accessibility support with complete cleanup.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, AccessibilityInfo } from 'react-native';
import { Text } from '@/components/Text';
import { FONTS } from '@/constants/typography';
import { addScanProgressListener } from '@/services/localPhotoService';

// ── Square Geometry Constants ─────────────────────────────────────────────────

const SQUARE_SIZE = 36;
const SQUARE_RADIUS = 9;

// ── AnimatedDots ──────────────────────────────────────────────────────────────

const AnimatedDots = React.memo(
  ({ isDark, isVisible }: { isDark: boolean; isVisible: boolean }) => {
    const dotsAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (!isVisible) {
        dotsAnim.setValue(0);
        return;
      }

      const loop = Animated.loop(
        Animated.timing(dotsAnim, {
          toValue: 1,
          duration: 960,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
      return () => {
        loop.stop();
        dotsAnim.setValue(0);
      };
    }, [isVisible, dotsAnim]);

    const dotColor = isDark ? '#A78BFA' : '#6366F1';

    // 3 distinct dot phase interpolations running 100% on the native driver
    const dot0Opacity = useMemo(
      () =>
        dotsAnim.interpolate({
          inputRange: [0, 0.16, 0.32, 1],
          outputRange: [0.25, 1, 0.25, 0.25],
        }),
      [dotsAnim],
    );
    const dot0Scale = useMemo(
      () =>
        dotsAnim.interpolate({
          inputRange: [0, 0.16, 0.32, 1],
          outputRange: [0.75, 1.15, 0.75, 0.75],
        }),
      [dotsAnim],
    );

    const dot1Opacity = useMemo(
      () =>
        dotsAnim.interpolate({
          inputRange: [0, 0.18, 0.34, 0.5, 1],
          outputRange: [0.25, 0.25, 1, 0.25, 0.25],
        }),
      [dotsAnim],
    );
    const dot1Scale = useMemo(
      () =>
        dotsAnim.interpolate({
          inputRange: [0, 0.18, 0.34, 0.5, 1],
          outputRange: [0.75, 0.75, 1.15, 0.75, 0.75],
        }),
      [dotsAnim],
    );

    const dot2Opacity = useMemo(
      () =>
        dotsAnim.interpolate({
          inputRange: [0, 0.36, 0.52, 0.68, 1],
          outputRange: [0.25, 0.25, 1, 0.25, 0.25],
        }),
      [dotsAnim],
    );
    const dot2Scale = useMemo(
      () =>
        dotsAnim.interpolate({
          inputRange: [0, 0.36, 0.52, 0.68, 1],
          outputRange: [0.75, 0.75, 1.15, 0.75, 0.75],
        }),
      [dotsAnim],
    );

    return (
      <View style={dotSt.row} accessibilityElementsHidden>
        <Animated.View
          style={[
            dotSt.dot,
            {
              backgroundColor: dotColor,
              opacity: dot0Opacity,
              transform: [{ scale: dot0Scale }],
            },
          ]}
        />
        <Animated.View
          style={[
            dotSt.dot,
            {
              backgroundColor: dotColor,
              opacity: dot1Opacity,
              transform: [{ scale: dot1Scale }],
            },
          ]}
        />
        <Animated.View
          style={[
            dotSt.dot,
            {
              backgroundColor: dotColor,
              opacity: dot2Opacity,
              transform: [{ scale: dot2Scale }],
            },
          ]}
        />
      </View>
    );
  },
);
AnimatedDots.displayName = 'AnimatedDots';

const dotSt = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});

// ── ClayUI Squares Indicator Component ────────────────────────────────────────

interface ClayUISquaresProps {
  isDark: boolean;
  cycleAnim: Animated.Value;
}

const ClayUISquares = React.memo<ClayUISquaresProps>(({ isDark, cycleAnim }) => {
  // Memoize all interpolation objects so re-renders do not recreate them
  const interpolations = useMemo(
    () => ({
      // Square 1: Primary Indigo
      sq1Scale: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [1.0, 1.18, 0.88, 0.82, 1.0],
      }),
      sq1Rotate: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: ['0deg', '-12deg', '0deg', '8deg', '0deg'],
      }),
      sq1Tx: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [-14, -19, -11, -8, -14],
      }),
      sq1Ty: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [-10, -15, -7, -5, -10],
      }),
      sq1Opacity: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [1.0, 1.0, 0.82, 0.75, 1.0],
      }),

      // Square 2: Accent Violet
      sq2Scale: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [0.88, 0.82, 1.0, 1.18, 0.88],
      }),
      sq2Rotate: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: ['0deg', '8deg', '0deg', '14deg', '0deg'],
      }),
      sq2Tx: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [14, 8, 14, 19, 14],
      }),
      sq2Ty: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [10, 5, 10, 15, 10],
      }),
      sq2Opacity: cycleAnim.interpolate({
        inputRange: [0, 0.25, 0.5, 0.75, 1],
        outputRange: [0.82, 0.75, 1.0, 1.0, 0.82],
      }),
    }),
    [cycleAnim],
  );

  const sq1Bg = isDark ? '#818CF8' : '#6366F1';
  const sq1Border = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.6)';

  const sq2Bg = isDark ? '#A78BFA' : '#8B5CF6';
  const sq2Border = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.6)';

  return (
    <View style={sqStyles.stage} accessibilityElementsHidden>
      {/* Square 1: Primary Indigo */}
      <Animated.View
        style={[
          sqStyles.square,
          {
            backgroundColor: sq1Bg,
            borderColor: sq1Border,
            opacity: interpolations.sq1Opacity,
            zIndex: 1,
            transform: [
              { translateX: interpolations.sq1Tx },
              { translateY: interpolations.sq1Ty },
              { scale: interpolations.sq1Scale },
              { rotate: interpolations.sq1Rotate },
            ],
            ...Platform.select({
              android: { elevation: 6 },
              ios: {
                shadowColor: sq1Bg,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
              },
            }),
          },
        ]}
      />

      {/* Square 2: Accent Violet */}
      <Animated.View
        style={[
          sqStyles.square,
          {
            backgroundColor: sq2Bg,
            borderColor: sq2Border,
            opacity: interpolations.sq2Opacity,
            zIndex: 2,
            transform: [
              { translateX: interpolations.sq2Tx },
              { translateY: interpolations.sq2Ty },
              { scale: interpolations.sq2Scale },
              { rotate: interpolations.sq2Rotate },
            ],
            ...Platform.select({
              android: { elevation: 8 },
              ios: {
                shadowColor: sq2Bg,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.35,
                shadowRadius: 10,
              },
            }),
          },
        ]}
      />
    </View>
  );
});
ClayUISquares.displayName = 'ClayUISquares';

const sqStyles = StyleSheet.create({
  stage: {
    width: 90,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  square: {
    position: 'absolute',
    width: SQUARE_SIZE,
    height: SQUARE_SIZE,
    borderRadius: SQUARE_RADIUS,
    borderWidth: 1.5,
  },
});

// ── LoaderSubtitle Component ──────────────────────────────────────────────────
// Subscribes directly to per-file progress so changing filenames do not re-render
// the parent ClaymorphismLoader or the ClayUISquares animation.

interface LoaderSubtitleProps {
  initialFilename?: string;
  isDark: boolean;
}

const LoaderSubtitle = React.memo<LoaderSubtitleProps>(({ initialFilename, isDark }) => {
  const [currentFilename, setCurrentFilename] = useState<string>(initialFilename || '');

  useEffect(() => {
    if (initialFilename) {
      setCurrentFilename(initialFilename);
    }
  }, [initialFilename]);

  useEffect(() => {
    const unsub = addScanProgressListener(filename => {
      setCurrentFilename(filename);
    });
    return unsub;
  }, []);

  const subClr = isDark ? '#A1A1AA' : '#71717A';
  const rawName = (currentFilename || initialFilename || '').trim();
  const basename = rawName.split('/').pop() ?? rawName;
  const subText = basename ? `Scanning ${basename}...` : 'Preparing your gallery\u2026';

  return (
    <Text style={[ldrSt.subtitle, { color: subClr }]} numberOfLines={1} ellipsizeMode="middle">
      {subText}
    </Text>
  );
});
LoaderSubtitle.displayName = 'LoaderSubtitle';

// ── ClaymorphismLoader Main Component ─────────────────────────────────────────

interface ClaymorphismLoaderProps {
  isVisible: boolean;
  scanFilename?: string;
  isDark: boolean;
}

// Module-level cached reduce-motion preference to avoid asynchronous layout/animation jumps on mount
let cachedIsReducedMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then(enabled => {
    cachedIsReducedMotion = enabled;
  })
  .catch(() => {});

AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
  cachedIsReducedMotion = enabled;
});

export const ClaymorphismLoader = React.memo<ClaymorphismLoaderProps>(
  ({ isVisible, scanFilename, isDark }) => {
    const cycleAnim = useRef(new Animated.Value(0)).current;
    const [isReducedMotion, setIsReducedMotion] = useState(cachedIsReducedMotion);

    // Reduced motion support with live event listener
    useEffect(() => {
      let isMounted = true;
      AccessibilityInfo.isReduceMotionEnabled()
        .then(v => {
          if (isMounted) {
            cachedIsReducedMotion = v;
            setIsReducedMotion(v);
          }
        })
        .catch(() => {});

      const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => {
        if (isMounted) {
          cachedIsReducedMotion = v;
          setIsReducedMotion(v);
        }
      });

      return () => {
        isMounted = false;
        sub?.remove?.();
      };
    }, []);

    // ── Animation lifecycle ───────────────────────────────────────────────────
    useEffect(() => {
      if (!isVisible) {
        cycleAnim.setValue(0);
        return;
      }

      if (isReducedMotion) {
        cycleAnim.setValue(0.5);
        return;
      }

      // 1600 ms continuous coordinated loop for the two squares
      const squaresLoop = Animated.loop(
        Animated.timing(cycleAnim, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      );
      squaresLoop.start();

      return () => {
        squaresLoop.stop();
      };
    }, [isVisible, isReducedMotion, cycleAnim]);

    if (!isVisible) return null;

    const titleClr = isDark ? '#F4F4F5' : '#161616';

    return (
      <View
        style={ldrSt.wrapper}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel="Loading photos"
      >
        <View style={ldrSt.content}>
          {/* ── ClayUI Squares Animation (Primary Loader) ── */}
          <ClayUISquares isDark={isDark} cycleAnim={cycleAnim} />

          {/* ── Loading Content Hierarchy ── */}
          <Text style={[ldrSt.title, { color: titleClr }]} numberOfLines={1}>
            Loading photos
          </Text>

          {/* Isolated subtitle that updates without re-rendering squares */}
          <LoaderSubtitle initialFilename={scanFilename} isDark={isDark} />

          {/* ── Subtle 3-Dot Pulse ── */}
          <AnimatedDots isDark={isDark} isVisible={isVisible} />
        </View>
      </View>
    );
  },
);

ClaymorphismLoader.displayName = 'ClaymorphismLoader';

// ── Styles ────────────────────────────────────────────────────────────────────

const ldrSt = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: FONTS.syne.bold,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 240,
  },
});
