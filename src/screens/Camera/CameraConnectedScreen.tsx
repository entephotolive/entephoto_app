import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Polygon, Line } from 'react-native-svg';
import {
  ArrowLeft,
  Calendar,
  ArrowRight,
  Check,
  Wifi,
  Usb,
  Image as ImageIcon,
  Settings,
  Heart,
  Images,
  CheckSquare,
  ArrowUp,
  Power,
  Terminal,
  AlertTriangle,
} from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AppNavigationProp, AppStackParamList } from '@/navigation/types';
import { Text } from '@/components/Text';
import { useTheme } from '@/constants/theme';
import { FONTS } from '@/constants/typography';
import { formatEventDate } from '@/utils/date';
import { AppBackground } from '@/components/AppBackground';
import { addPhotoSavedListener, addPhotoTransferErrorListener, disconnect } from 'entephoto-camera';
import type { PhotoSavedEvent, PhotoTransferErrorEvent } from 'entephoto-camera';
import { CameraDiagnosticConsole } from './CameraDiagnosticConsole';

// ── Image Assets ────────────────────────────────────────────────────────────
const SONY_CAMERA_HERO = require('../../../assets/ctAYourCamera/527a3e8b-c9b0-4344-8f9a-182b25e5a8c2.png');
const DEFAULT_AVATAR = require('../../../assets/image.png');

// ── Decorative Hand-Drawn Dash Burst SVG ────────────────────────────────────
const DecorativeDashBurst: React.FC<{ color?: string }> = ({ color = '#161616' }) => (
  <Svg width={24} height={28} viewBox="0 0 24 28">
    <Line x1="18" y1="4" x2="6" y2="10" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    <Line x1="22" y1="14" x2="8" y2="14" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    <Line x1="18" y1="24" x2="6" y2="18" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
  </Svg>
);

