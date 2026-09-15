import React, { useEffect, useMemo } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { NavigationContainer, Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/authService';
import { Loader } from '@/components';
import { useTheme } from '@/constants/theme';

const Root = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const { colors, isDark } = useTheme();
  const { isAuthenticated, isLoading, setAuthenticated, setLoading } = useAuthStore();

  // Initial session restoration on startup
  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      setLoading(true);
      const status = await authService.checkAuthStatus();
      if (mounted) setAuthenticated(status.isAuthenticated, status.token, status.user);
    };
    restore();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React Navigation Theme linked to app theme tokens
  const navigationTheme: NavTheme = useMemo(() => {
    return {
      dark: isDark,
      colors: {
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.textPrimary,
        border: colors.border,
        notification: colors.primary,
      },
      fonts: {
        regular: { fontFamily: 'System', fontWeight: '400' },
        medium: { fontFamily: 'System', fontWeight: '500' },
        bold: { fontFamily: 'System', fontWeight: '700' },
        heavy: { fontFamily: 'System', fontWeight: '900' },
      },
    };
  }, [colors, isDark]);

  if (isLoading) {
    return <Loader message="Restoring session..." />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Root.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { color: colors.textPrimary, fontWeight: '700' },
        }}
      >
        {isAuthenticated ? (
          <Root.Screen name="App" component={AppNavigator} />
        ) : (
          <Root.Screen name="Auth" component={AuthNavigator} />
        )}
      </Root.Navigator>
    </NavigationContainer>
  );
};
