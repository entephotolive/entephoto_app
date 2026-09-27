/**
 * PipelineNotificationStack
 *
 * Collapsed state  – a small floating card sits above the bottom dock (kept as-is).
 * Expanded state   – an authentic iOS Notification Center sheet with individual per-event
 *                    cards (not grouped story rows). Each card:
 *                      · thumbnail icon + uppercase category label + relative timestamp (top line)
 *                      · bold filename title
 *                      · natural-language subtitle sentence
 *                      · live progress bar while the stage is in-progress
 *                    Cards auto-slide to the right + fade out 1.8 s after reaching a terminal state.
 *
 * Visual style: matches the already-decided frosted-glass + neo-brutalist translucency approach
 * used in the collapsed card (BlurView on iOS, opaque dark/light on Android).
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Pressable,
  Modal,
  Animated as RNAnimated,
  PanResponder,
  Platform,
} from 'react-native';
import Animated, { SlideInDown, SlideOutRight, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  Heart,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ChevronUp,
  X,
  Trash2,
  Layers,
  Activity,
  CheckCheck,
} from 'lucide-react-native';
import { Text } from '@/components/Text';
import { FONTS } from '@/constants/typography';
import { useTheme } from '@/constants/theme';
import {
  PipelineEvent,
  PipelineEventType,
  subscribeToPipelineEvents,
} from '@/services/galleryPipelineService';

// ── Constants ─────────────────────────────────────────────────────────────
const MAX_EVENT_HISTORY = 250;
/** How long (ms) after a terminal state before a card auto-slides away. */
const AUTO_DISMISS_DELAY_MS = 1800;

// ── Time Formatter ─────────────────────────────────────────────────────────
function getRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 4) return 'now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

// ── Determine if an event type is a terminal (completed / errored) state ──
function isTerminalEvent(type: PipelineEventType): boolean {
  return (
    type === 'compress_done' ||
    type === 'compress_error' ||
    type === 'quality_done' ||
    type === 'quality_error' ||
    type === 'favorited' ||
    type === 'pipeline_complete'
  );
}

// ── Per-event card data ────────────────────────────────────────────────────
interface CardConfig {
  /** Short uppercase label, e.g. "COMPRESSION" */
  category: string;
  categoryColor: string;
  /** Bold filename or activity title */
  title: string;
  /** Natural-language sentence body */
  body: string;
  iconBg: string;
  icon: React.ReactNode;
  /** 0–100 if currently in progress, undefined once done */
  progressPercent?: number;
}