export const CameraConnectedScreen: React.FC = () => {
  const navigation = useNavigation<AppNavigationProp>();
  const route = useRoute<RouteProp<AppStackParamList, 'CameraConnected'>>();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Route Params (Fallback to default mock event info)
  const eventTitle = route.params?.eventTitle || 'Rahul & Fathima';
  const eventDateFormatted = route.params?.eventDate
    ? formatEventDate(route.params.eventDate)
    : '05 Sep 2026';
  const coverImage = route.params?.coverImage;
  const cameraModel = route.params?.cameraModel || 'Sony A7 IV';
  const connectionType = route.params?.connectionType || 'wifi';

  // Live photo count: increments each time a real photo is saved during this session.
  const [photoCount, setPhotoCount] = useState<number>(0);
  const [isDiagnosticVisible, setIsDiagnosticVisible] = useState(false);
  const [lastTransferError, setLastTransferError] = useState<string | null>(null);

  // Subscribe to photo-save and transfer-error events while on this screen.
  useEffect(() => {
    const photoSavedSub = addPhotoSavedListener((event: PhotoSavedEvent) => {
      console.log(
        '[CameraConnected] onPhotoSaved — filename:',
        event.filename,
        'mimeType:',
        event.mimeType,
        'uri:',
        event.uri,
      );
      setPhotoCount(prev => prev + 1);
    });

    const errorSub = addPhotoTransferErrorListener((event: PhotoTransferErrorEvent) => {
      console.warn(
        '[CameraConnected] onPhotoTransferError:',
        event.message,
        'handle:',
        event.handle,
      );
      setLastTransferError(event.message);
    });

    return () => {
      photoSavedSub.remove();
      errorSub.remove();
    };
  }, []);

  // Back navigation handler
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('CameraConnect');
    }
  }, [navigation]);

  // View Photos navigation handler
  const handleViewPhotos = useCallback(() => {
    navigation.navigate('PhotoSelectionGallery', {
      eventId: route.params?.eventId,
      eventTitle,
      eventDate: route.params?.eventDate,
      eventCategory: route.params?.eventCategory,
      coverImage,
      cameraModel,
      photoCount,
    });
  }, [
    navigation,
    route.params?.eventId,
    route.params?.eventDate,
    route.params?.eventCategory,
    eventTitle,
    coverImage,
    cameraModel,
    photoCount,
  ]);

  // Disconnection state to disable repeated taps
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);

  // Disconnect handler
  const handleDisconnect = useCallback(() => {
    if (isDisconnecting) return;

    Alert.alert(
      'Disconnect Camera?',
      `Are you sure you want to disconnect ${cameraModel}? Photo transfer will stop and USB resources will be released.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            setIsDisconnecting(true);
            try {
              console.log('[CameraConnected] Initiating explicit camera disconnect...');
              disconnect();
              console.log('[CameraConnected] Native disconnect() invoked successfully');
              navigation.navigate('CameraConnect', {
                eventId: route.params?.eventId,
                eventTitle,
                eventDate: route.params?.eventDate,
                eventCategory: route.params?.eventCategory,
                coverImage,
              });
            } catch (error) {
              console.error('[CameraConnected] Disconnect failed:', error);
              Alert.alert(
                'Disconnection Failed',
                'An error occurred while disconnecting the camera. Please disconnect the USB cable directly.',
              );
              setIsDisconnecting(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [isDisconnecting, cameraModel, navigation, route.params, eventTitle, coverImage]);

  // Camera Settings handler
  const handleCameraSettings = useCallback(() => {
    Alert.alert(
      'Camera Settings',
      `${cameraModel} is configured for real-time sync.\n\nConnection: ${
        connectionType === 'wifi' ? 'Wi-Fi Direct (5 GHz)' : 'USB-C (High Speed)'
      }`,
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Disconnect Camera', style: 'destructive', onPress: handleDisconnect },
      ],
    );
  }, [cameraModel, connectionType, handleDisconnect]);

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 20) + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. HEADER ROW (Exact reuse of header pattern) ── */}
          <View style={styles.headerRow}>
            {/* Functional Back Button with Hard Neo-Brutalist Shadow */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleBack}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[
                styles.backButton,
                {
                  backgroundColor: isDark ? '#1A1A1E' : 'rgba(234, 223, 212, 0.7)',
                  borderColor: isDark ? '#2E2E36' : '#DFCFC2',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={20} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.4} />
            </TouchableOpacity>

            {/* Brand Wordmark with Coral Dot */}
            <View style={styles.brandContainer}>
              <Text style={[styles.brandText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                EntePhoto<Text style={{ color: '#FF5E3A' }}>.</Text>
              </Text>
            </View>

            {/* Right Event Header Pill */}
            <View style={styles.eventPill}>
              <View style={styles.eventPillTexts}>
                <Text
                  style={[styles.eventPillTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                  numberOfLines={1}
                >
                  {eventTitle}
                </Text>
                <View style={styles.eventPillDateRow}>
                  <Calendar
                    size={11}
                    color={isDark ? '#A1A1AA' : '#7A7571'}
                    strokeWidth={2}
                    style={{ marginRight: 3 }}
                  />
                  <Text
                    style={[styles.eventPillDateText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                  >
                    {eventDateFormatted}
                  </Text>
                </View>
              </View>

              {/* Event Avatar Thumbnail */}
              <View
                style={[
                  styles.eventAvatarContainer,
                  { borderColor: isDark ? '#3F3F46' : '#FFFFFF' },
                ]}
              >
                <Image
                  source={
                    coverImage && coverImage.startsWith('http')
                      ? { uri: coverImage }
                      : DEFAULT_AVATAR
                  }
                  style={styles.eventAvatarImage}
                  resizeMode="cover"
                />
              </View>
            </View>
          </View>

          {/* ── 2. HERO TITLE BLOCK ── */}
          <View style={styles.heroSection}>
            <View style={styles.heroTitleRow}>
              <Text style={[styles.heroHeadline, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                Camera{'\n'}Connected<Text style={{ color: '#FF5E3A' }}>!</Text>
              </Text>

              {/* Angled Mono "GOOD TO GO!" Sticker Badge */}
              <View style={styles.stickerBadge}>
                <Text style={styles.stickerText}>GOOD</Text>
                <Text style={styles.stickerText}>TO GO!</Text>
                <View style={styles.stickerUnderline} />
              </View>
            </View>

            <Text style={[styles.heroSubtext, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
              Your camera is ready. Let&apos;s capture some amazing memories.
            </Text>
          </View>

          {/* ── 3. CAMERA HERO SHOWCASE ── */}
          <View style={styles.cameraShowcaseContainer}>
            {/* Soft Circular Coral/Peach Glow Disc Backdrop */}
            <View style={styles.cameraGlowDisc} />

            {/* Decorative Geometric Elements */}
            <View pointerEvents="none" style={styles.geoGreenTriangle}>
              <Svg width={24} height={24} viewBox="0 0 32 32">
                <Polygon
                  points="2,28 30,28 16,4"
                  fill="#52E5A8"
                  stroke="#161616"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>

            <View pointerEvents="none" style={styles.geoHollowCircle}>
              <Svg width={18} height={18} viewBox="0 0 20 20">
                <Circle cx="10" cy="10" r="7" stroke="#161616" strokeWidth="2.2" fill="none" />
              </Svg>
            </View>

            <View pointerEvents="none" style={styles.geoSolidDot} />

            {/* Main Sony A7 IV Camera Image */}
            <Image
              source={SONY_CAMERA_HERO}
              style={styles.cameraHeroImage}
              resizeMode="contain"
              accessibilityLabel="Sony A7 IV Camera Connected"
            />

            {/* Overlapping Success Mint Checkmark Badge (Top-Left) */}
            <View style={styles.successBadgeWrapper}>
              {/* Decorative Dash Burst Marks to the left of the badge */}
              <View style={styles.dashBurstContainer}>
                <DecorativeDashBurst color={isDark ? '#52E5A8' : '#161616'} />
              </View>

              <View style={styles.badgeShadowContainer}>
                <View style={styles.badgeHardShadow} />
                <View style={styles.successBadgeFace}>
                  <Check size={24} color="#161616" strokeWidth={3.4} />
                </View>
              </View>
            </View>

            {/* Overlapping Rotated Sticky Note Tag (Top-Right) */}
            <View style={styles.stickyNoteWrapper}>
              <View style={styles.stickyNoteShadow} />
              <View
                style={[
                  styles.stickyNoteFace,
                  {
                    backgroundColor: isDark ? '#2D221D' : '#FFE8D6',
                    borderColor: isDark ? '#3E2F28' : '#161616',
                  },
                ]}
              >
                <Text style={[styles.stickyNoteTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  Same Moments{'\n'}Bigger Stories
                </Text>
                <View style={styles.stickyNoteHeartRow}>
                  <Heart size={13} color={isDark ? '#FF6B4A' : '#161616'} strokeWidth={2} />
                </View>
              </View>
            </View>
          </View>

          {/* ── 4. CAMERA DETAILS CARD ── */}
          <View style={styles.cardShadowWrapper}>
            <View style={styles.cardHardShadowUnderlay} />
            <View
              style={[
                styles.cameraDetailsCardFace,
                {
                  backgroundColor: isDark ? '#1A1A1E' : '#FFFFFF',
                  borderColor: isDark ? '#2E2E36' : '#161616',
                },
              ]}
            >
              {/* Left Column: Camera Model & Connection Status */}
              <View style={styles.cameraDetailsLeft}>
                <Text style={[styles.cameraModelTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  {cameraModel}
                </Text>

                <View style={styles.metaRow}>
                  {connectionType === 'wifi' ? (
                    <Wifi
                      size={14}
                      color={isDark ? '#A1A1AA' : '#7A7571'}
                      strokeWidth={2.2}
                      style={{ marginRight: 6 }}
                    />
                  ) : (
                    <Usb
                      size={14}
                      color={isDark ? '#A1A1AA' : '#7A7571'}
                      strokeWidth={2.2}
                      style={{ marginRight: 6 }}
                    />
                  )}
                  <Text style={[styles.metaText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                    {connectionType === 'wifi' ? 'Connected via Wi-Fi' : 'Connected via USB-C'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <ImageIcon
                    size={14}
                    color={isDark ? '#A1A1AA' : '#7A7571'}
                    strokeWidth={2.2}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.metaText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                    {photoCount} photos available
                  </Text>
                </View>
              </View>

              {/* Right Column: Settings + Diagnostics Buttons */}
              <View style={styles.actionColumn}>
                <Pressable
                  onPress={handleCameraSettings}
                  style={({ pressed }) => [
                    styles.settingsBtnWrapper,
                    {
                      transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }],
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Camera Settings"
                >
                  <View
                    style={[
                      styles.settingsBtnFace,
                      {
                        backgroundColor: isDark ? '#26262E' : '#FFFFFF',
                        borderColor: isDark ? '#3F3F46' : '#161616',
                      },
                    ]}
                  >
                    <Settings
                      size={13}
                      color={isDark ? '#F4F4F5' : '#161616'}
                      strokeWidth={2.2}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={[styles.settingsBtnText, { color: isDark ? '#F4F4F5' : '#161616' }]}
                    >
                      Settings
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => setIsDiagnosticVisible(true)}
                  style={({ pressed }) => [
                    styles.diagBtnWrapper,
                    {
                      transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }],
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Diagnostic Console"
                >
                  <View
                    style={[
                      styles.diagBtnFace,
                      {
                        backgroundColor: isDark ? '#1E293B' : '#EFF6FF',
                        borderColor: isDark ? '#38BDF8' : '#2563EB',
                      },
                    ]}
                  >
                    <Terminal
                      size={13}
                      color={isDark ? '#38BDF8' : '#2563EB'}
                      strokeWidth={2.2}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.diagBtnText, { color: isDark ? '#38BDF8' : '#2563EB' }]}>
                      Logs
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </View>

          {/* ── TRANSFER ERROR BANNER (Tappable to open diagnostics) ── */}
          {lastTransferError && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.transferErrorBanner,
                {
                  backgroundColor: isDark ? '#3B1212' : '#FEF2F2',
                  borderColor: '#EF4444',
                },
              ]}
              onPress={() => setIsDiagnosticVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="View transfer error diagnostics"
            >
              <AlertTriangle
                size={18}
                color="#EF4444"
                strokeWidth={2.4}
                style={{ marginRight: 8 }}
              />
              <View style={styles.transferErrorTextContainer}>
                <Text style={styles.transferErrorTitle}>Photo Transfer Failed</Text>
                <Text
                  style={[styles.transferErrorDesc, { color: isDark ? '#FCA5A5' : '#B91C1C' }]}
                  numberOfLines={2}
                >
                  {lastTransferError} — Tap to view diagnostics
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* ── 5. STATUS CONFIRMATION BANNER ── */}
          <View style={styles.statusBannerShadowWrapper}>
            <View style={styles.statusBannerShadowUnderlay} />
            <View
              style={[
                styles.statusBannerFace,
                {
                  backgroundColor: isDark ? '#1A1A1E' : '#FFFFFF',
                  borderColor: isDark ? '#2E2E36' : '#161616',
                },
              ]}
            >
              <View style={styles.statusCheckBadge}>
                <Check size={18} color="#161616" strokeWidth={3} />
              </View>
              <View style={styles.statusTextContainer}>
                <Text style={[styles.statusTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  Camera is connected and ready
                </Text>
                <Text style={[styles.statusSubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                  You can now browse, select and upload your photos.
                </Text>
              </View>
            </View>
          </View>

          {/* ── 6. THREE-STEP FLOW SUMMARY ── */}
          <View style={styles.flowSummaryRow}>
            {/* Step 1: View Photos */}
            <View style={styles.flowStepCol}>
              <View style={styles.tileShadowContainer}>
                <View style={styles.tileHardShadow} />
                <View
                  style={[
                    styles.tileFace,
                    {
                      backgroundColor: isDark ? '#2E221D' : '#FFE5D9',
                      borderColor: isDark ? '#3E2F28' : '#161616',
                    },
                  ]}
                >
                  <Images size={22} color={isDark ? '#FFA07A' : '#161616'} strokeWidth={2.2} />
                </View>
              </View>
              <Text style={[styles.stepTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                View Photos
              </Text>
              <Text style={[styles.stepDescription, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                Browse your{'\n'}camera photos
              </Text>
            </View>

            {/* Divider 1 */}
            <View
              style={[styles.flowDivider, { backgroundColor: isDark ? '#2E2E36' : '#DFCFC2' }]}
            />

            {/* Step 2: Select & Mark */}
            <View style={styles.flowStepCol}>
              <View style={styles.tileShadowContainer}>
                <View style={styles.tileHardShadow} />
                <View
                  style={[
                    styles.tileFace,
                    {
                      backgroundColor: '#FF7D5C',
                      borderColor: isDark ? '#FF9A80' : '#161616',
                    },
                  ]}
                >
                  <CheckSquare size={22} color="#FFFFFF" strokeWidth={2.4} />
                </View>
              </View>
              <Text style={[styles.stepTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                Select & Mark
              </Text>
              <Text style={[styles.stepDescription, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                Choose the best{'\n'}moments
              </Text>
            </View>

            {/* Divider 2 */}
            <View
              style={[styles.flowDivider, { backgroundColor: isDark ? '#2E2E36' : '#DFCFC2' }]}
            />

            {/* Step 3: Upload */}
            <View style={styles.flowStepCol}>
              <View style={styles.tileShadowContainer}>
                <View style={styles.tileHardShadow} />
                <View
                  style={[
                    styles.tileFace,
                    {
                      backgroundColor: '#FCD34D',
                      borderColor: isDark ? '#FDE68A' : '#161616',
                    },
                  ]}
                >
                  <ArrowUp size={22} color="#161616" strokeWidth={2.6} />
                </View>
              </View>
              <Text style={[styles.stepTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                Upload
              </Text>
              <Text style={[styles.stepDescription, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
                Send to your{'\n'}event instantly
              </Text>
            </View>
          </View>

          {/* ── 7. PRIMARY CTA BUTTON ("View Photos") ── */}
          <Pressable
            onPress={handleViewPhotos}
            accessibilityRole="button"
            accessibilityLabel="View Photos"
            style={({ pressed }) => [
              styles.ctaButtonWrapper,
              {
                transform: [{ translateY: pressed ? 2 : 0 }, { translateX: pressed ? 2 : 0 }],
              },
            ]}
          >
            {({ pressed }) => (
              <View style={styles.ctaButtonContainer}>
                {/* Tactile Coral Shadow Underlay Layer */}
                <View
                  style={[
                    styles.ctaShadowLayer,
                    {
                      top: pressed ? 2 : 5,
                      left: 0,
                      right: 0,
                      bottom: pressed ? -2 : -5,
                    },
                  ]}
                />

                {/* Main Dark Button Face */}
                <View style={styles.ctaButtonFace}>
                  <Text style={styles.ctaButtonText}>View Photos</Text>
                  <ArrowRight
                    size={20}
                    color="#FFFFFF"
                    strokeWidth={2.4}
                    style={{ marginLeft: 8 }}
                  />
                </View>
              </View>
            )}
          </Pressable>

          {/* ── 8. SECONDARY ACTION: DISCONNECT CAMERA ── */}
          <Pressable
            onPress={handleDisconnect}
            disabled={isDisconnecting}
            accessibilityRole="button"
            accessibilityLabel="Disconnect Camera"
            style={({ pressed }) => [
              styles.disconnectBtnWrapper,
              {
                opacity: isDisconnecting ? 0.7 : 1,
                transform: [
                  { translateY: pressed && !isDisconnecting ? 2 : 0 },
                  { translateX: pressed && !isDisconnecting ? 2 : 0 },
                ],
              },
            ]}
          >
            {({ pressed }) => (
              <View style={styles.disconnectBtnContainer}>
                {/* Hard Neo-Brutalist Shadow Underlay Layer */}
                <View
                  style={[
                    styles.disconnectShadowLayer,
                    {
                      top: pressed && !isDisconnecting ? 2 : 4,
                      left: pressed && !isDisconnecting ? 2 : 4,
                      right: pressed && !isDisconnecting ? -2 : -4,
                      bottom: pressed && !isDisconnecting ? -2 : -4,
                      backgroundColor: isDark ? '#000000' : '#161616',
                    },
                  ]}
                />

                {/* Main Destructive Button Face */}
                <View
                  style={[
                    styles.disconnectBtnFace,
                    {
                      backgroundColor: isDark ? '#221919' : '#FFF5F5',
                      borderColor: isDark ? '#E5484D' : '#161616',
                    },
                  ]}
                >
                  {isDisconnecting ? (
                    <ActivityIndicator size="small" color="#E5484D" style={{ marginRight: 8 }} />
                  ) : (
                    <Power size={18} color="#E5484D" strokeWidth={2.4} style={{ marginRight: 8 }} />
                  )}
                  <Text style={styles.disconnectBtnText}>
                    {isDisconnecting ? 'Disconnecting...' : 'Disconnect Camera'}
                  </Text>
                </View>
              </View>
            )}
          </Pressable>
        </ScrollView>

        {/* ── In-App Diagnostic Console Modal ── */}
        <Modal
          visible={isDiagnosticVisible}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setIsDiagnosticVisible(false)}
        >
          <CameraDiagnosticConsole onClose={() => setIsDiagnosticVisible(false)} />
        </Modal>
      </SafeAreaView>
    </AppBackground>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 4,
  },

  // ── 1. Header Row ──
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  eventPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
  },
  eventPillTexts: {
    alignItems: 'flex-end',
  },
  eventPillTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 13,
    letterSpacing: -0.2,
  },
  eventPillDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  eventPillDateText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11,
  },
  eventAvatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: '#D6CEBF',
  },
  eventAvatarImage: {
    width: '100%',
    height: '100%',
  },

  // ── 2. Hero Headline Block ──
  heroSection: {
    marginTop: 4,
    marginBottom: 6,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroHeadline: {
    fontFamily: FONTS.syne.extraBold,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  heroSubtext: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
    lineHeight: 18.5,
    marginTop: 6,
    maxWidth: '85%',
  },
  stickerBadge: {
    alignItems: 'flex-end',
    transform: [{ rotate: '4deg' }],
    marginTop: 4,
  },
  stickerText: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 9.5,
    lineHeight: 11.5,
    letterSpacing: 0.8,
    color: '#161616',
  },
  stickerUnderline: {
    width: 46,
    height: 1.5,
    backgroundColor: '#161616',
    marginTop: 2,
  },

  // ── 3. Camera Hero Showcase ──
  cameraShowcaseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 225,
    position: 'relative',
    marginVertical: 4,
  },
  cameraGlowDisc: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: '#FFA384',
    opacity: 0.5,
    top: 15,
  },
  cameraHeroImage: {
    width: '88%',
    height: 200,
    zIndex: 1,
  },
  geoGreenTriangle: {
    position: 'absolute',
    bottom: 25,
    left: 20,
    zIndex: 2,
    transform: [{ rotate: '-15deg' }],
  },
  geoHollowCircle: {
    position: 'absolute',
    top: 100,
    left: 10,
    zIndex: 2,
  },
  geoSolidDot: {
    position: 'absolute',
    top: 110,
    right: 12,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#161616',
    zIndex: 2,
  },

  // Success Badge (Mint circular checkmark)
  successBadgeWrapper: {
    position: 'absolute',
    top: 28,
    left: 14,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dashBurstContainer: {
    marginRight: -4,
  },
  badgeShadowContainer: {
    position: 'relative',
    width: 48,
    height: 48,
  },
  badgeHardShadow: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: -3,
    bottom: -3,
    borderRadius: 24,
    backgroundColor: '#161616',
  },
  successBadgeFace: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#52E5A8',
    borderWidth: 2,
    borderColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Overlapping Sticky Note Tag
  stickyNoteWrapper: {
    position: 'absolute',
    top: 18,
    right: 16,
    zIndex: 3,
    transform: [{ rotate: '6deg' }],
  },
  stickyNoteShadow: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: -3,
    bottom: -3,
    borderRadius: 12,
    backgroundColor: '#161616',
  },
  stickyNoteFace: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 110,
  },
  stickyNoteTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 12,
    lineHeight: 15,
  },
  stickyNoteHeartRow: {
    alignItems: 'flex-end',
    marginTop: 4,
  },

  // ── 4. Camera Details Card ──
  cardShadowWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 10,
  },
  cardHardShadowUnderlay: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: -3,
    bottom: -3,
    borderRadius: 22,
    backgroundColor: '#161616',
  },
  cameraDetailsCardFace: {
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cameraDetailsLeft: {
    flex: 1,
    gap: 3,
  },
  cameraModelTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 18,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  metaText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
  },
  settingsBtnWrapper: {
    marginLeft: 8,
  },
  settingsBtnFace: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  settingsBtnText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 12,
  },

  // ── 5. Status Confirmation Banner ──
  statusBannerShadowWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 14,
  },
  statusBannerShadowUnderlay: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: -3,
    bottom: -3,
    borderRadius: 20,
    backgroundColor: '#161616',
  },
  statusBannerFace: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusCheckBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#D2F4E2',
    borderWidth: 1.5,
    borderColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14.5,
    letterSpacing: -0.2,
  },
  statusSubtitle: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  // ── 6. Three-Step Flow Summary ──
  flowSummaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  flowStepCol: {
    flex: 1,
    alignItems: 'center',
  },
  flowDivider: {
    width: 1,
    height: 48,
    marginTop: 8,
  },
  tileShadowContainer: {
    position: 'relative',
    width: 52,
    height: 52,
    marginBottom: 8,
  },
  tileHardShadow: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: -3,
    bottom: -3,
    borderRadius: 16,
    backgroundColor: '#161616',
  },
  tileFace: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 13,
    textAlign: 'center',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  stepDescription: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },

  // ── 7. Primary CTA Button ──
  ctaButtonWrapper: {
    width: '100%',
    marginBottom: 8,
  },
  ctaButtonContainer: {
    position: 'relative',
    width: '100%',
  },
  ctaShadowLayer: {
    position: 'absolute',
    backgroundColor: '#FF6F4E',
    borderRadius: 28,
  },
  ctaButtonFace: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#181818',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontFamily: FONTS.syne.bold,
    fontSize: 16.5,
    letterSpacing: 0.3,
  },

  // ── 8. Disconnect Button ──
  disconnectBtnWrapper: {
    width: '100%',
    marginTop: 6,
    marginBottom: 8,
  },
  disconnectBtnContainer: {
    position: 'relative',
    width: '100%',
  },
  disconnectShadowLayer: {
    position: 'absolute',
    borderRadius: 28,
  },
  disconnectBtnFace: {
    height: 52,
    borderRadius: 28,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectBtnText: {
    color: '#E5484D',
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    letterSpacing: 0.2,
  },

  // ── Diagnostics & Error Banner ──
  actionColumn: {
    marginLeft: 8,
    gap: 6,
    alignItems: 'flex-end',
  },
  diagBtnWrapper: {},
  diagBtnFace: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  diagBtnText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 12,
  },

  transferErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 12,
  },
  transferErrorTextContainer: {
    flex: 1,
    gap: 2,
  },
  transferErrorTitle: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13,
    color: '#EF4444',
  },
  transferErrorDesc: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11,
    lineHeight: 15,
  },
});
