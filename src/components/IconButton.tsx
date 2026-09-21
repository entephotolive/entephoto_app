import React from 'react';
import { Pressable, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { COLORS } from '@/constants/theme';

export interface IconButtonProps {
  icon: React.ReactNode;
  onPress?: () => void;
  size?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  onPress,
  size = 44,
  borderRadius = 14, // rounded-2xl feel
  style,
  accessibilityLabel,
  active = false,
}) => {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: active ? COLORS.surfaceContainerHigh : COLORS.surfaceContainerLow,
          borderColor: active ? COLORS.borderStrong : COLORS.borderSubtle,
          transform: [{ scale: pressed ? 0.95 : 1 }],
          opacity: pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