function getCardConfig(event: PipelineEvent): CardConfig {
  const d = event.detail;
  const name = event.photoName;

  switch (event.type) {
    case 'compress_start':
      return {
        category: 'COMPRESSION',
        categoryColor: '#3B82F6',
        title: name,
        body: 'Optimizing photo size…',
        iconBg: '#DBEAFE',
        icon: <Zap size={13} color="#2563EB" strokeWidth={2.5} />,
        progressPercent: 0,
      };
    case 'compress_progress':
      return {
        category: 'COMPRESSION',
        categoryColor: '#3B82F6',
        title: name,
        body: d?.progressLabel || 'Encoding JPEG…',
        iconBg: '#DBEAFE',
        icon: <Zap size={13} color="#2563EB" strokeWidth={2.5} />,
        progressPercent: d?.progressPercent ?? 50,
      };
    case 'compress_done': {
      const isSkipped =
        d?.progressLabel?.includes('skipped') ||
        d?.progressLabel?.includes('under 4 MB') ||
        d?.originalSizeMb === d?.compressedSizeMb;
      return {
        category: 'COMPRESSION',
        categoryColor: '#10B981',
        title: name,
        body: isSkipped
          ? `Already optimized (${d?.originalSizeMb || '<4MB'}) — skipped`
          : `Compressed — ${d?.originalSizeMb || ''} → ${d?.compressedSizeMb || '<2MB'}`,
        iconBg: '#D1FAE5',
        icon: <Zap size={13} color="#059669" strokeWidth={2.5} />,
      };
    }
    case 'compress_error':
      return {
        category: 'COMPRESSION',
        categoryColor: '#EF4444',
        title: name,
        body: 'Compression failed — uploading at original size',
        iconBg: '#FEE2E2',
        icon: <AlertTriangle size={13} color="#DC2626" strokeWidth={2.5} />,
      };
    case 'quality_start':
      return {
        category: 'QUALITY CHECK',
        categoryColor: '#8B5CF6',
        title: name,
        body: 'Resizing for quality analysis…',
        iconBg: '#EDE9FE',
        icon: <Sparkles size={13} color="#7C3AED" strokeWidth={2.5} />,
        progressPercent: 0,
      };
    case 'quality_progress':
      return {
        category: 'QUALITY CHECK',
        categoryColor: '#8B5CF6',
        title: name,
        body: d?.progressLabel || 'Analyzing image…',
        iconBg: '#EDE9FE',
        icon: <Sparkles size={13} color="#7C3AED" strokeWidth={2.5} />,
        progressPercent: d?.progressPercent ?? 50,
      };
    case 'quality_done':
      if (d?.passed) {
        return {
          category: 'QUALITY CHECK',
          categoryColor: '#10B981',
          title: name,
          body: `Quality check passed — sharpness ${d?.sharpnessScore?.toFixed(0) ?? '100+'}`,
          iconBg: '#D1FAE5',
          icon: <CheckCircle2 size={13} color="#059669" strokeWidth={2.5} />,
        };
      }
      return {
        category: 'QUALITY CHECK',
        categoryColor: '#F59E0B',
        title: name,
        body: 'Needs review — blur or exposure issue detected',
        iconBg: '#FEF3C7',
        icon: <AlertTriangle size={13} color="#D97706" strokeWidth={2.5} />,
      };
    case 'quality_error':
      return {
        category: 'QUALITY CHECK',
        categoryColor: '#EF4444',
        title: name,
        body: 'Quality scan skipped — ready for manual review',
        iconBg: '#FEE2E2',
        icon: <Activity size={13} color="#DC2626" strokeWidth={2.5} />,
      };
    case 'favorited':
      return {
        category: 'AUTO-FAVORITED',
        categoryColor: '#EC4899',
        title: name,
        body: 'Quality check passed — added to favorites',
        iconBg: '#FCE7F3',
        icon: <Heart size={13} color="#DB2777" strokeWidth={2.5} fill="#DB2777" />,
      };
    case 'pipeline_complete':
      return {
        category: 'PIPELINE',
        categoryColor: '#10B981',
        title: 'All photos processed',
        body: 'Gallery optimized, analyzed & keepers auto-favorited',
        iconBg: '#D1FAE5',
        icon: <CheckCheck size={13} color="#059669" strokeWidth={2.5} />,
      };
    default:
      return {
        category: 'PIPELINE',
        categoryColor: '#6B7280',
        title: name,
        body: 'Processing…',
        iconBg: '#F3F4F6',
        icon: <Sparkles size={13} color="#4B5563" strokeWidth={2.5} />,
        progressPercent: 50,
      };
  }
}

