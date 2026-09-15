import React from 'react';
import { View, ActivityIndicator, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { useTheme } from '@/constants/theme';
import { Text } from './Text';

export interface LoaderProps {
  message?: string;
  size?: 'small' | 'large';
  color?: string;
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Loader: React.FC<LoaderProps> = ({
  message,
  size = 'large',
  color,
  overlay = false,
  style,
}) => {
  const { colors, spacing } = useTheme();
  const indicatorColor = color || colors.primary;

  const content = (
    <View style={[styles.container, style]}>
      <ActivityIndicator size={size} color={indicatorColor} />
      {message && (
        <Text
          variant="bodySm"
          color={colors.textSecondary}
          style={{ marginTop: spacing.md, textAlign: 'center' }}
        >
          {message}
        </Text>
      )}
    </View>
  );

  if (overlay) {
    return (
      <View
        style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.4)' }]}
      >
        <View
          style={[
            styles.overlayCard,
            { backgroundColor: colors.surfaceElevated, borderRadius: 16, padding: spacing.xl },
          ]}
        >
          {content}
        </View>
      </View>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  overlay: {
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
});
