import React, { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/theme';

export interface ScreenProps {
  children: ReactNode;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  edges?: Edge[];
  keyboardAvoiding?: boolean;
  statusBarColor?: string;
  statusBarStyle?: 'light-content' | 'dark-content';
}

export const Screen: React.FC<ScreenProps> = ({
  children,
  scrollable = false,
  style,
  contentContainerStyle,
  backgroundColor,
  edges = ['top', 'left', 'right'],
  keyboardAvoiding = true,
  statusBarColor,
  statusBarStyle,
}) => {
  const { colors, isDark } = useTheme();
  const bgColor = backgroundColor || colors.background;
  const currentStatusBarStyle = statusBarStyle || (isDark ? 'light-content' : 'dark-content');

  const Container = keyboardAvoiding ? KeyboardAvoidingView : View;
  const containerProps = keyboardAvoiding
    ? {
        behavior: Platform.OS === 'ios' ? ('padding' as const) : undefined,
        style: styles.flex,
      }
    : { style: styles.flex };

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: bgColor }, style]}>
      <StatusBar
        barStyle={currentStatusBarStyle}
        backgroundColor={statusBarColor || bgColor}
        animated
      />
      <Container {...containerProps}>
        {scrollable ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={true}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, contentContainerStyle]}>{children}</View>
        )}
      </Container>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