// ── Progress Bar sub-component ────────────────────────────────────────────
interface ProgressBarProps {
  percent: number;
  color: string;
  isDark: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ percent, color, isDark }) => {
  const [anim] = useState(() => new RNAnimated.Value(0));

  useEffect(() => {
    RNAnimated.timing(anim, {
      toValue: Math.min(Math.max(percent, 0), 100) / 100,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [anim, percent]);

  const barWidth = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.progressRow}>
      <View
        style={[
          styles.progressTrack,
          { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' },
        ]}
      >
        <RNAnimated.View
          style={[styles.progressFill, { width: barWidth, backgroundColor: color }]}
        />
      </View>
      <Text style={[styles.progressLabel, { color: isDark ? '#A1A1AA' : '#71717A' }]}>
        {percent}%
      </Text>
    </View>
  );
};

// ── Single iOS Notification Card ───────────────────────────────────────────
interface IOSNotificationCardProps {
  event: PipelineEvent;
  isDark: boolean;
  timeString: string;
}

const IOSNotificationCardComponent: React.FC<IOSNotificationCardProps> = ({
  event,
  isDark,
  timeString,
}) => {
  const config = getCardConfig(event);
  const isProgress = typeof config.progressPercent === 'number';

  return (
    <View
      style={[
        styles.notifCard,
        {
          backgroundColor: isDark ? 'rgba(28, 28, 34, 0.92)' : 'rgba(255, 255, 255, 0.94)',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(22,22,22,0.1)',
        },
      ]}
    >
      {Platform.OS === 'ios' && (
        <BlurView intensity={50} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      )}

      <View style={styles.notifCardInner}>
        {/* ── Top Line: icon + category label + timestamp ── */}
        <View style={styles.notifTopRow}>
          <View style={styles.notifTopLeft}>
            {event.thumbnailUri ? (
              <Image source={{ uri: event.thumbnailUri }} style={styles.notifThumb} />
            ) : (
              <View style={[styles.notifIconBox, { backgroundColor: config.iconBg }]}>
                {config.icon}
              </View>
            )}
            <Text
              style={[styles.notifCategoryLabel, { color: config.categoryColor }]}
              numberOfLines={1}
            >
              {config.category}
            </Text>
          </View>
          <Text style={[styles.notifTimestamp, { color: isDark ? '#71717A' : '#A1A1AA' }]}>
            {timeString}
          </Text>
        </View>

        {/* ── Title: bold photo filename ── */}
        <Text
          style={[styles.notifTitle, { color: isDark ? '#FFFFFF' : '#161616' }]}
          numberOfLines={1}
        >
          {config.title}
        </Text>

        {/* ── Body: natural-language sentence ── */}
        <Text
          style={[styles.notifBody, { color: isDark ? '#C4C4CC' : '#52525B' }]}
          numberOfLines={2}
        >
          {config.body}
        </Text>

        {/* ── Progress bar (only while in progress) ── */}
        {isProgress && (
          <ProgressBar
            percent={config.progressPercent!}
            color={config.categoryColor}
            isDark={isDark}
          />
        )}
      </View>
    </View>
  );
};

const IOSNotificationCard = React.memo(
  IOSNotificationCardComponent,
  (prev, next) =>
    prev.event.id === next.event.id &&
    prev.isDark === next.isDark &&
    prev.timeString === next.timeString,
);

// ── Dismissible list item wrapper ─────────────────────────────────────────
/**
 * Each live card in the expanded sheet is wrapped in this component.
 * It listens to the event's terminal status and auto-dismisses after a delay.
 */
interface DismissibleCardProps {
  event: PipelineEvent;
  isDark: boolean;
  onDismiss: (id: string) => void;
}

const DismissibleCard: React.FC<DismissibleCardProps> = ({ event, isDark, onDismiss }) => {
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isTerminalEvent(event.type)) {
      dismissTimerRef.current = setTimeout(() => {
        onDismiss(event.id);
      }, AUTO_DISMISS_DELAY_MS);
    }
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [event.id, event.type, onDismiss]);

  return (
    <Animated.View
      entering={SlideInDown.springify().damping(18).stiffness(160)}
      exiting={SlideOutRight.duration(320)}
      layout={LinearTransition.springify().damping(16).stiffness(140)}
      style={styles.dismissibleWrapper}
    >
      <IOSNotificationCard
        event={event}
        isDark={isDark}
        timeString={getRelativeTime(event.timestamp)}
      />
    </Animated.View>
  );
};

// ── Main Pipeline Notification Stack ─────────────────────────────────────
export interface PipelineNotificationStackProps {
  bottomOffset?: number;
}

