// ─────────────────────────────────────────────────────────────────────────────
// ThemeProvider.tsx — React context for the app theme
// ─────────────────────────────────────────────────────────────────────────────
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import { lightColors, darkColors, ThemeColors } from './colors';
import { TYPOGRAPHY, FONTS } from './typography';
import { SPACING, RADII } from './spacing';
import { SHADOWS } from './shadows';
import { storageService } from '@/services/storageService';

export type ThemeMode = 'system' | 'dark' | 'light';

// ── Theme shape ───────────────────────────────────────────────────────────────

export interface Theme {
  // Contextual (switch between dark/light)
  colors: ThemeColors;

  // Static tokens (same in both modes — screens can pick from theme directly)
  typography: typeof TYPOGRAPHY;
  fonts: typeof FONTS;
  spacing: typeof SPACING;
  radius: typeof RADII;
  radii: typeof RADII;
  shadows: typeof SHADOWS;

  // Theme state
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<Theme | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export interface ThemeProviderProps {
  children: ReactNode;
  initialMode?: ThemeMode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  initialMode = 'light',
}) => {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  // Restore saved theme on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const savedMode = await storageService.getThemeMode();
        if (savedMode && isMounted) {
          setModeState(savedMode);
        }
      } catch (err) {
        console.warn('[ThemeProvider] Error restoring theme mode:', err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    storageService.setThemeMode(newMode).catch(err => {
      console.error('[ThemeProvider] Error saving theme mode:', err);
    });
  }, []);

  const isDark = useMemo(() => {
    if (mode === 'system') {
      return systemColorScheme === 'dark';
    }
    return mode === 'dark';
  }, [mode, systemColorScheme]);

  const toggleTheme = useCallback(() => {
    const nextMode: ThemeMode = isDark ? 'light' : 'dark';
    setMode(nextMode);
  }, [isDark, setMode]);

  const theme: Theme = useMemo(
    () => ({
      colors: isDark ? darkColors : lightColors,
      typography: TYPOGRAPHY,
      fonts: FONTS,
      spacing: SPACING,
      radius: RADII,
      radii: RADII,
      shadows: SHADOWS,
      isDark,
      mode,
      setMode,
      toggleTheme,
    }),
    [isDark, mode, setMode, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />
      {children}
    </ThemeContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useTheme = (): Theme => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
