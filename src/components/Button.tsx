import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
  PressableProps,
} from 'react-native';
import { useTheme } from '@/constants/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'google';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  containerStyle,
  labelStyle,
  onPress,
  ...rest
}) => {
  const { colors, spacing, radius } = useTheme();
  const [isPressed, setIsPressed] = useState(false);

  const isDisabled = disabled || loading;

  const getHeight = (): number => {
    switch (size) {
      case 'sm':
        return 40;
      case 'md':
        return 48;
      case 'lg':
      default:
        return 56;
    }
  };

  const getVariantStyles = (): {
    container: ViewStyle;
    textColor: string;
    indicatorColor: string;
  } => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: isPressed ? colors.primaryPressed : colors.primary,
            borderWidth: 0,
          },
          textColor: colors.textPrimary,
          indicatorColor: colors.textPrimary,
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: isPressed ? colors.surfaceElevated : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          },
          textColor: colors.textPrimary,
          indicatorColor: colors.textPrimary,
        };
      case 'outline':
        return {
          container: {
            backgroundColor: isPressed ? colors.surface : 'transparent',
            borderWidth: 1,
            borderColor: colors.border,
          },
          textColor: colors.textPrimary,
          indicatorColor: colors.primary,
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: isPressed ? colors.surface : 'transparent',
          },
          textColor: colors.textSecondary,
          indicatorColor: colors.primary,
        };
      case 'google':
        return {
          container: {
            backgroundColor: isPressed ? '#080C14' : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          },
          textColor: colors.textPrimary,
          indicatorColor: colors.textPrimary,
        };
    }
  };

  const variantStyle = getVariantStyles();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.base,
        {
          height: getHeight(),
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          opacity: isDisabled && !loading ? 0.5 : 1,
        },
        variantStyle.container,
        containerStyle,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.indicatorColor} size="small" />
      ) : (
        <View style={styles.contentRow}>
          {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
          <Text variant="labelMd" color={variantStyle.textColor} style={[styles.label, labelStyle]}>
            {label}
          </Text>
          {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLeft: {
    marginRight: 10,
  },
  iconRight: {
    marginLeft: 10,
  },
  label: {
    textAlign: 'center',
  },
});
