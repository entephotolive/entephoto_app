// ─────────────────────────────────────────────────────────────────────────────
// ThemeProvider.tsx — React context for the app theme
// ─────────────────────────────────────────────────────────────────────────────
import React, { createContext, useContext, useMemo, useState, useCallback, ReactNode } from 'react';
import { useColorScheme, StatusBar } from 'react-native';
import { lightColors, darkColors, ThemeColors } from './colors';
import { TYPOGRAPHY, FONTS } from './typography';
import { SPACING, RADII } from './spacing';
import { SHADOWS } from './shadows';

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
  initialMode = 'system',
}) => {
  const systemColorScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  const isDark = useMemo(() => {
    if (mode === 'system') {
      return systemColorScheme !== 'light'; // defaults to dark
    }
    return mode === 'dark';
  }, [mode, systemColorScheme]);

  const toggleTheme = useCallback(() => {
    setMode(prev => {
      if (prev === 'system') return isDark ? 'light' : 'dark';
      return prev === 'dark' ? 'light' : 'dark';
    });
  }, [isDark]);

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
    [isDark, mode, toggleTheme],
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
