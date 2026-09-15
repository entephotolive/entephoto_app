import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  // Build-time production safeguard:
  // Throws build error if EXPO_PUBLIC_USE_MOCK_AUTH is enabled during a production build
  const isEasProduction = process.env.EAS_BUILD_PROFILE === 'production';
  const isAppEnvProduction = process.env.EXPO_PUBLIC_APP_ENV === 'production';
  const isMockAuth = process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true';

  if ((isEasProduction || isAppEnvProduction) && isMockAuth) {
    throw new Error(
      '❌ [FATAL BUILD ERROR] EXPO_PUBLIC_USE_MOCK_AUTH is set to "true" in a production build! Mock authentication must never be shipped to production.',
    );
  }

  return {
    ...config,
    name: config.name ?? 'Ente Photo',
    slug: config.slug ?? 'entephoto-mobile',
    plugins: [
      ...(Array.isArray(config.plugins) ? config.plugins : []),
      '@react-native-google-signin/google-signin',
    ],
  };
};
