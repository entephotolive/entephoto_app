import React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { useTheme, TypographyVariant } from '@/constants/theme';

export type TextVariant = TypographyVariant | 'secondary' | 'muted';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  weight?: TextStyle['fontWeight'];
  children?: React.ReactNode;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color,
  align = 'left',
  weight,
  style,
  children,
  ...rest
}) => {
  const { colors, typography } = useTheme();

  let resolvedColor = color || colors.textPrimary;
  let baseStyle = typography.bodyMd;

  if (variant === 'secondary') {
    resolvedColor = color || colors.textSecondary;
    baseStyle = typography.bodyMd;
  } else if (variant === 'muted') {
    resolvedColor = color || colors.textMuted;
    baseStyle = typography.bodySm;
  } else if (variant && typography[variant as TypographyVariant]) {
    baseStyle = typography[variant as TypographyVariant];
  }

  const computedStyle: TextStyle = {
    ...baseStyle,
    color: resolvedColor,
    textAlign: align,
    ...(weight ? { fontWeight: weight } : {}),
  };

  return (
    <RNText style={[computedStyle, style]} {...rest}>
      {children}
    </RNText>
  );
};
