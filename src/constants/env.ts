export const ENV = {
  APP_ENV: process.env.EXPO_PUBLIC_APP_ENV || 'development',
  API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://api.example.com',
  REDIRECT_URL: process.env.EXPO_PUBLIC_REDIRECT_URL || 'https://staging.entephoto.co.in',
  GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
  GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
  IS_DEV: (process.env.EXPO_PUBLIC_APP_ENV || 'development') === 'development',
  IS_PROD: process.env.EXPO_PUBLIC_APP_ENV === 'production',
} as const;

export type EnvConfig = typeof ENV;
