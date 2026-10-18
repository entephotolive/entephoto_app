import React, { useState, useEffect } from 'react';
import { View, Animated, StyleSheet, StyleProp, ViewStyle, Text } from 'react-native';
import { Image } from 'expo-image';
import type { ImageStyle, ImageContentFit } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { useTheme } from '@/constants/theme';

interface ImageWithSkeletonProps {
  /**
   * The image source. Must be an object with a `uri` string for local files.
   * e.g. `{ uri: 'file:///sdcard/DCIM/Entephoto/IMG_001.jpg' }`
   */
  source: { uri: string };
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Maps to expo-image's `contentFit` prop.
   * Kept as `resizeMode` for backward compatibility with all existing call sites.
   * @default 'cover'
   */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center' | 'none';
}

/** Maps React Native Image resizeMode to expo-image contentFit */
function resolveContentFit(resizeMode?: string): ImageContentFit {
  switch (resizeMode) {
    case 'contain':
      return 'contain';
    case 'stretch':
      return 'fill';
    case 'center':
      return 'scale-down';
    case 'none':
      return 'none';
    case 'cover':
    default:
      return 'cover';
  }
}

/**
 * Image component with an animated shimmer/pulse skeleton placeholder.
 * Prevents layout jumps while thumbnails are loading.
 *
 * Uses expo-image (Glide on Android) for decode-time downscaling
 * (allowDownscaling=true by default), which dramatically reduces native memory
 * usage compared to the core React Native Image component.
 *
 * When an image fails to decode (e.g. unsupported camera RAW like Sony .ARW),
 * it displays a clean format badge placeholder instead of a blank tile.
 */
export const ImageWithSkeleton: React.FC<ImageWithSkeletonProps> = ({
  source,
  style,
  containerStyle,
  resizeMode = 'cover',
}) => {
  const { isDark } = useTheme();
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [shimmerAnim] = useState(() => new Animated.Value(0.35));

  // Reset loaded & error state if uri changes (React pattern: adjust state on render, not via useEffect)
  const uriKey = source?.uri ?? '';
  const [prevUri, setPrevUri] = useState(uriKey);
  if (prevUri !== uriKey) {
    setPrevUri(uriKey);
    setIsLoaded(false);
    setHasError(false);
  }

  const extension = uriKey ? (uriKey.split('.').pop() || '').toUpperCase() : '';
  const displayFilename = uriKey ? decodeURIComponent(uriKey.split('/').pop() || '') : '';
  const isRawFormat = [
    'ARW',
    'CR2',
    'CR3',
    'CRW',
    'NEF',
    'NRW',
    'DNG',
    'RAW',
    'RW2',
    'ORF',
    'RAF',
    'SRW',
    'PEF',
    'HIF',
    'HEIC',
    'HEIF',
    'TIF',
    'TIFF',
  ].includes(extension);

  useEffect(() => {
    const filename = uriKey.split('/').pop() || 'unknown';
    console.log(`[Diagnostic] [MOUNT] ${filename}`);
    return () => {
      console.log(`[Diagnostic] [UNMOUNT] ${filename}`);
    };
  }, [uriKey]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 0.75,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    );

    if (!isLoaded && !hasError) {
      animation.start();
    } else {
      shimmerAnim.stopAnimation();
    }

    return () => {
      animation.stop();
    };
  }, [isLoaded, hasError, shimmerAnim]);

  return (
    <View style={[styles.container, containerStyle]}>
      {/* Skeleton Shimmer Overlay */}
      {!isLoaded && !hasError && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.skeletonBase,
            {
              backgroundColor: isDark ? '#27272F' : '#E8E2D8',
              opacity: shimmerAnim,
            },
          ]}
        />
      )}

      {/* Undecodable format placeholder (e.g. ARW RAW or corrupted image) */}
      {hasError ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.placeholderContainer,
            { backgroundColor: isDark ? '#1C1C22' : '#EAE4DC' },
          ]}
        >
          <ImageOff size={20} color={isDark ? '#8E8E93' : '#736B63'} strokeWidth={1.7} />
          <View
            style={[
              styles.formatBadge,
              { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)' },
            ]}
          >
            <Text style={[styles.formatBadgeText, { color: isDark ? '#F5F5F7' : '#1C1C22' }]}>
              {extension || 'RAW'}
            </Text>
          </View>
          <Text
            style={[styles.formatSubText, { color: isDark ? '#8E8E93' : '#736B63' }]}
            numberOfLines={1}
          >
            {isRawFormat ? 'RAW format' : 'No preview'}
          </Text>
          {displayFilename ? (
            <Text
              style={[styles.filenameSubText, { color: isDark ? '#8E8E93' : '#736B63' }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {displayFilename}
            </Text>
          ) : null}
        </View>
      ) : (
        /* expo-image — performs decode-time downscaling via Glide on Android */
        <Image
          source={source}
          style={[style, !isLoaded && styles.hiddenImage]}
          contentFit={resolveContentFit(resizeMode)}
          allowDownscaling={true}
          cachePolicy="memory-disk"
          onLoadStart={() => {
            console.log(`[Diagnostic] Load Start | URI: ${uriKey.split('/').pop()}`);
            setIsLoaded(false);
            setHasError(false);
          }}
          onLoad={event => {
            console.log(
              `[Diagnostic] Load Complete | URI: ${uriKey.split('/').pop()} | Cache: ${event.cacheType}`,
            );
            setIsLoaded(true);
            setHasError(false);
          }}
          onError={() => {
            console.log(
              `[Diagnostic] Load Error (undecodable or missing) | URI: ${uriKey.split('/').pop()}`,
            );
            setIsLoaded(true);
            setHasError(true);
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  skeletonBase: {
    zIndex: 1,
  },
  hiddenImage: {
    opacity: 0,
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
    zIndex: 2,
  },
  formatBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 3,
  },
  formatBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  formatSubText: {
    fontSize: 8,
    marginTop: 2,
    fontWeight: '500',
  },
  filenameSubText: {
    fontSize: 7.5,
    marginTop: 2,
    fontWeight: '400',
    paddingHorizontal: 4,
    textAlign: 'center',
    maxWidth: '100%',
  },
});
