// ─────────────────────────────────────────────────────────────────────────────
// typography.ts — Font families & text style tokens
// ─────────────────────────────────────────────────────────────────────────────
import { TextStyle } from 'react-native';

// ── Font family map ───────────────────────────────────────────────────────────

export const FONTS = {
  syne: {
    bold: 'Syne_700Bold',
    extraBold: 'Syne_800ExtraBold',
  },
  plusJakartaSans: {
    regular: 'PlusJakartaSans_400Regular',
    medium: 'PlusJakartaSans_500Medium',
    semiBold: 'PlusJakartaSans_600SemiBold',
    bold: 'PlusJakartaSans_700Bold',
    extraBold: 'PlusJakartaSans_800ExtraBold',
  },
  jetbrainsMono: {
    semiBold: 'JetBrainsMono_600SemiBold',
    bold: 'JetBrainsMono_700Bold',
  },
} as const;

// ── Text style tokens ─────────────────────────────────────────────────────────

export const TYPOGRAPHY = {
  // Display — hero titles
  displayLg: {
    fontFamily: FONTS.syne.extraBold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
    fontWeight: '800',
  } as TextStyle,

  displayMd: {
    fontFamily: FONTS.syne.extraBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    fontWeight: '800',
  } as TextStyle,

  // Headline — section titles
  headlineLg: {
    fontFamily: FONTS.syne.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontWeight: '700',
  } as TextStyle,

  headlineMd: {
    fontFamily: FONTS.syne.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    fontWeight: '700',
  } as TextStyle,

  headlineSm: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    fontWeight: '700',
  } as TextStyle,

  // Body — reading copy
  bodyLg: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  } as TextStyle,

  bodyMd: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  } as TextStyle,

  bodySm: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  } as TextStyle,

  bodyXs: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  } as TextStyle,

  // Label — UI chrome, buttons, badges
  labelLg: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.2,
    fontWeight: '700',
  } as TextStyle,

  labelMd: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    fontWeight: '700',
  } as TextStyle,

  labelSm: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
    fontWeight: '700',
  } as TextStyle,

  labelXs: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    fontWeight: '800',
  } as TextStyle,

  // Mono — code, IDs, technical strings
  labelMonoSm: {
    fontFamily: FONTS.jetbrainsMono.semiBold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  } as TextStyle,

  labelMonoXs: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
    fontWeight: '700',
  } as TextStyle,
} as const;

// Flat alias used by ThemeProvider's `typography` field
export const typography = TYPOGRAPHY;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TypographyVariant = keyof typeof TYPOGRAPHY;
export type FontFamilies = typeof FONTS;
