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
import { StatusBar } from 'react-native';
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
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  // Restore saved theme preference on mount if available
  useEffect(() => {
    let isMounted = true;
    storageService
      .getThemePreference()
      .then(saved => {
        if (isMounted && (saved === 'light' || saved === 'dark')) {
          setModeState(saved);
        }
      })
      .catch(error => {
        console.error('[ThemeProvider] Failed to restore theme preference:', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const isDark = mode === 'dark';

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    const toSave = newMode === 'dark' ? 'dark' : 'light';
    storageService.setThemePreference(toSave).catch(error => {
      console.error('[ThemeProvider] Failed to persist theme preference:', error);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setModeState(prev => {
      const nextMode = prev === 'dark' ? 'light' : 'dark';
      storageService.setThemePreference(nextMode).catch(error => {
        console.error('[ThemeProvider] Failed to persist theme preference:', error);
      });
      return nextMode;
    });
  }, []);

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
