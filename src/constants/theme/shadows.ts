// ─────────────────────────────────────────────────────────────────────────────
// shadows.ts — Shadow tokens (hard neo-brutalist + soft ambient)
// ─────────────────────────────────────────────────────────────────────────────
import { Platform, ViewStyle } from 'react-native';

// ── Hard (neo-brutalist) shadows ──────────────────────────────────────────────

const hardDrop = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  android: { elevation: 4 },
  default: {
    // @ts-ignore – web boxShadow
    boxShadow: '3px 3px 0px #000000',
  },
}) as ViewStyle;

const hardDropCoral = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#FF5E3A',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.8,
    shadowRadius: 0,
  },
  android: { elevation: 4 },
  default: {
    // @ts-ignore – web boxShadow
    boxShadow: '3px 3px 0px #FF5E3A',
  },
}) as ViewStyle;

const hardDropLg = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  android: { elevation: 6 },
  default: {
    // @ts-ignore – web boxShadow
    boxShadow: '5px 5px 0px #000000',
  },
}) as ViewStyle;

// ── Soft (ambient) shadows ────────────────────────────────────────────────────

const softSm = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  android: { elevation: 2 },
  default: {},
}) as ViewStyle;

const softMd = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  android: { elevation: 4 },
  default: {},
}) as ViewStyle;

const softLg = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  android: { elevation: 8 },
  default: {},
}) as ViewStyle;

const glow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#FF5E3A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  android: { elevation: 6 },
  default: {},
}) as ViewStyle;

const card = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  android: { elevation: 3 },
  default: {},
}) as ViewStyle;

// ── Named export maps ─────────────────────────────────────────────────────────

/** SCREAMING_SNAKE_CASE — used by components that import directly */
export const SHADOWS = {
  // Hard
  hardDrop,
  hardDropCoral,
  hardDropLg,
  // Soft
  sm: softSm,
  md: softMd,
  lg: softLg,
  glow,
  card,
  none: {} as ViewStyle,
} as const;

/** camelCase alias — used by ThemeProvider's `shadows` field */
export const shadows = SHADOWS;
