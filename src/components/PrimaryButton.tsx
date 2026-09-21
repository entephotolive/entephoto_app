import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  ActivityIndicator,
  View,
} from 'react-native';
import { COLORS, RADII, SPACING } from '@/constants/theme';
import { TYPOGRAPHY } from '@/constants/typography';

export interface PrimaryButtonProps {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  shadowColor?: string;
}

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  style,
  textStyle,
  shadowColor = COLORS.black,
}) => {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.outerContainer,
        {
          transform: [
            { translateX: pressed && !disabled ? 2 : 0 },
            { translateY: pressed && !disabled ? 2 : 0 },
          ],
        },
      ]}
    >
      {({ pressed }) => (
        <View style={styles.relativeWrap}>
          {/* Hard Shadow Layer for Android / Web / Cross-platform */}
          <View
            style={[
              styles.shadowBackdrop,
              {
                backgroundColor: shadowColor,
                top: pressed && !disabled ? 1 : 3,
                left: pressed && !disabled ? 1 : 3,
                right: pressed && !disabled ? -1 : -3,
                bottom: pressed && !disabled ? -1 : -3,
              },
            ]}
          />

          {/* Front Button Face */}
          <View
            style={[
              styles.buttonFace,
              {
                backgroundColor: disabled ? COLORS.surfaceContainerHigh : COLORS.primaryContainer,
                borderColor: COLORS.black,
                opacity: disabled ? 0.6 : 1,
              },
              style,
            ]}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.textHighContrast} size="small" />
            ) : (
              <View style={styles.contentRow}>
                <Text
                  style={[
                    styles.labelText,
                    {
                      color: disabled ? COLORS.textDim : COLORS.textHighContrast,
                    },
                    textStyle,
                  ]}
                >
                  {label}
                </Text>
                {icon ? <View style={styles.iconContainer}>{icon}</View> : null}
              </View>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    alignSelf: 'stretch',
  },
  relativeWrap: {
    position: 'relative',
  },
  shadowBackdrop: {
    position: 'absolute',
    borderRadius: RADII.pill,
    zIndex: 0,
  },
  buttonFace: {
    height: 52,
    borderRadius: RADII.pill,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    zIndex: 1,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  labelText: {
    ...TYPOGRAPHY.labelLg,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  iconContainer: {
    marginLeft: SPACING['2xs'],
  },
});
