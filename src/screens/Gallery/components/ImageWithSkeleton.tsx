import React, { useState, useEffect } from 'react';
import { View, Animated, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import type { ImageStyle, ImageContentFit } from 'expo-image';
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
 */
export const ImageWithSkeleton: React.FC<ImageWithSkeletonProps> = ({
  source,
  style,
  containerStyle,
  resizeMode = 'cover',
}) => {
  const { isDark } = useTheme();
  const [isLoaded, setIsLoaded] = useState(false);
  const [shimmerAnim] = useState(() => new Animated.Value(0.35));

  // Reset loaded state if uri changes (React pattern: adjust state on render, not via useEffect)
  const uriKey = source?.uri ?? '';
  const [prevUri, setPrevUri] = useState(uriKey);
  if (prevUri !== uriKey) {
    setPrevUri(uriKey);
    setIsLoaded(false);
  }

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

    if (!isLoaded) {
      animation.start();
    } else {
      shimmerAnim.stopAnimation();
    }

    return () => {
      animation.stop();
    };
  }, [isLoaded, shimmerAnim]);

  return (
    <View style={[styles.container, containerStyle]}>
      {/* Skeleton Shimmer Overlay */}
      {!isLoaded && (
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

      {/* expo-image — performs decode-time downscaling via Glide on Android */}
      <Image
        source={source}
        style={[style, !isLoaded && styles.hiddenImage]}
        contentFit={resolveContentFit(resizeMode)}
        allowDownscaling={true}
        cachePolicy="memory-disk"
        onLoadStart={() => {
          console.log(`[Diagnostic] Load Start | URI: ${uriKey.split('/').pop()}`);
          setIsLoaded(false);
        }}
        onLoad={event => {
          console.log(
            `[Diagnostic] Load Complete | URI: ${uriKey.split('/').pop()} | Cache: ${event.cacheType}`,
          );
          setIsLoaded(true);
        }}
        onError={() => setIsLoaded(true)}
      />
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
});
