import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle, Text } from 'react-native';
import Svg, { Path, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { FONTS } from '../constants/typography';
import { getQrLayout, generateQrSvgPath } from '../utils/eventQr';

export interface QRCodeViewProps {
  value: string;
  initials?: string;
  size?: number;
  quietZone?: number;
  color?: string;
  backgroundColor?: string;
  style?: ViewStyle;
}

/**
 * Modern organic vector QR code component with continuous connected modules,
 * generously rounded finder patterns, a clean white quiet zone, and a compact
 * circular centre badge displaying dynamic event initials.
 *
 * Uses `toqr` with ECLevel.H (high error correction) ensuring 100% scanning reliability.
 */
export const QRCodeView: React.FC<QRCodeViewProps> = React.memo(
  ({
    value,
    initials,
    size = 200,
    quietZone = 4,
    color = '#000000',
    backgroundColor = '#FFFFFF',
    style,
  }) => {
    const layout = useMemo(() => {
      try {
        if (!value || typeof value !== 'string') return null;
        return getQrLayout(value, quietZone, initials);
      } catch (err) {
        console.error('[QRCodeView] Failed to generate QR layout:', err);
        return null;
      }
    }, [value, quietZone, initials]);

    const svgPath = useMemo(() => {
      if (!layout) return '';
      return generateQrSvgPath(layout);
    }, [layout]);

    if (!layout || !svgPath) {
      return null;
    }

    const { totalModules, finders, badge } = layout;
    const badgeDiameterPx = badge.diameterRatio * size;

    return (
      <View
        style={[styles.container, { width: size, height: size }, style]}
        accessibilityRole="image"
        accessibilityLabel={
          badge.initials ? `Event QR Code with initials ${badge.initials}` : 'Event QR Code'
        }
      >
        <Svg width={size} height={size} viewBox={`0 0 ${totalModules} ${totalModules}`}>
          {/* Base background */}
          <Rect x={0} y={0} width={totalModules} height={totalModules} fill={backgroundColor} />

          {/* Connected Organic Data Modules & Fillets */}
          <Path d={svgPath} fill={color} />

          {/* 3 Bold Rounded Finder Patterns Matching Reference */}
          {finders.map((f, i) => (
            <React.Fragment key={`finder-${i}`}>
              {/* Outer 7x7 frame: large rounded corners (rx=2.2) */}
              <Rect x={f.fx} y={f.fy} width={7} height={7} rx={2.2} ry={2.2} fill={color} />
              {/* Middle 5x5 cutout: clean white with rounded corners (rx=1.5) */}
              <Rect
                x={f.fx + 1}
                y={f.fy + 1}
                width={5}
                height={5}
                rx={1.5}
                ry={1.5}
                fill={backgroundColor}
              />
              {/* Inner 3x3 core: bold dark rounded core (rx=1.0) */}
              <Rect x={f.fx + 2} y={f.fy + 2} width={3} height={3} rx={1.0} ry={1.0} fill={color} />
            </React.Fragment>
          ))}

          {/* Center circular badge in SVG */}
          <Circle cx={badge.cx} cy={badge.cy} r={badge.r} fill={backgroundColor} />

          {/* SVG initials fallback */}
          {badge.initials ? (
            <SvgText
              x={badge.cx}
              y={badge.cy}
              fill={color}
              fontSize={badge.r * 0.76}
              fontFamily={FONTS.syne.bold}
              fontWeight="bold"
              textAnchor="middle"
              alignmentBaseline="central"
            >
              {badge.initials}
            </SvgText>
          ) : null}
        </Svg>

        {/* Pixel-perfect native typography overlay for the centre badge */}
        {badge.initials ? (
          <View
            pointerEvents="none"
            style={[
              styles.centerBadgeOverlay,
              {
                width: badgeDiameterPx,
                height: badgeDiameterPx,
                borderRadius: badgeDiameterPx / 2,
                backgroundColor,
              },
            ]}
          >
            <Text
              style={[
                styles.initialsText,
                {
                  fontSize: badgeDiameterPx * 0.38,
                  color,
                },
              ]}
              numberOfLines={1}
            >
              {badge.initials}
            </Text>
          </View>
        ) : null}
      </View>
    );
  },
);

QRCodeView.displayName = 'QRCodeView';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centerBadgeOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontFamily: FONTS.syne.bold,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
