export const ENV = {
  APP_ENV: process.env.EXPO_PUBLIC_APP_ENV || 'development',
  API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://api.example.com',
  GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
  GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
  USE_MOCK_AUTH: process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true',
  IS_DEV: (process.env.EXPO_PUBLIC_APP_ENV || 'development') === 'development',
  IS_PROD: process.env.EXPO_PUBLIC_APP_ENV === 'production',
} as const;

// Production safeguard: Prevent mock auth from ever running in production runtime
if (ENV.IS_PROD && ENV.USE_MOCK_AUTH) {
  throw new Error('[FATAL] EXPO_PUBLIC_USE_MOCK_AUTH cannot be true in a production build!');
}

export type EnvConfig = typeof ENV;
