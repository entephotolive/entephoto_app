// src/config/api.config.ts

export const ENV = {
  API_BASE_URL: process.env.EXPO_PUBLIC_API_URL || 'https://staging.entephoto.co.in/api',
  GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  TIMEOUT_MS: 15000,
};

/**
 * Centralized API Endpoints
 */
export const API_ENDPOINTS = {
  AUTH: {
    GOOGLE_SIGN_IN: '/mobile/auth/google/',
    REFRESH_TOKEN: '/mobile/auth/token/refresh/',
  },
  EVENTS: {
    EVENTS: '/mobile/events/',
    EVENT_DETAILS: (eventId: string) => `/event/${eventId}/`,
  },
  PHOTOS: {
    UPLOAD: '/upload-images/',
    SCAN_FACE: '/scan-face/',
    MY_PHOTOS: '/my-photos/',
  },
  SYSTEM: {
    HEALTH: '/health/',
  },
} as const;

export const GOOGLE_AUTH_API_URL = `${ENV.API_BASE_URL}${API_ENDPOINTS.AUTH.GOOGLE_SIGN_IN}`;
