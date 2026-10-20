import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Modal,
  ScrollView,
  Platform,
  Animated,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  RefreshCw,
  CheckCheck,
  RotateCcw,
  Trash2,
  CloudUpload,
  Layers,
  ArrowRight,
  Pause,
  Play,
} from 'lucide-react-native';
import { Text } from '@/components/Text';
import { FONTS } from '@/constants/typography';

interface GalleryActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  totalCount: number;
  selectedCount: number;
  newCount: number;
  unuploadedCount: number;
  isAllUploadActive?: boolean;
  isAllUploadPaused?: boolean;
  onRescan: () => void;
  onSelectAll: () => void;
  onSelectAllNew: () => void;
  onInvertSelection: () => void;
  onClearSelection: () => void;
  onUploadSelected: () => void;
  onDeleteSelected: () => void;
  onStartAllUpload?: () => void;
  onPauseAllUpload?: () => void;
  onResumeAllUpload?: () => void;
}

interface ActionTileItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  surfaceTint: string;
  onPress: () => void;
  isDanger?: boolean;
  disabled?: boolean;
}

const GalleryActionsSheetContent = React.memo<GalleryActionsSheetProps>(
  ({
    visible,
    onClose,
    isDark,
    totalCount,
    selectedCount,
    newCount,
    unuploadedCount,
    isAllUploadActive = false,
    isAllUploadPaused = false,
    onRescan,
    onSelectAll,
    onSelectAllNew,
    onInvertSelection,
    onClearSelection,
    onUploadSelected,
    onDeleteSelected,
    onStartAllUpload,
    onPauseAllUpload,
    onResumeAllUpload,
  }) => {
    const insets = useSafeAreaInsets();
    const isButtonEnabled = isAllUploadActive ? true : unuploadedCount > 0;

    const handleAllUploadPress = () => {
      if (!isButtonEnabled) return;

      Alert.alert(
        'Start All Upload?',
        'All photos in this gallery that have not been uploaded will be uploaded one by one.\n\nNewly arriving photos will also be included while All Upload is active.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Start Upload',
            style: 'default',
            onPress: () => {
              onStartAllUpload?.();
            },
          },
        ],
        { cancelable: true },
      );
    };

    const handlePrimaryButtonClick = () => {
      if (!isButtonEnabled) return;

      if (isAllUploadActive) {
        if (isAllUploadPaused) {
          onResumeAllUpload?.();
        } else {
          onPauseAllUpload?.();
        }
        onClose();
        return;
      }

      handleAllUploadPress();
    };

    const buttonLabel = isAllUploadActive
      ? isAllUploadPaused
        ? 'Resume Upload'
        : 'Pause Upload'
      : 'All Upload';

    const buttonIcon = isAllUploadActive ? (
      isAllUploadPaused ? (
        <Play size={22} color="#6366F1" fill="#6366F1" strokeWidth={2.4} />
      ) : (
        <Pause
          size={22}
          color={isDark ? '#FFA085' : '#FF5E3A'}
          fill={isDark ? '#FFA085' : '#FF5E3A'}
          strokeWidth={2.4}
        />
      )
    ) : (
      <CloudUpload size={22} color="#FF5E3A" strokeWidth={2.4} />
    );

    // Single coordinated sheet slide-up and fade-in animation
    const [sheetAnim] = useState(() => new Animated.Value(0));

    useEffect(() => {
      if (visible) {
        sheetAnim.setValue(0);
        const anim = Animated.spring(sheetAnim, {
          toValue: 1,
          damping: 24,
          stiffness: 260,
          mass: 0.8,
          useNativeDriver: true,
        });
        anim.start();

        return () => {
          anim.stop();
        };
      } else {
        sheetAnim.setValue(0);
      }
    }, [visible, sheetAnim]);

    // Memoize Action Tiles Array so objects and icons are not reallocated on every render
    const allTiles: ActionTileItem[] = useMemo(
      () => [
        {
          id: 'upload',
          icon: <CloudUpload size={28} color="#FF5E3A" strokeWidth={2.4} />,
          label: selectedCount > 0 ? `Upload (${selectedCount})` : 'Upload',
          surfaceTint: isDark ? 'rgba(255, 94, 58, 0.12)' : 'rgba(255, 94, 58, 0.08)',
          onPress: onUploadSelected,
          disabled: selectedCount === 0,
        },
        {
          id: 'delete',
          icon: <Trash2 size={28} color="#EF4444" strokeWidth={2.4} />,
          label: selectedCount > 0 ? `Delete (${selectedCount})` : 'Delete',
          surfaceTint: isDark ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.08)',
          onPress: onDeleteSelected,
          isDanger: true,
          disabled: selectedCount === 0,
        },
        {
          id: 'selectAll',
          icon: <CheckCheck size={28} color="#10B981" strokeWidth={2.4} />,
          label: totalCount > 0 ? `Select All (${totalCount})` : 'Select All',
          surfaceTint: isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.08)',
          onPress: onSelectAll,
          disabled: totalCount === 0,
        },
        {
          id: 'invert',
          icon: <Layers size={28} color="#8B5CF6" strokeWidth={2.4} />,
          label: 'Invert Selection',
          surfaceTint: isDark ? 'rgba(139, 92, 246, 0.12)' : 'rgba(139, 92, 246, 0.08)',
          onPress: onInvertSelection,
          disabled: totalCount === 0,
        },
        {
          id: 'clear',
          icon: <RotateCcw size={28} color={isDark ? '#D4D4D8' : '#6B655D'} strokeWidth={2.4} />,
          label: 'Clear Selection',
          surfaceTint: isDark ? 'rgba(212, 212, 216, 0.12)' : 'rgba(107, 101, 93, 0.08)',
          onPress: onClearSelection,
          disabled: selectedCount === 0,
        },
        {
          id: 'rescan',
          icon: <RefreshCw size={28} color="#3B82F6" strokeWidth={2.4} />,
          label: 'Rescan Photos',
          surfaceTint: isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.08)',
          onPress: onRescan,
          disabled: false,
        },
      ],
      [
        selectedCount,
        totalCount,
        isDark,
        onUploadSelected,
        onDeleteSelected,
        onSelectAll,
        onInvertSelection,
        onClearSelection,
        onRescan,
      ],
    );

    const renderGridCard = (item: ActionTileItem) => {
      return (
        <View
          key={item.id}
          style={[styles.actionCardWrapper, { opacity: item.disabled ? 0.4 : 1 }]}
        >
          <Pressable
            onPress={item.disabled ? undefined : item.onPress}
            disabled={item.disabled}
            style={({ pressed }) => [
              styles.actionCardButton,
              {
                backgroundColor: pressed
                  ? isDark
                    ? '#30303D'
                    : '#F0F0F0'
                  : isDark
                    ? '#191922'
                    : '#FFFFFF',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            {/* Subtle color tint overlay for the button surface */}
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: item.surfaceTint, borderRadius: 26 },
              ]}
            />

            <View
              style={[
                styles.actionIconBox,
                {
                  backgroundColor: isDark ? '#252530' : '#F5F5F7',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                },
              ]}
            >
              {item.icon}
            </View>
            <View style={styles.actionTextGroup}>
              <Text
                numberOfLines={2}
                style={[
                  styles.actionCardLabel,
                  {
                    color: item.isDanger
                      ? isDark
                        ? '#FCA5A5'
                        : '#DC2626'
                      : isDark
                        ? '#F4F4F5'
                        : '#18181B',
                  },
                ]}
              >
                {item.label}
              </Text>
            </View>
          </Pressable>
        </View>
      );
    };

    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          {/* Real Blurred Backdrop on iOS */}
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={40}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          )}

          {/* Themed Dimming Backdrop (Semi-transparent backdrop on Android, ambient darkener on iOS) */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor:
                  Platform.OS === 'ios'
                    ? isDark
                      ? 'rgba(0, 0, 0, 0.58)'
                      : 'rgba(0, 0, 0, 0.32)'
                    : isDark
                      ? 'rgba(0, 0, 0, 0.72)'
                      : 'rgba(0, 0, 0, 0.48)',
              },
            ]}
          />

          {/* Tap outside to dismiss */}
          <Pressable style={styles.modalBackdropTouch} onPress={onClose} />

          {/* Action Sheet Panel */}
          <Animated.View
            style={[
              styles.sheetContainer,
              {
                backgroundColor:
                  Platform.OS === 'android'
                    ? isDark
                      ? '#13131A'
                      : '#FAF7F2'
                    : isDark
                      ? 'rgba(17, 17, 24, 0.85)'
                      : 'rgba(250, 247, 242, 0.85)',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
                paddingBottom: Math.max(insets.bottom, 16) + 12,
                opacity: sheetAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1],
                }),
                transform: [
                  {
                    translateY: sheetAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [220, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Smooth Clay Drag Handle */}
            <View
              style={[styles.sheetHandle, { backgroundColor: isDark ? '#4A4A5A' : '#D0D0D0' }]}
            />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.actionsListContent}
            >
              <View style={styles.actionGridContainer}>{allTiles.map(renderGridCard)}</View>
            </ScrollView>

            {/* Primary All Upload Action Button */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handlePrimaryButtonClick}
              disabled={!isButtonEnabled}
              style={[
                styles.allUploadButton,
                {
                  backgroundColor: isDark ? '#191922' : '#FFFFFF',
                  borderColor: isAllUploadActive
                    ? isAllUploadPaused
                      ? isDark
                        ? 'rgba(99, 102, 241, 0.35)'
                        : 'rgba(99, 102, 241, 0.25)'
                      : isDark
                        ? 'rgba(255, 94, 58, 0.35)'
                        : 'rgba(255, 94, 58, 0.25)'
                    : isDark
                      ? 'rgba(255, 94, 58, 0.25)'
                      : 'rgba(255, 94, 58, 0.2)',
                  opacity: isButtonEnabled ? 1 : 0.45,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={buttonLabel}
              accessibilityState={{ disabled: !isButtonEnabled }}
            >
              <View style={styles.allUploadContentRow}>
                {buttonIcon}
                <Text
                  style={[
                    styles.allUploadButtonText,
                    {
                      color: isDark ? '#F4F4F5' : '#18181B',
                    },
                  ]}
                >
                  {buttonLabel}
                </Text>
                <ArrowRight
                  size={20}
                  color={
                    isAllUploadActive && isAllUploadPaused
                      ? '#6366F1'
                      : isDark
                        ? '#FFA085'
                        : '#FF5E3A'
                  }
                  strokeWidth={2.4}
                />
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    );
  },
  (prev, next) => {
    // If the modal was hidden and remains hidden, completely bail out of re-rendering
    if (!prev.visible && !next.visible) {
      return true;
    }

    // If visibility changed, re-render
    if (prev.visible !== next.visible) {
      return false;
    }

    // While visible, re-render only if any relevant data or callback props change
    return (
      prev.isDark === next.isDark &&
      prev.totalCount === next.totalCount &&
      prev.selectedCount === next.selectedCount &&
      prev.newCount === next.newCount &&
      prev.unuploadedCount === next.unuploadedCount &&
      prev.isAllUploadActive === next.isAllUploadActive &&
      prev.isAllUploadPaused === next.isAllUploadPaused &&
      prev.onClose === next.onClose &&
      prev.onRescan === next.onRescan &&
      prev.onSelectAll === next.onSelectAll &&
      prev.onSelectAllNew === next.onSelectAllNew &&
      prev.onInvertSelection === next.onInvertSelection &&
      prev.onClearSelection === next.onClearSelection &&
      prev.onUploadSelected === next.onUploadSelected &&
      prev.onDeleteSelected === next.onDeleteSelected &&
      prev.onStartAllUpload === next.onStartAllUpload &&
      prev.onPauseAllUpload === next.onPauseAllUpload &&
      prev.onResumeAllUpload === next.onResumeAllUpload
    );
  },
);

GalleryActionsSheetContent.displayName = 'GalleryActionsSheetContent';

export const GalleryActionsSheet: React.FC<GalleryActionsSheetProps> = props => {
  return <GalleryActionsSheetContent {...props} />;
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '85%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  actionsListContent: {
    paddingBottom: 4,
  },
  actionGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  actionCardWrapper: {
    width: '31.33%',
  },
  actionCardButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 8,
    borderRadius: 26,
    borderWidth: 1,
    height: 125,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  actionIconBox: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 5,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  actionTextGroup: {
    alignItems: 'center',
  },
  actionCardLabel: {
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 16,
  },
  allUploadButton: {
    marginTop: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  allUploadContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  allUploadButtonText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
