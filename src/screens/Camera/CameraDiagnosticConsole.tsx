/**
 * CameraDiagnosticConsole.tsx
 *
 * In-app diagnostic console for the EntePhoto camera pipeline.
 * Works in RELEASE APK with NO Metro server and NO ADB connection.
 *
 * Features:
 * - Live log stream via onDiagnosticLog native event
 * - Full history loaded via getDiagnosticLogs() on mount
 * - Severity filtering (ALL / INFO / WARN / ERROR)
 * - Per-item colour coding (debug=grey, info=blue, warn=amber, error=red)
 * - Copy / Share log text via Share.share()
 * - Clear buffer button
 * - Auto-scroll to bottom on new records
 * - Per-photo transfer error display (onPhotoTransferError)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Share,
  Alert,
  Clipboard,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Copy, Trash2, ChevronDown, AlertTriangle, CheckCircle } from 'lucide-react-native';
import { Text } from '@/components/Text';
import { useTheme } from '@/constants/theme';
import { FONTS } from '@/constants/typography';
import {
  getDiagnosticLogs,
  clearDiagnosticLogs,
  getDiagnosticText,
  addDiagnosticLogListener,
  addPhotoTransferErrorListener,
} from 'entephoto-camera';
import type { DiagnosticRecord, PhotoTransferErrorEvent } from 'entephoto-camera';

type SeverityFilter = 'ALL' | 'INFO' | 'WARN' | 'ERROR';

interface Props {
  onClose: () => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  DEBUG: '#6B7280',
  INFO: '#3B82F6',
  WARN: '#F59E0B',
  ERROR: '#EF4444',
};

const SEVERITY_BG: Record<string, string> = {
  DEBUG: 'rgba(107,114,128,0.08)',
  INFO: 'rgba(59,130,246,0.08)',
  WARN: 'rgba(245,158,11,0.12)',
  ERROR: 'rgba(239,68,68,0.12)',
};

const SEV_ORDER = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export const CameraDiagnosticConsole: React.FC<Props> = ({ onClose }) => {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [records, setRecords] = useState<DiagnosticRecord[]>(() => {
    try {
      return getDiagnosticLogs();
    } catch {
      return [];
    }
  });
  const [transferErrors, setTransferErrors] = useState<PhotoTransferErrorEvent[]>([]);
  const [filter, setFilter] = useState<SeverityFilter>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);

  // Subscribe to live updates from native pipeline.
  useEffect(() => {
    const diagSub = addDiagnosticLogListener((record: DiagnosticRecord) => {
      setRecords(prev => [...prev.slice(-999), record]);
    });

    const errSub = addPhotoTransferErrorListener((event: PhotoTransferErrorEvent) => {
      setTransferErrors(prev => [...prev.slice(-49), event]);
    });

    return () => {
      diagSub.remove();
      errSub.remove();
    };
  }, []);

  // Auto-scroll to bottom when new records arrive.
  useEffect(() => {
    if (autoScroll && records.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [records.length, autoScroll]);

  const filteredRecords = useMemo(() => {
    if (filter === 'ALL') return records;
    const minIdx = SEV_ORDER.indexOf(filter as any);
    return records.filter(r => SEV_ORDER.indexOf(r.severity as any) >= minIdx);
  }, [records, filter]);

  const handleShare = useCallback(async () => {
    try {
      const text = getDiagnosticText();
      if (!text.trim()) {
        Alert.alert('Log is empty', 'No diagnostic records to share.');
        return;
      }
      await Share.share({
        title: 'EntePhoto Camera Diagnostics',
        message: text,
      });
    } catch (e) {
      Alert.alert('Share failed', String(e));
    }
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      const text = getDiagnosticText();
      if (Platform.OS === 'android') {
        Clipboard.setString(text);
        Alert.alert('Copied', 'Diagnostic log copied to clipboard.');
      } else {
        await Share.share({ message: text });
      }
    } catch (e) {
      Alert.alert('Copy failed', String(e));
    }
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert(
      'Clear Diagnostic Log?',
      'This clears the in-memory buffer. The camera session is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearDiagnosticLogs();
            setRecords([]);
            setTransferErrors([]);
          },
        },
      ],
    );
  }, []);

  const bg = isDark ? '#0A0A0D' : '#F8F7F5';
  const cardBg = isDark ? '#14141A' : '#FFFFFF';
  const borderColor = isDark ? '#222230' : '#E5E0DB';
  const textPrimary = isDark ? '#F4F4F5' : '#161616';
  const textSecondary = isDark ? '#71717A' : '#7A7571';

  const filterLabels: SeverityFilter[] = ['ALL', 'INFO', 'WARN', 'ERROR'];

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: bg }]}
      edges={['top', 'left', 'right']}
    >
      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: records.length > 0 ? '#22C55E' : '#6B7280' },
            ]}
          />
          <Text style={[styles.title, { color: textPrimary }]}>Camera Diagnostics</Text>
          <Text style={[styles.count, { color: textSecondary }]}> ({records.length})</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <X size={20} color={textSecondary} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      {/* ── Filter Tabs ── */}
      <View style={[styles.filterRow, { borderBottomColor: borderColor }]}>
        {filterLabels.map(f => {
          const active = filter === f;
          const color = f === 'ALL' ? '#3B82F6' : (SEVERITY_COLORS[f] ?? '#3B82F6');
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterTab,
                active && { backgroundColor: color + '22', borderColor: color, borderWidth: 1 },
              ]}
            >
              <Text style={[styles.filterTabText, { color: active ? color : textSecondary }]}>
                {f}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Auto-scroll toggle */}
        <TouchableOpacity
          onPress={() => setAutoScroll(v => !v)}
          style={[
            styles.filterTab,
            autoScroll && { backgroundColor: '#22C55E22', borderColor: '#22C55E', borderWidth: 1 },
          ]}
        >
          <ChevronDown size={13} color={autoScroll ? '#22C55E' : textSecondary} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      {/* ── Transfer Error Banner ── */}
      {transferErrors.length > 0 && (
        <View
          style={[styles.errorBanner, { backgroundColor: '#EF444418', borderColor: '#EF4444' }]}
        >
          <AlertTriangle size={14} color="#EF4444" strokeWidth={2.2} style={{ marginRight: 6 }} />
          <Text style={[styles.errorBannerText, { color: '#EF4444' }]}>
            {transferErrors.length} transfer error{transferErrors.length > 1 ? 's' : ''} —{' '}
            {transferErrors[transferErrors.length - 1].message}
          </Text>
        </View>
      )}

      {/* ── Log Records ── */}
      {filteredRecords.length === 0 ? (
        <View style={styles.centeredState}>
          <CheckCircle size={28} color={textSecondary} strokeWidth={1.5} />
          <Text style={[styles.emptyText, { color: textSecondary }]}>
            {filter === 'ALL'
              ? 'No diagnostic records yet.\nConnect the camera to start logging.'
              : `No ${filter} records.`}
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.logScroll}
          contentContainerStyle={[styles.logContent, { paddingBottom: insets.bottom + 70 }]}
          onScrollBeginDrag={() => setAutoScroll(false)}
          showsVerticalScrollIndicator={false}
        >
          {filteredRecords.map((r, i) => (
            <LogRow
              key={`${r.sequenceId}-${i}`}
              record={r}
              cardBg={cardBg}
              borderColor={borderColor}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Bottom Toolbar ── */}
      <View
        style={[
          styles.toolbar,
          {
            backgroundColor: cardBg,
            borderTopColor: borderColor,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <TouchableOpacity style={styles.toolBtn} onPress={handleShare}>
          <Text style={[styles.toolBtnText, { color: textSecondary }]}>Share Log</Text>
        </TouchableOpacity>
        <View style={[styles.toolDivider, { backgroundColor: borderColor }]} />
        <TouchableOpacity style={styles.toolBtn} onPress={handleCopy}>
          <Copy size={15} color={textSecondary} strokeWidth={2} />
          <Text style={[styles.toolBtnText, { color: textSecondary }]}> Copy</Text>
        </TouchableOpacity>
        <View style={[styles.toolDivider, { backgroundColor: borderColor }]} />
        <TouchableOpacity style={styles.toolBtn} onPress={handleClear}>
          <Trash2 size={15} color="#EF4444" strokeWidth={2} />
          <Text style={[styles.toolBtnText, { color: '#EF4444' }]}> Clear</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// ── LogRow ────────────────────────────────────────────────────────────────────

interface LogRowProps {
  record: DiagnosticRecord;
  cardBg: string;
  borderColor: string;
}

const LogRowComponent: React.FC<LogRowProps> = ({ record, cardBg, borderColor }) => {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLORS[record.severity] ?? '#6B7280';
  const rowBg = SEVERITY_BG[record.severity] ?? 'transparent';

  return (
    <TouchableOpacity
      onPress={() => setExpanded(v => !v)}
      style={[styles.logRow, { backgroundColor: rowBg, borderColor }]}
      activeOpacity={0.7}
    >
      <View style={styles.logRowHeader}>
        {/* Severity badge */}
        <View style={[styles.sevBadge, { backgroundColor: color + '22' }]}>
          <Text style={[styles.sevText, { color }]}>{record.severity[0]}</Text>
        </View>

        {/* Time + component */}
        <View style={styles.logMeta}>
          <Text style={[styles.logTime, { color: '#6B7280' }]} numberOfLines={1}>
            {record.timestampIso.slice(11, 23)}
          </Text>
          <Text style={[styles.logComponent, { color }]} numberOfLines={1}>
            {record.component}
            {record.pipelineStage ? ` [${record.pipelineStage}]` : ''}
          </Text>
        </View>

        {/* Handle badge */}
        {record.objectHandle != null && (
          <Text style={styles.handleBadge}>
            {'0x' + record.objectHandle.toString(16).toUpperCase().padStart(8, '0')}
          </Text>
        )}
      </View>

      {/* Message */}
      <Text
        style={[styles.logMessage, { color: '#D1D5DB' }]}
        numberOfLines={expanded ? undefined : 2}
      >
        {record.message}
      </Text>

      {/* Expanded: exception details */}
      {expanded && record.exceptionType && (
        <View style={[styles.exceptionBox, { borderLeftColor: SEVERITY_COLORS.ERROR }]}>
          <Text style={styles.exceptionTitle}>
            {record.exceptionType}: {record.exceptionMessage}
          </Text>
          {record.stackTrace && <Text style={styles.stackTrace}>{record.stackTrace}</Text>}
        </View>
      )}
    </TouchableOpacity>
  );
};

const LogRow = React.memo(LogRowComponent);
LogRow.displayName = 'LogRow';

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  title: { fontFamily: FONTS.syne.bold, fontSize: 16 },
  count: { fontFamily: FONTS.plusJakartaSans.medium, fontSize: 13, marginLeft: 2 },
  closeBtn: { padding: 4 },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterTabText: { fontFamily: FONTS.jetbrainsMono.semiBold, fontSize: 11 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  errorBannerText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 12,
    flex: 1,
  },

  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyText: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },

  logScroll: { flex: 1 },
  logContent: { paddingHorizontal: 8, paddingTop: 6, gap: 4 },

  logRow: {
    borderRadius: 6,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  logRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sevBadge: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sevText: { fontFamily: FONTS.jetbrainsMono.bold, fontSize: 10 },
  logMeta: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' },
  logTime: { fontFamily: FONTS.jetbrainsMono.semiBold, fontSize: 10 },
  logComponent: { fontFamily: FONTS.jetbrainsMono.semiBold, fontSize: 10, opacity: 0.8 },
  handleBadge: {
    fontFamily: FONTS.jetbrainsMono.semiBold,
    fontSize: 9,
    color: '#F59E0B',
    backgroundColor: 'rgba(245,158,11,0.12)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logMessage: {
    fontFamily: FONTS.plusJakartaSans.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  exceptionBox: {
    marginTop: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    gap: 4,
  },
  exceptionTitle: {
    fontFamily: FONTS.jetbrainsMono.semiBold,
    fontSize: 10,
    color: '#EF4444',
  },
  stackTrace: {
    fontFamily: FONTS.jetbrainsMono.semiBold,
    fontSize: 9,
    color: '#9CA3AF',
    lineHeight: 13,
  },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  toolBtnText: {
    fontFamily: FONTS.plusJakartaSans.medium,
    fontSize: 13,
  },
  toolDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
  },
});
