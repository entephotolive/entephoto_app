import React, { useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Sun,
  Camera,
  Activity,
  User,
  Users,
} from 'lucide-react-native';
import { Text } from '@/components/Text';
import { FONTS } from '@/constants/typography';
import { BLUR_THRESHOLD, EXPOSURE_THRESHOLD } from '@/services/photoQualityService';
import { GalleryPhotoItem } from '../PhotoSelectionGalleryScreen';

interface PhotoQualityModalProps {
  visible: boolean;
  photo: GalleryPhotoItem | null;
  onClose: () => void;
  isDark: boolean;
}

export const PhotoQualityModal: React.FC<PhotoQualityModalProps> = ({
  visible,
  photo,
  onClose,
  isDark,
}) => {
  const insets = useSafeAreaInsets();
  const slideAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(0);
      Animated.spring(slideAnim, {
        toValue: 1,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  if (!visible || !photo) {
    return null;
  }

  const result = photo.qualityResult;
  const isAnalyzing = photo.isAnalyzingQuality;

  const hasBlur = result?.blur ?? false;
  const hasOverExposure = result?.overExposure ?? false;
  const hasClosedEyes = result?.face && !(result?.eyesOpen ?? true);
  const needsReview = hasBlur || hasOverExposure || hasClosedEyes;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: isDark ? '#18181B' : '#FAF7F2',
              borderColor: isDark ? '#2E2E36' : '#161616',
              paddingBottom: Math.max(insets.bottom, 16) + 12,
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Header Bar */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.headerIconCircle,
                  {
                    backgroundColor: needsReview ? '#FEF3C7' : '#D1FAE5',
                    borderColor: needsReview ? '#D97706' : '#059669',
                  },
                ]}
              >
                {needsReview ? (
                  <AlertTriangle size={20} color="#B45309" strokeWidth={2.4} />
                ) : (
                  <CheckCircle2 size={20} color="#047857" strokeWidth={2.4} />
                )}
              </View>

              <View>
                <Text style={[styles.sheetTitle, { color: isDark ? '#FFFFFF' : '#161616' }]}>
                  {needsReview ? 'Quality Review' : 'Quality Passed'}
                </Text>
                <Text
                  style={[styles.sheetSubtitle, { color: isDark ? '#A1A1AA' : '#7A7571' }]}
                  numberOfLines={1}
                >
                  {photo.filename || 'Photo Quality Analysis'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              hitSlop={10}
              style={[
                styles.closeButton,
                {
                  backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                  borderColor: isDark ? '#3F3F46' : '#161616',
                },
              ]}
            >
              <X size={18} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.cardsScroll} showsVerticalScrollIndicator={false}>
            {isAnalyzing ? (
              <View style={styles.analyzingBox}>
                <Activity size={24} color="#FF5E3A" />
                <Text style={[styles.analyzingText, { color: isDark ? '#F4F4F5' : '#161616' }]}>
                  Running parallel 4-check quality analysis...
                </Text>
              </View>
            ) : !result ? (
              <View style={styles.analyzingBox}>
                <Camera size={24} color="#71717A" />
                <Text style={[styles.analyzingText, { color: isDark ? '#A1A1AA' : '#71717A' }]}>
                  Quality analysis pending for this photo.
                </Text>
              </View>
            ) : (
              <View style={styles.checksGrid}>
                {/* 1. Sharpness / Blur Check */}
                <View
                  style={[
                    styles.checkCard,
                    {
                      backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                      borderColor: hasBlur ? '#EF4444' : isDark ? '#3F3F46' : '#161616',
                    },
                  ]}
                >
                  <View style={styles.checkCardHeader}>
                    <View
                      style={[
                        styles.checkBadge,
                        {
                          backgroundColor: hasBlur ? '#FEE2E2' : '#ECFDF5',
                          borderColor: hasBlur ? '#DC2626' : '#10B981',
                        },
                      ]}
                    >
                      <Activity
                        size={14}
                        color={hasBlur ? '#DC2626' : '#059669'}
                        strokeWidth={2.5}
                      />
                      <Text
                        style={[styles.checkBadgeText, { color: hasBlur ? '#DC2626' : '#059669' }]}
                      >
                        {hasBlur ? 'Blurry' : 'Sharp'}
                      </Text>
                    </View>
                    <Text style={[styles.scoreValue, { color: isDark ? '#E4E4E7' : '#27272A' }]}>
                      Score: {result.sharpnessScore?.toFixed(1) ?? 'N/A'} (min {BLUR_THRESHOLD})
                    </Text>
                  </View>
                  <Text
                    style={[styles.checkDescription, { color: isDark ? '#A1A1AA' : '#52525B' }]}
                  >
                    {hasBlur
                      ? 'Laplacian variance is below threshold. Noticeable motion or focus blur detected.'
                      : 'High edge contrast and sharp Laplacian variance.'}
                  </Text>
                </View>

                {/* 2. Exposure / Highlight Check */}
                <View
                  style={[
                    styles.checkCard,
                    {
                      backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                      borderColor: hasOverExposure ? '#EF4444' : isDark ? '#3F3F46' : '#161616',
                    },
                  ]}
                >
                  <View style={styles.checkCardHeader}>
                    <View
                      style={[
                        styles.checkBadge,
                        {
                          backgroundColor: hasOverExposure ? '#FEE2E2' : '#ECFDF5',
                          borderColor: hasOverExposure ? '#DC2626' : '#10B981',
                        },
                      ]}
                    >
                      <Sun
                        size={14}
                        color={hasOverExposure ? '#DC2626' : '#059669'}
                        strokeWidth={2.5}
                      />
                      <Text
                        style={[
                          styles.checkBadgeText,
                          { color: hasOverExposure ? '#DC2626' : '#059669' },
                        ]}
                      >
                        {hasOverExposure ? 'Overexposed' : 'Balanced'}
                      </Text>
                    </View>
                    <Text style={[styles.scoreValue, { color: isDark ? '#E4E4E7' : '#27272A' }]}>
                      Clipped: {result.exposureScore?.toFixed(1) ?? '0'}% (max {EXPOSURE_THRESHOLD}
                      %)
                    </Text>
                  </View>
                  <Text
                    style={[styles.checkDescription, { color: isDark ? '#A1A1AA' : '#52525B' }]}
                  >
                    {hasOverExposure
                      ? 'Significant highlight clipping detected in over 12% of the image.'
                      : 'Perceptual luminance and highlights are within normal dynamic range.'}
                  </Text>
                </View>

                {/* 3. Face Detection */}
                <View
                  style={[
                    styles.checkCard,
                    {
                      backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                      borderColor: isDark ? '#3F3F46' : '#161616',
                    },
                  ]}
                >
                  <View style={styles.checkCardHeader}>
                    <View
                      style={[
                        styles.checkBadge,
                        {
                          backgroundColor: isDark ? '#3F3F46' : '#F4F4F5',
                          borderColor: isDark ? '#52525B' : '#71717A',
                        },
                      ]}
                    >
                      {result.faceCount && result.faceCount > 1 ? (
                        <Users size={14} color={isDark ? '#E4E4E7' : '#161616'} strokeWidth={2.5} />
                      ) : (
                        <User size={14} color={isDark ? '#E4E4E7' : '#161616'} strokeWidth={2.5} />
                      )}
                      <Text
                        style={[styles.checkBadgeText, { color: isDark ? '#E4E4E7' : '#161616' }]}
                      >
                        {result.face ? `${result.faceCount} Face(s)` : 'No Faces'}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.checkDescription, { color: isDark ? '#A1A1AA' : '#52525B' }]}
                  >
                    {result.face
                      ? `Detected ${result.faceCount} subject face(s) via ML Kit.`
                      : 'Landscape, decor, or object shot (no human faces found).'}
                  </Text>
                </View>

                {/* 4. Eyes Open Check (if faces detected) */}
                {result.face && (
                  <View
                    style={[
                      styles.checkCard,
                      {
                        backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                        borderColor: hasClosedEyes ? '#F59E0B' : isDark ? '#3F3F46' : '#161616',
                      },
                    ]}
                  >
                    <View style={styles.checkCardHeader}>
                      <View
                        style={[
                          styles.checkBadge,
                          {
                            backgroundColor: hasClosedEyes ? '#FEF3C7' : '#ECFDF5',
                            borderColor: hasClosedEyes ? '#D97706' : '#10B981',
                          },
                        ]}
                      >
                        {hasClosedEyes ? (
                          <EyeOff size={14} color="#D97706" strokeWidth={2.5} />
                        ) : (
                          <Eye size={14} color="#059669" strokeWidth={2.5} />
                        )}
                        <Text
                          style={[
                            styles.checkBadgeText,
                            { color: hasClosedEyes ? '#D97706' : '#059669' },
                          ]}
                        >
                          {hasClosedEyes ? 'Closed Eyes' : 'Eyes Open'}
                        </Text>
                      </View>
                      <Text style={[styles.scoreValue, { color: isDark ? '#E4E4E7' : '#27272A' }]}>
                        {result.closedEyeCount ?? 0} of {result.faceCount ?? 0} closed
                      </Text>
                    </View>
                    <Text
                      style={[styles.checkDescription, { color: isDark ? '#A1A1AA' : '#52525B' }]}
                    >
                      {hasClosedEyes
                        ? `${result.closedEyeCount} person(s) appear to have closed eyes (< 50% open probability).`
                        : 'All detected subjects have their eyes open.'}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Bottom Action */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={onClose}
            style={[
              styles.dismissButton,
              {
                backgroundColor: isDark ? '#27272A' : '#161616',
                borderColor: '#161616',
              },
            ]}
          >
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 2,
    paddingHorizontal: 20,
    paddingTop: 18,
    maxHeight: '80%',
    ...Platform.select({
      android: { elevation: 10 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
      },
    }),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150,150,150,0.2)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 18,
    fontWeight: '800',
  },
  sheetSubtitle: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardsScroll: {
    marginTop: 14,
  },
  analyzingBox: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  analyzingText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 14,
    textAlign: 'center',
  },
  checksGrid: {
    gap: 12,
  },
  checkCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  checkCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  checkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  checkBadgeText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 12,
    fontWeight: '700',
  },
  scoreValue: {
    fontFamily: FONTS.jetbrainsMono.semiBold,
    fontSize: 12,
  },
  checkDescription: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  dismissButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
