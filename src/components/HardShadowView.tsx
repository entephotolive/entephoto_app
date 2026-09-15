import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, Platform } from 'react-native';
import { COLORS, RADII } from '@/constants/theme';

export interface HardShadowViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  shadowColor?: string;
  offset?: number;
  borderRadius?: number;
}

export const HardShadowView: React.FC<HardShadowViewProps> = ({
  children,
  style,
  containerStyle,
  shadowColor = COLORS.black,
  offset = 3,
  borderRadius = RADII.card,
}) => {
  if (Platform.OS === 'ios') {
    return (
      <View
        style={[
          styles.iosShadow,
          {
            shadowColor,
            shadowOffset: { width: offset, height: offset },
          },
          containerStyle,
        ]}
      >
        <View style={[{ borderRadius, overflow: 'hidden' }, style]}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[styles.androidContainer, containerStyle]}>
      {/* Underlying Hard Shadow Layer */}
      <View
        style={[
          styles.androidShadowLayer,
          {
            backgroundColor: shadowColor,
            borderRadius,
            top: offset,
            left: offset,
            right: -offset,
            bottom: -offset,
          },
        ]}
      />
      {/* Main Content Container */}
      <View style={[{ borderRadius, overflow: 'hidden' }, style]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  iosShadow: {
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  androidContainer: {
    position: 'relative',
  },
  androidShadowLayer: {
    position: 'absolute',
    zIndex: 0,
  },
});
