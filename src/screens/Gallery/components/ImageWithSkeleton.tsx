import React, { useState, useEffect } from 'react';
import {
  View,
  Image,
  ImageProps,
  Animated,
  StyleSheet,
  StyleProp,
  ImageStyle,
  ViewStyle,
} from 'react-native';
import { useTheme } from '@/constants/theme';

interface ImageWithSkeletonProps extends Omit<ImageProps, 'style'> {
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Image component with an animated shimmer/pulse skeleton placeholder.
 * Prevents layout jumps while thumbnails are loading or Skia/ML Kit pipelines are executing.
 */
export const ImageWithSkeleton: React.FC<ImageWithSkeletonProps> = React.memo(
  ({ source, style, containerStyle, resizeMode = 'cover', ...restProps }) => {
    const { isDark } = useTheme();
    const [isLoaded, setIsLoaded] = useState(false);
    const [shimmerAnim] = useState(() => new Animated.Value(0.35));

    // Reset loaded state if uri changes (React pattern: adjust state on render, not via useEffect)
    const uriKey =
      typeof source === 'object' && source && 'uri' in source ? (source as any).uri : '';
    const [prevUri, setPrevUri] = useState(uriKey);
    if (prevUri !== uriKey) {
      setPrevUri(uriKey);
      setIsLoaded(false);
    }

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

        {/* Actual Image */}
        <Image
          source={source}
          style={[style, !isLoaded && styles.hiddenImage]}
          resizeMode={resizeMode}
          resizeMethod="resize"
          fadeDuration={0}
          onLoad={() => setIsLoaded(true)}
          onError={() => setIsLoaded(true)}
          {...restProps}
        />
      </View>
    );
  },
);

ImageWithSkeleton.displayName = 'ImageWithSkeleton';

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
