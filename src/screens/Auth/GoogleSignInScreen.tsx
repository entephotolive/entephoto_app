import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Linking,
  Animated,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Polygon } from 'react-native-svg';
import { Shield, Zap, Heart, ArrowRight, AlertTriangle, RotateCw, X } from 'lucide-react-native';

import { useAuthSession } from './hooks/useAuthSession';
import { Text } from '@/components/Text';
import { useTheme } from '@/constants/theme';

import { AppBackground } from '@/components/AppBackground';

// 4-color Google 'G' official SVG icon
const GoogleGIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      fill="#4285F4"
    />
    <Path
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"
      fill="#34A853"
    />
    <Path
      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      fill="#FBBC05"
    />
    <Path
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      fill="#EA4335"
    />
  </Svg>
);

// Neo-brutalist Sparkle Star
const SparkleStar: React.FC<{ size?: number; color?: string }> = ({
  size = 22,
  color = '#3B82F6',
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 0L14.8 9.2L24 12L14.8 14.8L12 24L9.2 14.8L0 12L9.2 9.2L12 0Z" fill={color} />
  </Svg>
);

export const GoogleSignInScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const { signIn, isLoading, error, debugInfo, clearError, canRetry } = useAuthSession();

  const [pressScale] = useState(new Animated.Value(1));

  const handlePressIn = useCallback(() => {
    if (isLoading) return;
    Animated.spring(pressScale, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start();
  }, [pressScale, isLoading]);

  const handlePressOut = useCallback(() => {
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();
  }, [pressScale]);

  const handleSignIn = useCallback(async () => {
    if (isLoading) return;
    clearError();
    await signIn();
  }, [signIn, clearError, isLoading]);

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ── TOP CONTAINER / BRAND HEADER ── */}
          <View style={styles.headerRow}>
            <View>
              <View style={styles.brandRow}>
                <Text style={[styles.brandTitle, { color: colors.textPrimary }]}>EntePhoto</Text>
                <Text style={[styles.brandDot, { color: colors.primary }]}>.</Text>
              </View>
              <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                EVENTS • PHOTOS • TOGETHER
              </Text>
            </View>

            {/* Rotated badge on top right */}
            <View style={styles.badgeWrapper}>
              <Text style={[styles.badgeText, { color: colors.textPrimary }]}>
                GOOD{'\n'}PHOTOS{'\n'}BETTER{'\n'}STORIES
              </Text>
              <View style={[styles.badgeUnderline, { backgroundColor: colors.primary }]} />
            </View>
          </View>

          {/* ── HERO VISUAL SECTION ── */}
          <View style={styles.heroSection}>
            {/* Soft Backdrop Circle */}
            <View
              style={[
                styles.heroBackdropCircle,
                { backgroundColor: isDark ? colors.primaryMuted : '#FDB69E' },
              ]}
            />

            {/* Playful Floating Accents */}
            {/* Triangle (Top-Left) */}
            <View style={styles.decTriangle}>
              <Svg width={32} height={32} viewBox="0 0 40 40">
                <Polygon
                  points="20,4 36,36 4,36"
                  fill={colors.primary}
                  stroke={colors.border}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <Path d="M12 28 L20 12 L28 28" fill={colors.primaryPressed} />
              </Svg>
            </View>

            {/* Action sparkle lines */}
            <View style={styles.sparkleLines}>
              <View style={[styles.sparkleLine, { width: 6, backgroundColor: colors.primary }]} />
              <View style={[styles.sparkleLine, { width: 12, backgroundColor: colors.primary }]} />
            </View>

            {/* Small Pebble (Far-Left) */}
            <View
              style={[
                styles.decPinkPebble,
                { backgroundColor: colors.primaryMuted, borderColor: colors.border },
              ]}
            />

            {/* Pebble (Right) */}
            <View
              style={[
                styles.decMintPebble,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            />

            {/* Sparkle Star (Far-Right) */}
            <View style={styles.decBlackSparkle}>
              <SparkleStar size={22} color={colors.primary} />
            </View>
            <View style={[styles.decBlackDot, { backgroundColor: colors.primary }]} />

            {/* 3D Clay Camera Artwork Asset */}
            <Image
              source={require('../../../assets/login page/4bd1f543-fcf1-4cf7-b50b-ea2443c97fd6.png')}
              style={styles.heroImage}
              resizeMode="contain"
              accessibilityLabel="EntePhoto 3D Camera illustration"
            />
          </View>

          {/* ── HEADLINE AND CTA SECTION ── */}
          <View style={styles.headlineAndCtaSection}>
            {/* Centered Editorial Headline */}
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              {'Your photos.\nYour event.\nReady to share'}
              <Text style={[styles.headlineDot, { color: colors.primary }]}>.</Text>
            </Text>

            {/* Error Banner with Debug Diagnostics */}
            {error ? (
              <View
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: isDark
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'rgba(254, 242, 242, 0.95)',
                    borderColor: colors.error,
                  },
                ]}
              >
                <View style={styles.errorHeaderRow}>
                  <View style={styles.errorIconTitleRow}>
                    <AlertTriangle size={17} color={colors.error} strokeWidth={2.2} />
                    <Text style={[styles.errorTitle, { color: colors.error }]}>Sign-In Failed</Text>
                  </View>
                  <TouchableOpacity
                    onPress={clearError}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.dismissButton}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss error"
                  >
                    <X size={15} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.errorText, { color: colors.textPrimary }]}>{error}</Text>

                {debugInfo ? (
                  <View
                    style={[
                      styles.debugBox,
                      {
                        backgroundColor: isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.05)',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                      },
                    ]}
                  >
                    <Text style={[styles.debugStepText, { color: colors.textSecondary }]}>
                      Failed Step:{' '}
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>
                        {debugInfo.step}
                      </Text>
                    </Text>
                    {debugInfo.code ? (
                      <Text style={[styles.debugCodeText, { color: colors.textMuted }]}>
                        Error Code: {String(debugInfo.code)}
                      </Text>
                    ) : null}
                    {debugInfo.message && debugInfo.message !== error ? (
                      <Text style={[styles.debugDetailText, { color: colors.textMuted }]}>
                        {debugInfo.message}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {canRetry && (
                  <TouchableOpacity
                    onPress={handleSignIn}
                    style={[styles.retryButton, { backgroundColor: colors.error }]}
                    accessibilityRole="button"
                    accessibilityLabel="Retry Sign-in"
                  >
                    <RotateCw size={13} color="#FFFFFF" strokeWidth={2.2} />
                    <Text style={styles.retryButtonText}>Tap to Retry</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {/* Primary Google Login Button */}
            <View style={styles.ctaContainer}>
              <Animated.View style={{ transform: [{ scale: pressScale }], width: '100%' }}>
                <TouchableOpacity
                  onPress={handleSignIn}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={isLoading}
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  accessibilityState={{ busy: isLoading, disabled: isLoading }}
                  style={[
                    styles.googleButton,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderBottomColor: colors.primary,
                      shadowColor: colors.primary,
                      opacity: isLoading ? 0.75 : 1,
                    },
                  ]}
                >
                  {/* Google 'G' colorful icon container */}
                  <View style={styles.googleIconContainer}>
                    <GoogleGIcon size={20} />
                  </View>

                  {/* Button label */}
                  <Text
                    style={[styles.googleButtonLabel, { color: colors.textPrimary }]}
                    color={colors.textPrimary}
                  >
                    {isLoading ? 'Connecting to Google...' : 'Continue with Google'}
                  </Text>

                  {/* Right Action / Spinner Indicator */}
                  <View style={styles.arrowContainer}>
                    {isLoading ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <ArrowRight size={20} color={colors.textPrimary} strokeWidth={2.5} />
                    )}
                  </View>
                </TouchableOpacity>
              </Animated.View>
            </View>
          </View>

          {/* ── TRUST PILLS AND FOOTER ── */}
          <View style={styles.trustAndFooterSection}>
            {/* Trust Badges Row */}
            <View style={styles.trustBadgesRow}>
              {/* Secure Badge */}
              <View style={styles.trustItem}>
                <View style={[styles.trustIconCircle, { backgroundColor: colors.badgeSecure }]}>
                  <Shield size={18} color={colors.primary} strokeWidth={2} />
                </View>
                <Text style={[styles.trustLabel, { color: colors.textPrimary }]}>Secure</Text>
              </View>

              <View style={[styles.trustDivider, { backgroundColor: colors.border }]} />

              {/* Simple Badge */}
              <View style={styles.trustItem}>
                <View style={[styles.trustIconCircle, { backgroundColor: colors.badgeSimple }]}>
                  <Zap size={18} color={colors.success} fill={colors.success} strokeWidth={1} />
                </View>
                <Text style={[styles.trustLabel, { color: colors.textPrimary }]}>Simple</Text>
              </View>

              <View style={[styles.trustDivider, { backgroundColor: colors.border }]} />

              {/* Fast Badge */}
              <View style={styles.trustItem}>
                <View style={[styles.trustIconCircle, { backgroundColor: colors.badgeFast }]}>
                  <Heart size={18} color="#F43F5E" strokeWidth={2} />
                </View>
                <Text style={[styles.trustLabel, { color: colors.textPrimary }]}>Fast</Text>
              </View>
            </View>

            {/* Sub-footer Links */}
            <View style={styles.footerLinks}>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://entephoto.co.in/terms')}
                accessibilityRole="link"
                accessibilityLabel="Terms of Service"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.footerLinkText, { color: colors.textMuted }]}>Terms</Text>
              </TouchableOpacity>
              <Text style={[styles.footerDot, { color: colors.textMuted }]}>·</Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://entephoto.co.in/privacy')}
                accessibilityRole="link"
                accessibilityLabel="Privacy Policy"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.footerLinkText, { color: colors.textMuted }]}>Privacy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },

  // Ambient Blur Blobs
  blobTopLeft: {
    position: 'absolute',
    top: -40,
    left: -60,
    width: 200,
    height: 200,
  },
  blobBottomRight: {
    position: 'absolute',
    bottom: -60,
    right: -60,
    width: 220,
    height: 220,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 4,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brandTitle: {
    fontFamily: Platform.select({ ios: 'Playfair Display', android: 'serif', default: 'serif' }),
    fontSize: 35,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  brandDot: {
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 38,
  },
  tagline: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  badgeWrapper: {
    transform: [{ rotate: '6deg' }],
    alignItems: 'flex-end',
    paddingTop: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    lineHeight: 12,
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  badgeUnderline: {
    width: 32,
    height: 2,
    marginTop: 4,
    borderRadius: 1,
    alignSelf: 'flex-end',
  },

  // Hero Section
  heroSection: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
    minHeight: 230,
  },
  heroBackdropCircle: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: 4,
    alignSelf: 'center',
    transform: [{ translateX: 14 }],
  },
  heroImage: {
    width: 300,
    height: 225,
    zIndex: 10,
  },

  // Floating Accents
  decTriangle: {
    position: 'absolute',
    top: 4,
    left: 20,
    transform: [{ rotate: '-12deg' }],
    zIndex: 12,
  },
  sparkleLines: {
    position: 'absolute',
    top: 24,
    left: 10,
    flexDirection: 'row',
    gap: 3,
    transform: [{ rotate: '-45deg' }],
    zIndex: 12,
  },
  sparkleLine: {
    height: 2,
    borderRadius: 1,
  },
  decPinkPebble: {
    position: 'absolute',
    left: 4,
    bottom: 80,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    zIndex: 15,
  },
  decMintPebble: {
    position: 'absolute',
    right: 20,
    bottom: 92,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    zIndex: 20,
  },
  decBlackSparkle: {
    position: 'absolute',
    right: -2,
    bottom: 22,
    zIndex: 15,
  },
  decBlackDot: {
    position: 'absolute',
    right: 14,
    top: 62,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  // Headline
  headlineAndCtaSection: {
    alignItems: 'center',
    paddingHorizontal: 6,
    zIndex: 10,
  },
  headline: {
    fontFamily: Platform.select({ ios: 'Playfair Display', android: 'serif', default: 'serif' }),
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 41,
    textAlign: 'center',
    letterSpacing: -0.5,
    maxWidth: 340,
  },
  headlineDot: {
    fontWeight: '900',
    fontSize: 42,
  },

  // Error Banner
  errorBanner: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
    width: '100%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  errorIconTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  dismissButton: {
    padding: 2,
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 17,
  },
  debugBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
  },
  debugStepText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
  },
  debugCodeText: {
    fontSize: 10.5,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
  },
  debugDetailText: {
    fontSize: 10.5,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
    lineHeight: 14,
  },
  retryButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Button
  ctaContainer: {
    width: '100%',
    maxWidth: 320,
    marginTop: 36,
    alignItems: 'center',
  },
  googleButton: {
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    width: '100%',
    borderBottomWidth: 4,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  googleIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  googleButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flex: 1,
    paddingHorizontal: 8,
    letterSpacing: -0.2,
  },
  arrowContainer: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },

  // Trust Badges
  trustAndFooterSection: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 4,
  },
  trustBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  trustItem: {
    alignItems: 'center',
  },
  trustIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    letterSpacing: -0.2,
  },
  trustDivider: {
    width: 1,
    height: 24,
  },

  // Footer Links
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  footerLinkText: {
    fontSize: 11,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  footerDot: {
    fontSize: 13,
  },
});
