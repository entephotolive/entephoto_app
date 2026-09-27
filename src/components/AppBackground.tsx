import React, { ReactNode } from 'react';
import { View, StyleSheet, StatusBar, ViewStyle, StyleProp, StatusBarStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useTheme } from '@/constants/theme';

interface AmbientBlurBlobProps {
  id?: string;
  size: number;
  color: string;
  opacity: number;
  style?: StyleProp<ViewStyle>;
  blurAmount?: number;
}

/**
 * AmbientBlurBlob — Renders a localized ambient glow element with an 8-stop Gaussian diffusion curve.
 *
 * Scoped strictly to its own bounding box so that the surrounding #131315 / #FAF7F2 canvas
 * remains 100% pure and unpolluted by full-screen translucent blur overlays.
 */
const AmbientBlurBlob: React.FC<AmbientBlurBlobProps> = ({
  id = 'ambientBlob',
  size,
  color,
  opacity,
  style,
}) => {
  const gradientId = `${id}_grad`;
  return (
    <View pointerEvents="none" style={style}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            {/* 8-Stage Smooth Gaussian Exponential Falloff */}
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="18%" stopColor={color} stopOpacity={opacity * 0.85} />
            <Stop offset="35%" stopColor={color} stopOpacity={opacity * 0.62} />
            <Stop offset="52%" stopColor={color} stopOpacity={opacity * 0.38} />
            <Stop offset="70%" stopColor={color} stopOpacity={opacity * 0.18} />
            <Stop offset="85%" stopColor={color} stopOpacity={opacity * 0.06} />
            <Stop offset="95%" stopColor={color} stopOpacity={opacity * 0.015} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
};

export interface AppBackgroundProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  statusBarStyle?: StatusBarStyle;
  hideStatusBar?: boolean;
  blurIntensity?: number;
}

/**
 * AppBackground — Unified, signature Neo-Brutalist & Tactile Clay background
 *
 * Key Architecture Highlights:
 * 1. Base theme canvas: Pure #FAF7F2 (light) / True Deep #131315 (dark) with zero milky haze.
 * 2. Scoped Ambient Blobs: Luminous cobalt & royal blues in dark mode (#2563EB / #1D4ED8 / #3B82F6)
 *    and warm peach/coral in light mode (#FFA07A / #FF8259).
 * 3. Strict Layer Isolation: Ambient glow is isolated to background layer (zIndex: 0), while screen
 *    content ({children}) renders in a dedicated foreground container (zIndex: 1, elevation: 1)
 *    ensuring text, search bars, cards, and buttons remain 100% crisp and sharp.
 * 4. Pass-through pointer events on background so touches never get blocked.
 */
export const AppBackground: React.FC<AppBackgroundProps> = ({
  children,
  style,
  statusBarStyle,
  hideStatusBar = false,
}) => {
  const { isDark } = useTheme();

  const currentStatusBarStyle: StatusBarStyle =
    statusBarStyle || (isDark ? 'light-content' : 'dark-content');

  const canvasColor = isDark ? '#131315' : '#FAF7F2';

  // Dark mode uses luminous cobalt & royal blues (#2563EB / #1D4ED8 / #3B82F6)
  // to deliver high vibrancy against the deep #131315 dark canvas.
  // Light mode uses signature warm peach & coral tones (#FFA07A / #FF8259).
  const topBlobColor = isDark ? '#2563EB' : '#FFA07A';
  const midBlobColor = isDark ? '#1D4ED8' : '#FFA07A';
  const bottomBlobColor = isDark ? '#3B82F6' : '#FF8259';

  // Calibrated opacities for distinct visibility on both themes
  const topBlobOpacity = isDark ? 0.75 : 0.4;
  const midBlobOpacity = isDark ? 0.6 : 0.28;
  const bottomBlobOpacity = isDark ? 0.8 : 0.42;

  return (
    <View style={[styles.root, { backgroundColor: canvasColor }, style]}>
      {!hideStatusBar && (
        <StatusBar barStyle={currentStatusBarStyle} backgroundColor={canvasColor} animated />
      )}

      {/* ── ISOLATED AMBIENT GLOW LAYER (zIndex: 0, no full-screen fog) ── */}
      <View pointerEvents="none" style={styles.ambientContainer}>
        {/* Top-Left Diffused Glow Blob */}
        <AmbientBlurBlob
          id="appBgTopLeft"
          size={isDark ? 420 : 260}
          color={topBlobColor}
          opacity={topBlobOpacity}
          style={isDark ? styles.blobTopLeftDark : styles.blobTopLeftLight}
        />

        {/* Mid-Left Diffused Accent Blob */}
        <AmbientBlurBlob
          id="appBgMidLeft"
          size={isDark ? 300 : 180}
          color={midBlobColor}
          opacity={midBlobOpacity}
          style={isDark ? styles.blobMidLeftDark : styles.blobMidLeftLight}
        />

        {/* Bottom-Right Diffused Glow Blob */}
        <AmbientBlurBlob
          id="appBgBottomRight"
          size={isDark ? 460 : 300}
          color={bottomBlobColor}
          opacity={bottomBlobOpacity}
          style={isDark ? styles.blobBottomRightDark : styles.blobBottomRightLight}
        />
      </View>

      {/* ── FOREGROUND CONTENT LAYER (Pixel-Sharp, zIndex: 1) ── */}
      <View style={styles.contentContainer}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
  },

  ambientContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    elevation: 0,
    overflow: 'hidden',
  },

  contentContainer: {
    flex: 1,
    zIndex: 1,
    elevation: 1,
  },

  // ── Light Mode Blob Positions ──
  blobTopLeftLight: {
    position: 'absolute',
    top: -65,
    left: -80,
    width: 260,
    height: 260,
  },
  blobMidLeftLight: {
    position: 'absolute',
    top: '26%',
    left: -70,
    width: 180,
    height: 180,
  },
  blobBottomRightLight: {
    position: 'absolute',
    bottom: -85,
    right: -75,
    width: 300,
    height: 300,
  },

  // ── Dark Mode Blob Positions (Expansive & Luminous) ──
  blobTopLeftDark: {
    position: 'absolute',
    top: -140,
    left: -130,
    width: 420,
    height: 420,
  },
  blobMidLeftDark: {
    position: 'absolute',
    top: '22%',
    left: -100,
    width: 300,
    height: 300,
  },
  blobBottomRightDark: {
    position: 'absolute',
    bottom: -160,
    right: -130,
    width: 460,
    height: 460,
  },
});