export const PipelineNotificationStack: React.FC<PipelineNotificationStackProps> = ({
  bottomOffset = 88,
}) => {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Full raw event log (capped to avoid unbounded growth)
  const [allEvents, setAllEvents] = useState<PipelineEvent[]>([]);
  // IDs that have been dismissed from the expanded live list
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(false);
  const [, setTick] = useState(0);

  // Legacy RN Animated for the sheet slide-up (spring, not Reanimated, to keep existing behavior)
  const [expandAnim] = useState(() => new RNAnimated.Value(0));

  // Subscribe to live pipeline event stream
  useEffect(() => {
    const unsubscribe = subscribeToPipelineEvents(newEvent => {
      setAllEvents(prev => [newEvent, ...prev].slice(0, MAX_EVENT_HISTORY));
    });
    return () => unsubscribe();
  }, []);

  // Periodic tick for relative timestamps
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 4000);
    return () => clearInterval(interval);
  }, []);

  // ── Live list: all events not yet dismissed ──
  // We show the most recent event per photo per stage (dedup by photoId+type bucket),
  // so a compress_progress that supersedes compress_start is reflected in the same slot.
  // The key insight: for the expanded list we track one "active card" per (photoId, stage).
  const activeListEvents = useMemo<PipelineEvent[]>(() => {
    // Build a map: `${photoId}:${stageKey}` → latest event
    const slotMap = new Map<string, PipelineEvent>();
    // allEvents is newest-first; we process newest first so earlier entries don't overwrite
    for (const ev of allEvents) {
      if (dismissedIds.has(ev.id)) continue;
      const stageKey = ev.type.startsWith('compress')
        ? 'compress'
        : ev.type.startsWith('quality')
          ? 'quality'
          : ev.type;
      const slot = `${ev.photoId}:${stageKey}`;
      if (!slotMap.has(slot)) {
        slotMap.set(slot, ev);
      }
    }
    // Return sorted newest-first
    return Array.from(slotMap.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [allEvents, dismissedIds]);

  // ── Collapsed stack peek: top 3 most recent raw events ──
  const activeCollapsedEvents = useMemo(() => {
    return allEvents.slice(0, 3);
  }, [allEvents]);

  // Active count = events still visible in live list (not dismissed)
  const activeCount = activeListEvents.length;
  const totalEventCount = allEvents.length;

  const topCard = activeCollapsedEvents[0];
  const secondCard = activeCollapsedEvents[1];
  const thirdCard = activeCollapsedEvents[2];
  const hiddenCount = Math.max(0, activeCount - 1);

  // ── Expand / Collapse ──
  const openExpanded = useCallback(() => {
    setIsExpanded(true);
    RNAnimated.spring(expandAnim, {
      toValue: 1,
      friction: 8,
      tension: 65,
      useNativeDriver: true,
    }).start();
  }, [expandAnim]);

  const closeExpanded = useCallback(() => {
    RNAnimated.timing(expandAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setIsExpanded(false));
  }, [expandAnim]);

  const clearAllEvents = useCallback(() => {
    setAllEvents([]);
    setDismissedIds(new Set());
    closeExpanded();
  }, [closeExpanded]);

  // Called by DismissibleCard after its exit animation completes
  const handleDismiss = useCallback((id: string) => {
    setDismissedIds(prev => new Set([...prev, id]));
  }, []);

  // Swipe up pan responder on collapsed stack
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
        onPanResponderRelease: (_, g) => {
          if (g.dy < -15 || Math.abs(g.dy) < 5) openExpanded();
        },
      }),
    [openExpanded],
  );

  // Render item for the Reanimated FlatList
  const renderItem = useCallback(
    ({ item }: { item: PipelineEvent }) => (
      <DismissibleCard event={item} isDark={isDark} onDismiss={handleDismiss} />
    ),
    [isDark, handleDismiss],
  );

  const keyExtractor = useCallback((item: PipelineEvent) => item.id, []);

  if (allEvents.length === 0) return null;

  return (
    <>
      {/* ── COLLAPSED iOS LOCK-SCREEN NOTIFICATION STACK ── */}
      <View
        pointerEvents="box-none"
        style={[
          styles.stackAnchorContainer,
          { bottom: Math.max(insets.bottom, 16) + bottomOffset },
        ]}
      >
        <Pressable
          onPress={openExpanded}
          {...panResponder.panHandlers}
          style={styles.stackedCardsGroup}
          accessibilityRole="button"
          accessibilityLabel="Expand pipeline activity notifications"
        >
          {/* Layer 2: 3rd background peeking card */}
          {thirdCard && (
            <View style={[styles.stackLayer, styles.layer3]}>
              <View
                style={[
                  styles.cardDummyShadow,
                  {
                    backgroundColor: isDark
                      ? 'rgba(20, 20, 24, 0.65)'
                      : 'rgba(230, 230, 235, 0.75)',
                    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                  },
                ]}
              />
            </View>
          )}

          {/* Layer 1: 2nd background peeking card */}
          {secondCard && (
            <View style={[styles.stackLayer, styles.layer2]}>
              <View
                style={[
                  styles.cardDummyShadow,
                  {
                    backgroundColor: isDark
                      ? 'rgba(24, 24, 28, 0.78)'
                      : 'rgba(242, 242, 247, 0.85)',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                  },
                ]}
              />
            </View>
          )}

          {/* Layer 0: Front notification card */}
          {topCard && (
            <View style={styles.layer1Front}>
              <IOSNotificationCard
                event={topCard}
                isDark={isDark}
                timeString={getRelativeTime(topCard.timestamp)}
              />
              {hiddenCount > 0 && (
                <View
                  style={[
                    styles.moreCountBadge,
                    {
                      backgroundColor: isDark
                        ? 'rgba(30, 30, 36, 0.92)'
                        : 'rgba(255, 255, 255, 0.95)',
                      borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)',
                    },
                  ]}
                >
                  <Text style={[styles.moreCountText, { color: isDark ? '#D4D4D8' : '#3F3F46' }]}>
                    +{hiddenCount} more
                  </Text>
                  <ChevronUp size={12} color={isDark ? '#D4D4D8' : '#3F3F46'} strokeWidth={2.4} />
                </View>
              )}
            </View>
          )}
        </Pressable>
      </View>

      {/* ── EXPANDED NOTIFICATION CENTER SHEET ── */}
      <Modal
        visible={isExpanded}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeExpanded}
      >
        <View style={styles.expandedBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeExpanded} />

          <RNAnimated.View
            style={[
              styles.expandedSheetContainer,
              {
                backgroundColor: isDark ? '#141417' : '#FAF7F2',
                borderColor: isDark ? '#2E2E36' : '#161616',
                paddingBottom: Math.max(insets.bottom, 16) + 12,
                transform: [
                  {
                    translateY: expandAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [500, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Drag handle */}
            <View style={styles.sheetHandleBar} />

            {/* Sheet header */}
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetHeaderLeft}>
                <View
                  style={[
                    styles.sheetHeaderIcon,
                    {
                      backgroundColor: isDark ? '#26262E' : '#FFE5D9',
                      borderColor: isDark ? '#3F3F46' : '#161616',
                    },
                  ]}
                >
                  <Layers size={18} color={isDark ? '#FFA07A' : '#161616'} strokeWidth={2.2} />
                </View>
                <View>
                  <Text style={[styles.sheetTitle, { color: isDark ? '#FFFFFF' : '#161616' }]}>
                    Pipeline Activity
                  </Text>
                  <Text style={[styles.sheetSubtitle, { color: isDark ? '#A1A1AA' : '#71717A' }]}>
                    {activeCount} active • {totalEventCount} total events
                  </Text>
                </View>
              </View>

              <View style={styles.sheetHeaderRight}>
                {allEvents.length > 0 && (
                  <TouchableOpacity
                    onPress={clearAllEvents}
                    hitSlop={8}
                    style={[
                      styles.clearBtn,
                      {
                        backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                        borderColor: isDark ? '#3F3F46' : '#161616',
                      },
                    ]}
                  >
                    <Trash2 size={14} color="#EF4444" strokeWidth={2.2} />
                    <Text style={styles.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={closeExpanded}
                  hitSlop={8}
                  style={[
                    styles.closeModalBtn,
                    {
                      backgroundColor: isDark ? '#27272A' : '#FFFFFF',
                      borderColor: isDark ? '#3F3F46' : '#161616',
                    },
                  ]}
                >
                  <X size={16} color={isDark ? '#F4F4F5' : '#161616'} strokeWidth={2.4} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Animated FlatList with Reanimated entering/exiting on each item */}
            <Animated.FlatList
              data={activeListEvents}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              itemLayoutAnimation={LinearTransition.springify().damping(16).stiffness(140)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.expandedListContent}
              initialNumToRender={10}
              maxToRenderPerBatch={12}
              windowSize={9}
              removeClippedSubviews={Platform.OS === 'android'}
            />
          </RNAnimated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  // ── Collapsed stack anchor ──
  stackAnchorContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 999,
  },
  stackedCardsGroup: {
    width: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  stackLayer: {
    position: 'absolute',
    width: '100%',
    alignItems: 'center',
  },
  layer3: { top: -12, transform: [{ scaleX: 0.88 }], zIndex: 1 },
  layer2: { top: -6, transform: [{ scaleX: 0.94 }], zIndex: 2 },
  layer1Front: { width: '100%', zIndex: 3, position: 'relative' },

  cardDummyShadow: {
    width: '100%',
    height: 78,
    borderRadius: 18,
    borderWidth: 1,
  },

  // ── iOS notification card ──
  notifCard: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1.2,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
      },
      android: { elevation: 5 },
    }),
  },
  notifCardInner: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 3,
  },
  notifTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  notifTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    marginRight: 8,
  },
  notifThumb: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#3F3F46',
  },
  notifIconBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifCategoryLabel: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  notifTimestamp: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 11,
    flexShrink: 0,
  },
  notifTitle: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  notifBody: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressLabel: {
    fontFamily: FONTS.jetbrainsMono.bold,
    fontSize: 10,
    fontWeight: '700',
    minWidth: 30,
    textAlign: 'right',
  },

  // ── Dismissible wrapper ──
  dismissibleWrapper: {
    width: '100%',
    marginBottom: 10,
  },

  // ── Counter badge on collapsed stack ──
  moreCountBadge: {
    position: 'absolute',
    right: 12,
    bottom: -10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 10,
  },
  moreCountText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Expanded sheet ──
  expandedBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  expandedSheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '80%',
    ...Platform.select({
      android: { elevation: 12 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.28,
        shadowRadius: 12,
      },
    }),
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#71717A',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150,150,150,0.15)',
    marginBottom: 4,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontFamily: FONTS.syne.bold,
    fontSize: 16,
    fontWeight: '800',
  },
  sheetSubtitle: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 12,
  },
  sheetHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1.2,
  },
  clearBtnText: {
    fontFamily: FONTS.plusJakartaSans.bold,
    fontSize: 11,
    fontWeight: '700',
    color: '#EF4444',
  },
  closeModalBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedListContent: {
    paddingTop: 12,
    paddingBottom: 20,
  },
});
