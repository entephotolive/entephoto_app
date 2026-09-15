import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { COLORS, RADII, SPACING } from '@/constants/theme';
import { TYPOGRAPHY } from '@/constants/typography';

export interface BadgeProps {
  label: string;
  variant?: 'dark' | 'primary' | 'mint' | 'amber';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'dark', style, textStyle }) => {
  const getBackgroundColor = () => {
    switch (variant) {
      case 'primary':
        return COLORS.primaryContainer;
      case 'mint':
        return COLORS.secondary;
      case 'amber':
        return COLORS.tertiary;
      case 'dark':
      default:
        return 'rgba(19, 19, 21, 0.82)'; // Dark translucent
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'primary':
      case 'dark':
        return COLORS.textHighContrast;
      case 'mint':
      case 'amber':
        return COLORS.surface;
      default:
        return COLORS.textHighContrast;
    }
  };

  return (
    <View style={[styles.badge, { backgroundColor: getBackgroundColor() }, style]}>
      <Text style={[styles.text, { color: getTextColor() }, textStyle]}>{label.toUpperCase()}</Text>
    </View>
  );
};

export const Chip = Badge;

const styles = StyleSheet.create({
  badge: {
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.xs + 2, // 10px
    paddingVertical: SPACING['2xs'], // 4px
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  text: {
    ...TYPOGRAPHY.labelXs,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
