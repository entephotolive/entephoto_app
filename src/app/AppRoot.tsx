import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Syne_700Bold, Syne_800ExtraBold } from '@expo-google-fonts/syne';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { ThemeProvider, ThemeMode } from '@/constants/theme';
import { RootNavigator } from '@/navigation/RootNavigator';
import { storageService } from '@/services/storageService';

// Keep splash screen visible while resources load
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 5 minutes
      retry: 2,
    },
  },
});

export const AppRoot: React.FC = () => {
  const [fontsLoaded, fontError] = useFonts({
    Syne_700Bold,
    Syne_800ExtraBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });

  const [initialTheme, setInitialTheme] = useState<ThemeMode | null>(null);

  useEffect(() => {
    let isMounted = true;
    storageService
      .getThemePreference()
      .then(saved => {
        if (isMounted) {
          setInitialTheme(saved ?? 'light');
        }
      })
      .catch(() => {
        if (isMounted) {
          setInitialTheme('light');
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const isReady = (fontsLoaded || fontError) && initialTheme !== null;

  const onLayoutRootView = useCallback(async () => {
    if (isReady) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider initialMode={initialTheme}>
            <RootNavigator />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
