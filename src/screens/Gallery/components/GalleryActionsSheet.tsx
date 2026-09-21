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
import { BlurView } from 'expo-blur';
import {
  RefreshCw,
  CheckCheck,
  RotateCcw,
  Trash2,
  CloudUpload,
  X,
  Layers,
  Sparkles,
  CheckSquare,
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
  onRescan: () => void;
  onSelectAll: () => void;
  onSelectAllNew: () => void;
  onInvertSelection: () => void;
  onClearSelection: () => void;
  onUploadSelected: () => void;
  onDeleteSelected: () => void;
}

interface ActionTileItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  backgroundColor: string;
  onPress: () => void;
  isDanger?: boolean;
}

export const GalleryActionsSheet: React.FC<GalleryActionsSheetProps> = ({
  visible,
  onClose,
  isDark,
  totalCount,
  selectedCount,
  newCount,
  onRescan,
  onSelectAll,
  onSelectAllNew,
  onInvertSelection,
  onClearSelection,
  onUploadSelected,
  onDeleteSelected,
}) => {
  const insets = useSafeAreaInsets();

  // Animation values for sheet slide-up and staggered tile bounce
  const sheetAnim = useMemo(() => new Animated.Value(0), []);
  const tileAnims = useMemo(() => Array.from({ length: 8 }, () => new Animated.Value(0)), []);

  useEffect(() => {
    if (visible) {
      // Reset animations
      sheetAnim.setValue(0);
      tileAnims.forEach(anim => anim.setValue(0));

      // 1. Slide up the bottom sheet
      Animated.spring(sheetAnim, {
        toValue: 1,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }).start();

      // 2. Staggered bounce-in entrance for the action icon tiles
      const staggerAnimations = tileAnims.map(anim =>
        Animated.spring(anim, {
          toValue: 1,
          friction: 6,
          tension: 75,
          useNativeDriver: true,
        }),
      );

      Animated.stagger(45, staggerAnimations).start();
    } else {
      sheetAnim.setValue(0);
      tileAnims.forEach(anim => anim.setValue(0));
    }
  }, [visible, sheetAnim, tileAnims]);

  // Selected Action Tiles (when selectedCount > 0)
  const selectedTiles: ActionTileItem[] = [
    {
      id: 'upload',
      icon: <CloudUpload size={24} color="#FF5E3A" strokeWidth={2.3} />,
      label: `Upload (${selectedCount})`,
      sublabel: 'Send to cloud',
      backgroundColor: isDark ? '#331E18' : '#FFEBE2',
      onPress: onUploadSelected,
    },
    {
      id: 'delete',
      icon: <Trash2 size={24} color="#EF4444" strokeWidth={2.3} />,
      label: `Delete (${selectedCount})`,
      sublabel: 'Erase from storage',
      backgroundColor: isDark ? '#33161A' : '#FEEBEB',
      onPress: onDeleteSelected,
      isDanger: true,
    },
  ];

  // Selection Action Tiles
  const selectionTiles: ActionTileItem[] = [
    {
      id: 'selectAll',
      icon: <CheckCheck size={24} color="#10B981" strokeWidth={2.3} />,
      label: `Select All (${totalCount})`,
      backgroundColor: isDark ? '#172D23' : '#E8F8F0',
      onPress: onSelectAll,
    },
    ...(newCount > 0 && newCount !== totalCount
      ? [
          {
            id: 'selectNew',
            icon: <CheckSquare size={24} color="#F59E0B" strokeWidth={2.3} />,
            label: `Select New (${newCount})`,
            backgroundColor: isDark ? '#332817' : '#FEF5E7',
            onPress: onSelectAllNew,
          },
        ]
      : []),
    {
      id: 'invert',
      icon: <Layers size={24} color="#6366F1" strokeWidth={2.3} />,
      label: 'Invert Selection',
      backgroundColor: isDark ? '#232238' : '#EEF0FF',
      onPress: onInvertSelection,
    },
    ...(selectedCount > 0
      ? [
          {
            id: 'clear',
            icon: <RotateCcw size={24} color={isDark ? '#D4D4D8' : '#6B655D'} strokeWidth={2.3} />,
            label: 'Clear Selection',
            backgroundColor: isDark ? '#2A2A33' : '#F2ECE4',
            onPress: onClearSelection,
          },
        ]
      : []),
  ];

  // Storage / Folder Action Tiles
  const storageTiles: ActionTileItem[] = [
    {
      id: 'rescan',
      icon: <RefreshCw size={24} color="#3B82F6" strokeWidth={2.3} />,
      label: 'Rescan DCIM',
      backgroundColor: isDark ? '#182538' : '#EBF4FF',
      onPress: onRescan,
    },
  ];

  let animIndexTracker = 0;

  const renderActionTile = (item: ActionTileItem) => {
    const currentIndex = animIndexTracker++;
    const animValue = tileAnims[currentIndex] || tileAnims[0];

    const animatedStyle = {
      opacity: animValue,
      transform: [
        {
          translateY: animValue.interpolate({
            inputRange: [0, 1],
            outputRange: [24, 0],
          }),
        },
        {
          scale: animValue.interpolate({
            inputRange: [0, 1],
            outputRange: [0.65, 1],
          }),
        },
      ],
    };

    return (
      <Animated.View key={item.id} style={[styles.tileWrapper, animatedStyle]}>
        <Pressable
          onPress={item.onPress}
          style={({ pressed }) => [
            styles.tileButton,
            {
              backgroundColor: item.backgroundColor,
              transform: [{ scale: pressed ? 0.92 : 1 }],
              opacity: pressed ? 0.9 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          {item.icon}
        </Pressable>

        {/* Label underneath icon tile */}
        <Text
          numberOfLines={2}
          style={[
            styles.tileLabel,
            {
              color: item.isDanger ? '#EF4444' : isDark ? '#F4F4F5' : '#18181B',
            },
          ]}
        >
          {item.label}
        </Text>
      </Animated.View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        {/* Real Blurred Backdrop with fallback */}
        <BlurView
          intensity={Platform.OS === 'ios' ? 40 : 50}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />

        {/* Ambient Darkener / Fallback Layer */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.58)' : 'rgba(0, 0, 0, 0.32)',
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
              backgroundColor: isDark ? '#19191F' : '#FAF7F2',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(22, 22, 22, 0.06)',
              paddingBottom: Math.max(insets.bottom, 16) + 12,
              transform: [
                {
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Smooth Clay Drag Handle */}
          <View style={[styles.sheetHandle, { backgroundColor: isDark ? '#2E2E38' : '#E3DAD0' }]} />

          {/* Header Row */}
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleGroup}>
              <View style={styles.sheetTitleRow}>
                <View
                  style={[
                    styles.headerIconPill,
                    {
                      backgroundColor: isDark ? '#2B1E1A' : '#FFEBE2',
                    },
                  ]}
                >
                  <Sparkles size={16} color="#FF5E3A" strokeWidth={2.4} />
                </View>
                <Text style={[styles.sheetTitleText, { color: isDark ? '#F4F4F5' : '#18181B' }]}>
                  Gallery Actions
                </Text>
              </View>
              <Text style={[styles.sheetSubtitleText, { color: isDark ? '#A1A1AA' : '#8A827A' }]}>
                {totalCount} photos total • {selectedCount} selected
              </Text>
            </View>

            {/* Clay Circular Close Button */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[
                styles.closeButton,
                {
                  backgroundColor: isDark ? '#25252E' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close actions"
            >
              <X size={17} color={isDark ? '#F4F4F5' : '#18181B'} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.actionsListContent}
          >
            {/* ── 1. SELECTED PHOTOS ACTIONS (IF PHOTOS SELECTED) ── */}
            {selectedCount > 0 && (
              <View style={styles.actionSectionGroup}>
                <Text style={[styles.sectionHeading, { color: isDark ? '#8E8E9A' : '#948E86' }]}>
                  SELECTED ACTIONS ({selectedCount})
                </Text>

                <View style={styles.tileGridRow}>{selectedTiles.map(renderActionTile)}</View>
              </View>
            )}

            {/* ── 2. SELECTION SHORTCUTS ── */}
            <View style={styles.actionSectionGroup}>
              <Text style={[styles.sectionHeading, { color: isDark ? '#8E8E9A' : '#948E86' }]}>
                SELECTION
              </Text>

              <View style={styles.tileGridRow}>{selectionTiles.map(renderActionTile)}</View>
            </View>

            {/* ── 3. DEVICE & FOLDER ── */}
            <View style={styles.actionSectionGroup}>
              <Text style={[styles.sectionHeading, { color: isDark ? '#8E8E9A' : '#948E86' }]}>
                DEVICE & FOLDER
              </Text>

              <View style={styles.tileGridRow}>{storageTiles.map(renderActionTile)}</View>
            </View>
          </ScrollView>

          {/* Dismiss / Close Pill Button */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={onClose}
            style={[
              styles.dismissButton,
              {
                backgroundColor: isDark ? '#282832' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
              },
            ]}
          >
            <Text style={[styles.dismissButtonText, { color: isDark ? '#F4F4F5' : '#18181B' }]}>
              Done
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '85%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.16,
        shadowRadius: 20,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  sheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 10,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150, 150, 150, 0.1)',
    marginBottom: 14,
  },
  sheetTitleGroup: {
    flex: 1,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitleText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sheetSubtitleText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12.5,
    marginTop: 3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  actionsListContent: {
    paddingVertical: 6,
    gap: 18,
  },
  actionSectionGroup: {
    gap: 10,
  },
  sectionHeading: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  tileGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  tileWrapper: {
    alignItems: 'center',
    width: 78,
  },
  tileButton: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  tileLabel: {
    fontFamily: FONTS.plusJakartaSans.semiBold,
    fontSize: 11.5,
    textAlign: 'center',
    lineHeight: 14.5,
  },
  dismissButton: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 5,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  dismissButtonText: {
    fontFamily: FONTS.syne.bold,
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
