import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Animated,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polygon } from 'react-native-svg';
import {
  ArrowLeft,
  Calendar,
  ArrowRight,
  Check,
  HelpCircle,
  X,
  Wifi,
  Usb,
  Camera,
} from 'lucide-react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AppNavigationProp, AppStackParamList } from '@/navigation/types';
import { Text } from '@/components/Text';
import { useTheme } from '@/constants/theme';
import { FONTS } from '@/constants/typography';
import { formatEventDate } from '@/utils/date';
import { AppBackground } from '@/components/AppBackground';

// ── Image Assets ────────────────────────────────────────────────────────────
const CAMERA_HERO_IMAGE = require('../../../assets/ctAYourCamera/28328fe7-79dc-438d-8f78-16cd13c144cf.png');
const WIFI_3D_ICON = require('../../../assets/ctAYourCamera/511408e8-83d9-49f8-a1d5-e769833c09f3.png');
const USBC_3D_ICON = require('../../../assets/ctAYourCamera/a40bb110-a40e-4376-8664-d5434b687765.png');
const DEFAULT_AVATAR = require('../../../assets/image.png');

// ── 4-Point Neo-Brutalist Sparkle Star Component ───────────────────────────
const SparkleStarSvg: React.FC<{ size?: number; color?: string; opacity?: number }> = ({
  size = 20,
  color = '#F5C242',
  opacity = 0.8,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 0L14.8 9.2L24 12L14.8 14.8L12 24L9.2 14.8L0 12L9.2 9.2L12 0Z"
      fill={color}
      opacity={opacity}
    />
  </Svg>
);

export const CameraConnectScreen: React.FC = () => {
  const navigation = useNavigation<AppNavigationProp>();
  const route = useRoute<RouteProp<AppStackParamList, 'CameraConnect'>>();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Route Params (Fallback to default mock event if not passed)
  const eventTitle = route.params?.eventTitle || 'Rahul & Fathima';
  const eventDateFormatted = route.params?.eventDate
    ? formatEventDate(route.params.eventDate)
    : '05 Sep 2026';
  const coverImage = route.params?.coverImage;

  // Selected Connection Mode: 'wifi' | 'usbc' (Default: 'usbc')
  const [connectionMode, setConnectionMode] = useState<'wifi' | 'usbc'>('usbc');
  const [isSearching, setIsSearching] = useState(false);
  const [isHelpModalVisible, setIsHelpModalVisible] = useState(false);
  const [isWifiUnavailableModalVisible, setIsWifiUnavailableModalVisible] = useState(false);

  // Animated Search Pulse
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Functional Back Navigation Handler
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('SelectEvent');
    }
  }, [navigation]);

  const handleSelectWifi = useCallback(() => {
    setIsWifiUnavailableModalVisible(true);
  }, []);

  const handleSearchCamera = useCallback(() => {
    setIsSearching(true);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.03,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    setTimeout(() => {
      setIsSearching(false);
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      navigation.navigate('CameraConnected', {
        eventId: route.params?.eventId,
        eventTitle,
        eventDate: route.params?.eventDate,
        eventCategory: route.params?.eventCategory,
        coverImage,
        cameraModel: 'Sony A7 IV',
        connectionType: connectionMode,
        photoCount: 326,
      });
    }, 1800);
  }, [
    navigation,
    pulseAnim,
    route.params?.eventId,
    route.params?.eventDate,
    route.params?.eventCategory,
    eventTitle,
    coverImage,
    connectionMode,
  ]);

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 20) + 12 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. HEADER ROW ── */}
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

            {/* Brand Wordmark (matching SelectEventScreen) */}
            <View style={styles.brandContainer}>
              <Text style={[styles.brandText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                EntePhoto<Text style={{ color: '#FF6B4A' }}>.</Text>
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

          {/* ── 2. HERO HEADLINE & STICKER ── */}
          <View style={styles.heroSection}>
            <View style={styles.heroTitleRow}>
              <Text style={[styles.heroHeadline, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                Connect{'\n'}your camera<Text style={{ color: '#FF6B4A' }}>.</Text>
              </Text>

              {/* Angled Mono Sticker Badge */}
              <View style={styles.stickerBadge}>
                <Text style={styles.stickerText}>SAME</Text>
                <Text style={styles.stickerText}>MOMENTS</Text>
                <Text style={styles.stickerText}>BIGGER</Text>
                <Text style={styles.stickerText}>STORIES</Text>
                <View style={styles.stickerUnderline} />
              </View>
            </View>

            <Text style={[styles.heroSubtext, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
              Connect your camera and we&apos;ll find your latest photos.
            </Text>
          </View>

          {/* ── 3. CAMERA HERO 3D CARD ── */}
          <View style={styles.cameraHeroContainer}>
            {/* Background Circular Coral Glow behind camera */}
            <View style={styles.cameraGlowDisc} />

            {/* Decorative Geometric Neo-Brutalist Shapes */}
            <View pointerEvents="none" style={styles.geoPinkTriangle}>
              <Svg width={28} height={28} viewBox="0 0 32 32">
                <Polygon
                  points="16,2 30,28 2,28"
                  fill="#FF85A2"
                  stroke="#161616"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>

            <View pointerEvents="none" style={styles.geoYellowStar}>
              <SparkleStarSvg size={24} color="#F5C242" opacity={0.9} />
            </View>

            {/* Main 3D Camera Hero Asset */}
            <Image
              source={CAMERA_HERO_IMAGE}
              style={styles.cameraHeroImage}
              resizeMode="contain"
              accessibilityLabel="3D Camera with wedding instant photo print"
            />
          </View>

          {/* ── 4. CONNECTION MODE SELECTOR (WI-FI vs USB-C) ── */}
          <View style={styles.modeSelectorRow}>
            {/* Wi-Fi Card (Shows "Coming Soon" popup on press) */}
            <Pressable
              onPress={handleSelectWifi}
              style={styles.modeCardWrapper}
              accessibilityRole="button"
              accessibilityLabel="Wi-Fi Connection Mode. Available soon"
            >
              {({ pressed }) => (
                <View style={styles.cardShadowContainer}>
                  {/* Neo-brutalist tactile hard shadow underlay */}
                  <View
                    style={[
                      styles.cardHardShadow,
                      {
                        top: pressed ? 1 : 3,
                        left: pressed ? 1 : 3,
                        right: pressed ? -1 : -3,
                        bottom: pressed ? -1 : -3,
                      },
                    ]}
                  />

                  {/* Card Face */}
                  <View
                    style={[
                      styles.modeCardFace,
                      {
                        backgroundColor: isDark ? '#1A1A1E' : 'rgba(255, 253, 251, 0.9)',
                        borderColor: isDark ? '#2E2E36' : '#161616',
                        transform: [
                          { translateY: pressed ? 2 : 0 },
                          { translateX: pressed ? 2 : 0 },
                        ],
                      },
                    ]}
                  >
                    {/* Top Row: 3D Wi-Fi Logo slot + "SOON" Pill Badge */}
                    <View style={styles.modeCardTopRow}>
                      <View style={styles.modeIconSlot}>
                        <Image
                          source={WIFI_3D_ICON}
                          style={styles.mode3DIconWifi}
                          resizeMode="contain"
                        />
                      </View>

                      <View
                        style={[
                          styles.soonPillBadge,
                          {
                            backgroundColor: isDark ? '#2E201B' : '#FFEAE3',
                            borderColor: '#FF6B4A',
                          },
                        ]}
                      >
                        <Text style={styles.soonPillText}>SOON</Text>
                      </View>
                    </View>

                    {/* Text Content */}
                    <View style={styles.modeTextContent}>
                      <Text
                        style={[
                          styles.modeTitle,
                          {
                            color: isDark ? '#F4F4F5' : '#161616',
                          },
                        ]}
                      >
                        Wi-Fi
                      </Text>

                      <Text
                        style={[
                          styles.modeSubtitle,
                          {
                            color: isDark ? '#A1A1AA' : '#7A7571',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        Connect wirelessly
                      </Text>

                      <Text
                        style={[
                          styles.modeTag,
                          {
                            color: isDark ? '#FF8C73' : '#FF6B4A',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        Available soon
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </Pressable>

            {/* USB-C Card (Default Selected) */}
            <Pressable
              onPress={() => setConnectionMode('usbc')}
              style={styles.modeCardWrapper}
              accessibilityRole="radio"
              accessibilityState={{ checked: connectionMode === 'usbc' }}
              accessibilityLabel="USB-C Connection Mode. Connect directly. Stable & reliable"
            >
              {({ pressed }) => (
                <View style={styles.cardShadowContainer}>
                  {/* Neo-brutalist tactile hard shadow underlay */}
                  <View
                    style={[
                      styles.cardHardShadow,
                      {
                        top: pressed ? 1 : 3,
                        left: pressed ? 1 : 3,
                        right: pressed ? -1 : -3,
                        bottom: pressed ? -1 : -3,
                      },
                    ]}
                  />

                  {/* Card Face */}
                  <View
                    style={[
                      styles.modeCardFace,
                      {
                        backgroundColor:
                          connectionMode === 'usbc'
                            ? isDark
                              ? '#FF6B4A'
                              : '#FF7D5C'
                            : isDark
                              ? '#1A1A1E'
                              : 'rgba(255, 253, 251, 0.9)',
                        borderColor: isDark ? '#2E2E36' : '#161616',
                        transform: [
                          { translateY: pressed ? 2 : 0 },
                          { translateX: pressed ? 2 : 0 },
                        ],
                      },
                    ]}
                  >
                    {/* Top Row: 3D USB-C Cable slot + Check/Radio Indicator */}
                    <View style={styles.modeCardTopRow}>
                      <View style={styles.modeIconSlot}>
                        <Image
                          source={USBC_3D_ICON}
                          style={styles.mode3DIconUsbc}
                          resizeMode="contain"
                        />
                      </View>

                      {connectionMode === 'usbc' ? (
                        <View style={styles.modeSelectedBadge}>
                          <Check size={13} color="#FFFFFF" strokeWidth={3} />
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.modeUnselectedCircle,
                            { borderColor: isDark ? '#71717A' : '#161616' },
                          ]}
                        />
                      )}
                    </View>

                    {/* Text Content */}
                    <View style={styles.modeTextContent}>
                      <Text
                        style={[
                          styles.modeTitle,
                          {
                            color:
                              connectionMode === 'usbc'
                                ? '#161616'
                                : isDark
                                  ? '#F4F4F5'
                                  : '#161616',
                          },
                        ]}
                      >
                        USB-C
                      </Text>

                      <Text
                        style={[
                          styles.modeSubtitle,
                          {
                            color:
                              connectionMode === 'usbc'
                                ? '#161616'
                                : isDark
                                  ? '#A1A1AA'
                                  : '#7A7571',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        Connect directly
                      </Text>

                      <Text
                        style={[
                          styles.modeTag,
                          {
                            color:
                              connectionMode === 'usbc'
                                ? '#4A1D13'
                                : isDark
                                  ? '#71717A'
                                  : '#8B847D',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        Stable & reliable
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </Pressable>
          </View>

          {/* ── 5. READINESS CHECKLIST CARD ── */}
          <View
            style={[
              styles.checklistCard,
              {
                backgroundColor: isDark ? '#201918' : '#FFE6DC',
                borderColor: isDark ? '#2E2E36' : '#161616',
              },
            ]}
          >
            {/* Top Row: Info Icon + Headline + Tagline */}
            <View style={styles.checklistHeaderRow}>
              <View style={styles.checkHeaderLeft}>
                <View style={styles.infoBadgeCircle}>
                  <Text style={styles.infoBadgeText}>i</Text>
                </View>
                <Text style={[styles.checklistTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  Make sure your camera is ready
                </Text>
              </View>

              {/* Right Vertical Tagline */}
              <View style={styles.checklistSticker}>
                <Text style={styles.checklistStickerText}>GOOD</Text>
                <Text style={styles.checklistStickerText}>PHOTOS</Text>
                <Text style={styles.checklistStickerText}>HAPPEN</Text>
                <Text style={styles.checklistStickerText}>TOGETHER</Text>
                <View style={styles.checklistStickerUnderline} />
              </View>
            </View>

            {/* Checklist Items */}
            <View style={styles.checklistItemsList}>
              <View style={styles.checklistItem}>
                <View style={styles.checkBullet}>
                  <Check size={11} color="#FFFFFF" strokeWidth={3} />
                </View>
                <Text style={[styles.checkItemText, { color: isDark ? '#D4D4D8' : '#161616' }]}>
                  Turn on your camera
                </Text>
              </View>

              <View style={styles.checklistItem}>
                <View style={styles.checkBullet}>
                  <Check size={11} color="#FFFFFF" strokeWidth={3} />
                </View>
                <Text style={[styles.checkItemText, { color: isDark ? '#D4D4D8' : '#161616' }]}>
                  Enable Wi-Fi (or connect via USB-C)
                </Text>
              </View>

              <View style={styles.checklistItem}>
                <View style={styles.checkBullet}>
                  <Check size={11} color="#FFFFFF" strokeWidth={3} />
                </View>
                <Text style={[styles.checkItemText, { color: isDark ? '#D4D4D8' : '#161616' }]}>
                  Keep your camera nearby
                </Text>
              </View>
            </View>
          </View>

          {/* ── 6. PRIMARY CTA BUTTON ("Search for Camera") ── */}
          <Pressable
            onPress={handleSearchCamera}
            disabled={isSearching}
            accessibilityRole="button"
            accessibilityLabel="Search for Camera"
            style={({ pressed }) => [
              styles.ctaButtonWrapper,
              {
                transform: [
                  {
                    translateY: pressed && !isSearching ? 2 : 0,
                  },
                ],
              },
            ]}
          >
            {({ pressed }) => (
              <View style={styles.ctaButtonContainer}>
                {/* Tactile Coral Shadow Layer Underneath (matching SelectEventScreen Continue button) */}
                <View
                  style={[
                    styles.ctaSearhShadowLayer,
                    {
                      top: pressed && !isSearching ? 2 : 6,
                      left: 0,
                      right: 0,
                      bottom: pressed && !isSearching ? -2 : -6,
                    },
                  ]}
                />

                {/* Main Black Button Face */}
                <Animated.View
                  style={[
                    styles.ctaButtonFace,
                    {
                      transform: [{ scale: pulseAnim }],
                    },
                  ]}
                >
                  {isSearching ? (
                    <View style={styles.searchingRow}>
                      <ActivityIndicator size="small" color="#FF6B4A" />
                      <Text style={styles.ctaButtonText}>Searching for Camera...</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.ctaButtonText}>Search for Camera</Text>
                      <ArrowRight
                        size={20}
                        color="#FFFFFF"
                        strokeWidth={2.3}
                        style={{ marginLeft: 6 }}
                      />
                    </>
                  )}
                </Animated.View>
              </View>
            )}
          </Pressable>

          {/* ── 7. FOOTER HELP LINK ── */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => setIsHelpModalVisible(true)}
            style={styles.helpLinkContainer}
            accessibilityRole="button"
            accessibilityLabel="Need help connecting?"
          >
            <HelpCircle
              size={15}
              color={isDark ? '#A1A1AA' : '#7A7571'}
              strokeWidth={2}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.helpLinkText, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
              Need help connecting?
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>

      {/* ── HELP BOTTOM SHEET MODAL ── */}
      <Modal
        visible={isHelpModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsHelpModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropTouch}
            onPress={() => setIsHelpModalVisible(false)}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFFDF9',
                borderColor: isDark ? '#2E2E36' : '#E8DFD4',
              },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHandle} />
              <TouchableOpacity
                onPress={() => setIsHelpModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? '#26262E' : '#F1E9DF' }]}
              >
                <X size={18} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>

            <View style={styles.helpModalIconCircle}>
              <Camera size={26} color="#FF6B4A" strokeWidth={2} />
            </View>

            <Text style={[styles.helpModalTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
              Camera Connection Guide
            </Text>

            <Text style={[styles.helpModalSubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
              Follow these simple steps for your camera model:
            </Text>

            {/* Guide Rows */}
            <View
              style={[
                styles.helpGuideBox,
                {
                  backgroundColor: isDark ? '#141416' : '#F5EFE6',
                  borderColor: isDark ? '#2E2E36' : '#E8DFD4',
                },
              ]}
            >
              <View style={styles.helpGuideRow}>
                <Wifi size={18} color="#FF6B4A" strokeWidth={2.2} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.helpGuideRowTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                  >
                    Wi-Fi Connection
                  </Text>
                  <Text
                    style={[styles.helpGuideRowDesc, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                  >
                    Turn on camera Wi-Fi / Smartphone Transfer in your camera&apos;s Network
                    settings menu.
                  </Text>
                </View>
              </View>

              <View
                style={[styles.helpDivider, { backgroundColor: isDark ? '#2E2E36' : '#E8DFD4' }]}
              />

              <View style={styles.helpGuideRow}>
                <Usb size={18} color="#45DFA4" strokeWidth={2.2} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.helpGuideRowTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}
                  >
                    USB-C Direct Cable
                  </Text>
                  <Text
                    style={[styles.helpGuideRowDesc, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                  >
                    Connect via OTG cable. Ensure USB Connection mode is set to &apos;MTP&apos; or
                    &apos;Mass Storage / PTP&apos;.
                  </Text>
                </View>
              </View>
            </View>

            {/* Help Modal Bottom Button */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsHelpModalVisible(false)}
              style={styles.helpModalCloseBtnLarge}
            >
              <Text style={styles.helpModalCloseBtnText}>Got It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── WI-FI COMING SOON POPUP MODAL ── */}
      <Modal
        visible={isWifiUnavailableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsWifiUnavailableModalVisible(false)}
      >
        <View style={styles.popupModalBackdrop}>
          <Pressable
            style={styles.modalBackdropTouch}
            onPress={() => setIsWifiUnavailableModalVisible(false)}
          />
          <View
            style={[
              styles.popupDialogCard,
              {
                backgroundColor: isDark ? '#1A1A1E' : '#FFFDF9',
                borderColor: isDark ? '#2E2E36' : '#161616',
              },
            ]}
          >
            {/* Top Close Button */}
            <TouchableOpacity
              onPress={() => setIsWifiUnavailableModalVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[styles.popupCloseBtn, { backgroundColor: isDark ? '#26262E' : '#F1E9DF' }]}
              accessibilityRole="button"
              accessibilityLabel="Close popup"
            >
              <X size={16} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.4} />
            </TouchableOpacity>

            {/* Glowing Icon Badge */}
            <View style={styles.popupIconBadge}>
              <Wifi size={28} color="#FF6B4A" strokeWidth={2.4} />
            </View>

            {/* Title */}
            <Text style={[styles.popupTitle, { color: isDark ? '#F4F4F5' : '#161616' }]}>
              Wi-Fi Transfer Coming Soon
            </Text>

            {/* Subtitle / Description */}
            <Text style={[styles.popupDescription, { color: isDark ? '#A1A1AA' : '#7A7571' }]}>
              This feature is not available right now. Wireless camera transfer is currently under
              development and will be available in an upcoming update.
            </Text>

            {/* Recommendation Callout */}
            <View
              style={[
                styles.popupCallout,
                {
                  backgroundColor: isDark ? '#201918' : '#FFE6DC',
                  borderColor: isDark ? '#3E2420' : '#FF6B4A',
                },
              ]}
            >
              <Usb
                size={16}
                color="#FF6B4A"
                strokeWidth={2.2}
                style={{ marginRight: 8, marginTop: 1 }}
              />
              <Text style={[styles.popupCalloutText, { color: isDark ? '#FFA384' : '#C43D1D' }]}>
                Please use{' '}
                <Text style={{ fontFamily: FONTS.plusJakartaSans.bold }}>USB-C cable</Text> for fast
                and reliable connection today.
              </Text>
            </View>

            {/* Action Button ("Got It") */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsWifiUnavailableModalVisible(false)}
              style={styles.popupActionBtn}
            >
              <Text style={styles.popupActionBtnText}>Got It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 24,
    paddingTop: 6,
  },

  // ── Ambient Background Radial Blobs ──
  blobTopLeft: {
    position: 'absolute',
    top: -55,
    left: -70,
    width: 220,
    height: 220,
    zIndex: 0,
  },
  blobMidLeft: {
    position: 'absolute',
    top: '28%',
    left: -60,
    width: 160,
    height: 160,
    zIndex: 0,
  },
  blobBottomRight: {
    position: 'absolute',
    bottom: -70,
    right: -60,
    width: 260,
    height: 260,
    zIndex: 0,
  },

  // ── 1. Header Row (Matching SelectEventScreen) ──
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 8,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
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
    marginBottom: 8,
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
    lineHeight: 19,
    marginTop: 8,
    maxWidth: '85%',
  },
  stickerBadge: {
    alignItems: 'flex-end',
    transform: [{ rotate: '5deg' }],
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
    width: 44,
    height: 1.5,
    backgroundColor: '#161616',
    marginTop: 2,
  },

  // ── 3. Camera Hero 3D Card ──
  cameraHeroContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 220,
    position: 'relative',
    marginVertical: 6,
  },
  cameraGlowDisc: {
    position: 'absolute',
    width: 175,
    height: 175,
    borderRadius: 87.5,
    backgroundColor: '#FFA384',
    opacity: 0.45,
    top: 20,
    right: 35,
  },
  cameraHeroImage: {
    width: '100%',
    height: 215,
  },
  geoPinkTriangle: {
    position: 'absolute',
    top: 22,
    right: 68,
    zIndex: 2,
    transform: [{ rotate: '15deg' }],
  },
  geoYellowStar: {
    position: 'absolute',
    top: 50,
    right: 28,
    zIndex: 2,
  },

  // ── 4. Connection Mode Selector (Two Cards Grid) ──
  modeSelectorRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    marginBottom: 14,
    alignItems: 'stretch',
  },
  modeCardWrapper: {
    flex: 1,
  },
  cardShadowContainer: {
    position: 'relative',
    width: '100%',
    height: 142,
  },
  cardHardShadow: {
    position: 'absolute',
    backgroundColor: '#161616',
    borderRadius: 18,
    zIndex: 0,
  },
  modeCardFace: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    justifyContent: 'space-between',
    zIndex: 1,
  },
  modeCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
  },
  modeIconSlot: {
    width: 52,
    height: 38,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  mode3DIconWifi: {
    width: 44,
    height: 36,
  },
  mode3DIconUsbc: {
    width: 48,
    height: 36,
  },
  modeSelectedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeUnselectedCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  modeTextContent: {
    justifyContent: 'flex-end',
  },
  modeTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 17,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  modeSubtitle: {
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontSize: 13,
    lineHeight: 17,
    marginBottom: 2,
  },
  modeTag: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 11,
  },

  // ── 5. Readiness Checklist Card ──
  checklistCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#161616',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 0,
    elevation: 3,
  },
  checklistHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  checkHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  infoBadgeCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBadgeText: {
    color: '#FFFFFF',
    fontFamily: FONTS.syne.bold,
    fontSize: 13,
  },
  checklistTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    letterSpacing: -0.2,
    flex: 1,
  },
  checklistSticker: {
    alignItems: 'flex-end',
    transform: [{ rotate: '4deg' }],
    marginLeft: 6,
  },
  checklistStickerText: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 8.5,
    lineHeight: 10.5,
    letterSpacing: 0.6,
    color: '#161616',
  },
  checklistStickerUnderline: {
    width: 36,
    height: 1.2,
    backgroundColor: '#161616',
    marginTop: 2,
  },
  checklistItemsList: {
    gap: 8,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkBullet: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkItemText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13.5,
    lineHeight: 18,
  },

  // ── 6. Primary CTA Button ──
  ctaButtonWrapper: {
    width: '100%',
    marginBottom: 12,
  },
  ctaButtonContainer: {
    position: 'relative',
    width: '100%',
  },
  ctaSearhShadowLayer: {
    position: 'absolute',
    backgroundColor: '#FF6F4E',
    borderRadius: 28,
    zIndex: 0,
  },
  ctaButtonFace: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#181818',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 16,
    letterSpacing: 0.3,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ── 7. Footer Help Link ──
  helpLinkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  helpLinkText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
  },

  // ── Help Modal Sheet ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    flex: 1,
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalHandle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(128, 128, 128, 0.4)',
    alignSelf: 'center',
    marginLeft: 32,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpModalIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255, 107, 74, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  helpModalTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  helpModalSubtitle: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
  },
  helpGuideBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  helpGuideRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  helpGuideRowTitle: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 14,
    marginBottom: 2,
  },
  helpGuideRowDesc: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  helpDivider: {
    height: 1,
  },
  helpModalCloseBtnLarge: {
    height: 50,
    borderRadius: 25,
    backgroundColor: '#181818',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpModalCloseBtnText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
  },

  // ── "SOON" Pill Badge ──
  soonPillBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soonPillText: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 10,
    color: '#FF6B4A',
    letterSpacing: 0.5,
  },

  // ── Wi-Fi Unavailable Popup Modal Dialog ──
  popupModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  popupDialogCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 2,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
    position: 'relative',
  },
  popupCloseBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  popupIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 107, 74, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  popupTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  popupDescription: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  popupCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    width: '100%',
  },
  popupCalloutText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12.5,
    lineHeight: 17,
    flex: 1,
  },
  popupActionBtn: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    backgroundColor: '#181818',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B4A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  popupActionBtnText: {
    color: '#FFFFFF',
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
