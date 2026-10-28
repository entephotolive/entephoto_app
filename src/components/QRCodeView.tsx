import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { toQR } from 'toqr';

export interface QRCodeViewProps {
  value: string;
  size?: number;
  quietZone?: number;
  color?: string;
  backgroundColor?: string;
  style?: ViewStyle;
}

/**
 * High-performance vector QR code component using `toqr` and `react-native-svg`.
 * Generates a clean, scannable QR code without external web views or bitmap scaling.
 */
export const QRCodeView: React.FC<QRCodeViewProps> = React.memo(
  ({ value, size = 200, quietZone = 4, color = '#000000', backgroundColor = '#FFFFFF', style }) => {
    const { path, viewBoxSize } = useMemo(() => {
      try {
        if (!value || typeof value !== 'string') {
          return { path: '', viewBoxSize: 0 };
        }

        const matrix = toQR(value);
        const moduleCount = Math.round(Math.sqrt(matrix.length));
        if (moduleCount === 0) {
          return { path: '', viewBoxSize: 0 };
        }

        const totalModules = moduleCount + quietZone * 2;

        let d = '';
        for (let y = 0; y < moduleCount; y++) {
          for (let x = 0; x < moduleCount; x++) {
            if (matrix[y * moduleCount + x]) {
              const px = x + quietZone;
              const py = y + quietZone;
              d += `M${px},${py}h1v1h-1z `;
            }
          }
        }

        return { path: d, viewBoxSize: totalModules };
      } catch (err) {
        console.error('[QRCodeView] Failed to generate QR code data:', err);
        return { path: '', viewBoxSize: 0 };
      }
    }, [value, quietZone]);

    if (!path || viewBoxSize === 0) {
      return null;
    }

    return (
      <View
        style={[styles.container, { width: size, height: size }, style]}
        accessibilityRole="image"
        accessibilityLabel="Event QR Code"
      >
        <Svg width={size} height={size} viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}>
          <Rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill={backgroundColor} />
          <Path d={path} fill={color} />
        </Svg>
      </View>
    );
  },
);

QRCodeView.displayName = 'QRCodeView';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
