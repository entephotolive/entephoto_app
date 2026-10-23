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
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, AccessibilityInfo } from 'react-native';
import { Text } from '@/components/Text';
import { FONTS } from '@/constants/typography';

// ── Square Geometry Constants ─────────────────────────────────────────────────

const SQUARE_SIZE = 36;
const SQUARE_RADIUS = 9;

// ── AnimatedDots ──────────────────────────────────────────────────────────────

const DOT_COUNT = 3;

const AnimatedDots = React.memo(
  ({ isDark, isVisible }: { isDark: boolean; isVisible: boolean }) => {
    const anims = useRef(Array.from({ length: DOT_COUNT }, () => new Animated.Value(0))).current;

    useEffect(() => {
      if (!isVisible) {
        anims.forEach(a => a.setValue(0));
        return;
      }

      const loops = anims.map((anim, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(i * 180),
            Animated.timing(anim, {
              toValue: 1,
              duration: 320,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 320,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.delay(DOT_COUNT * 180 - 180),
          ]),
        ),
      );

      const parallel = Animated.parallel(loops);
      parallel.start();
      return () => {
        parallel.stop();
        anims.forEach(a => a.setValue(0));
      };
    }, [isVisible, anims]);

    const dotColor = isDark ? '#A78BFA' : '#6366F1';

    return (
      <View style={dotSt.row} accessibilityElementsHidden>
        {anims.map((anim, i) => (
          <Animated.View
            key={i}
            style={[
              dotSt.dot,
              {
                backgroundColor: dotColor,
                opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
                transform: [
                  { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.15] }) },
                ],
              },
            ]}
          />
        ))}
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
  // Square 1: Primary Indigo
  const sq1Scale = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [1.0, 1.18, 0.88, 0.82, 1.0],
  });
  const sq1Rotate = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: ['0deg', '-12deg', '0deg', '8deg', '0deg'],
  });
  const sq1Tx = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [-14, -19, -11, -8, -14],
  });
  const sq1Ty = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [-10, -15, -7, -5, -10],
  });
  const sq1Opacity = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [1.0, 1.0, 0.82, 0.75, 1.0],
  });

  // Square 2: Accent Violet
  const sq2Scale = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0.88, 0.82, 1.0, 1.18, 0.88],
  });
  const sq2Rotate = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: ['0deg', '8deg', '0deg', '14deg', '0deg'],
  });
  const sq2Tx = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [14, 8, 14, 19, 14],
  });
  const sq2Ty = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [10, 5, 10, 15, 10],
  });
  const sq2Opacity = cycleAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0.82, 0.75, 1.0, 1.0, 0.82],
  });

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
            opacity: sq1Opacity,
            zIndex: 1,
            transform: [
              { translateX: sq1Tx },
              { translateY: sq1Ty },
              { scale: sq1Scale },
              { rotate: sq1Rotate },
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
            opacity: sq2Opacity,
            zIndex: 2,
            transform: [
              { translateX: sq2Tx },
              { translateY: sq2Ty },
              { scale: sq2Scale },
              { rotate: sq2Rotate },
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

// ── ClaymorphismLoader Main Component ─────────────────────────────────────────

interface ClaymorphismLoaderProps {
  isVisible: boolean;
  scanFilename?: string;
  isDark: boolean;
}

export const ClaymorphismLoader = React.memo<ClaymorphismLoaderProps>(
  ({ isVisible, scanFilename, isDark }) => {
    const cycleAnim = useRef(new Animated.Value(0)).current;
    const cardOpac = useRef(new Animated.Value(0)).current;

    const reducedMotion = useRef(false);
    useEffect(() => {
      AccessibilityInfo.isReduceMotionEnabled()
        .then(v => {
          reducedMotion.current = v;
        })
        .catch(() => {});
    }, []);

    // ── Animation lifecycle ───────────────────────────────────────────────────
    useEffect(() => {
      if (!isVisible) {
        Animated.timing(cardOpac, { toValue: 0, duration: 180, useNativeDriver: true }).start();
        return;
      }

      Animated.timing(cardOpac, { toValue: 1, duration: 260, useNativeDriver: true }).start();

      if (reducedMotion.current) {
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
        cycleAnim.setValue(0);
      };
    }, [isVisible, cycleAnim, cardOpac]);

    // ── Colors ────────────────────────────────────────────────────────────────
    const titleClr = isDark ? '#F4F4F5' : '#161616';
    const subClr = isDark ? '#A1A1AA' : '#71717A';

    // Filename — display basename cleanly
    const rawName = (scanFilename ?? '').trim();
    const basename = rawName.split('/').pop() ?? rawName;
    const subText = basename ? `Scanning ${basename}...` : 'Preparing your gallery\u2026';

    if (!isVisible) return null;

    return (
      <Animated.View
        style={[ldrSt.wrapper, { opacity: cardOpac }]}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Loading photos. ${subText}`}
      >
        <View style={ldrSt.content}>
          {/* ── ClayUI Squares Animation (Primary Loader) ── */}
          <ClayUISquares isDark={isDark} cycleAnim={cycleAnim} />

          {/* ── Loading Content Hierarchy ── */}
          <Text style={[ldrSt.title, { color: titleClr }]} numberOfLines={1}>
            Loading photos
          </Text>

          <Text
            style={[ldrSt.subtitle, { color: subClr }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {subText}
          </Text>

          {/* ── Subtle 3-Dot Pulse ── */}
          <AnimatedDots isDark={isDark} isVisible={isVisible} />
        </View>
      </Animated.View>
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
