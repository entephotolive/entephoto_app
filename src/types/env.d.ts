declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_APP_ENV: 'development' | 'staging' | 'production';
    readonly EXPO_PUBLIC_API_URL: string;
    readonly EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: string;
    readonly EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;
    readonly EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?: string;
    readonly EXPO_PUBLIC_REDIRECT_URL?: string;
  }
}

declare module '*.css' {
  const content: any;
  export default content;
}
