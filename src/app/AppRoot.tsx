import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Platform,
  Alert,
  AppState,
  InteractionManager,
} from 'react-native';
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
import { initializeEntePhotoFolder } from '@/services/localPhotoService';

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

  const hasPromptedSafRef = React.useRef(false);

  useEffect(() => {
    if (!isReady) return;

    let isMounted = true;
    const runStartupStorageInit = async () => {
      try {
        const res = await initializeEntePhotoFolder({ interactive: false });
        if (!isMounted) return;

        console.log('[AppRoot] Startup folder init result:', res);

        if (
          res.status === 'permission_required' &&
          Platform.OS === 'android' &&
          !hasPromptedSafRef.current
        ) {
          hasPromptedSafRef.current = true;
          Alert.alert(
            'Setup EntePhoto Folder',
            'EntePhoto needs access to your DCIM folder so camera photos are saved to "DCIM/Entephoto" on your device storage.',
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Select DCIM Folder',
                onPress: () => {
                  initializeEntePhotoFolder({ interactive: true }).catch(err => {
                    console.warn('[AppRoot] Interactive folder init error:', err);
                  });
                },
              },
            ],
          );
        }
      } catch (err) {
        console.warn('[AppRoot] Non-blocking storage init warning:', err);
      }
    };

    const handle = InteractionManager.runAfterInteractions(() => {
      runStartupStorageInit();
    });

    return () => {
      isMounted = false;
      handle.cancel();
    };
  }, [isReady]);

  // Handle repeated foreground/resume events safely without showing unprompted alerts
  useEffect(() => {
    if (!isReady || Platform.OS !== 'android') return;

    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        initializeEntePhotoFolder({ interactive: false }).catch(() => {});
      }
    });

    return () => {
      sub.remove();
    };
  }, [isReady]);

  const onLayoutSplash = useCallback(async () => {
    await SplashScreen.hideAsync().catch(() => {});
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (isReady) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [isReady]);

  if (!isReady) {
    return (
      <View style={styles.splashContainer} onLayout={onLayoutSplash}>
        <Image
          source={require('../../assets/LOGO_W.png')}
          style={styles.splashLogo}
          resizeMode="contain"
          accessibilityLabel="EntePhoto logo"
        />
      </View>
    );
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
  splashContainer: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  splashLogo: {
    width: '75%',
    maxWidth: 320,
    aspectRatio: 1,
  },
});
