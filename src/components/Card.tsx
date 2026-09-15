import React, { ReactNode } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, Pressable, PressableProps } from 'react-native';
import { useTheme } from '@/constants/theme';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  bordered?: boolean;
  onPress?: PressableProps['onPress'];
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  elevated = false,
  bordered = true,
  onPress,
}) => {
  const { colors, spacing, radius } = useTheme();

  const containerStyle: ViewStyle = {
    backgroundColor: elevated ? colors.surfaceElevated : colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: bordered ? 1 : 0,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: elevated ? 4 : 2,
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.base,
          containerStyle,
          pressed && { opacity: 0.85, borderColor: colors.primary },
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.base, containerStyle, style]}>{children}</View>;
};

const styles = StyleSheet.create({
  base: {
    width: '100%',
  },
});
