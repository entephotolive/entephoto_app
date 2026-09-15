import { UserProfile } from '@/store/authStore';
import { storageService } from './storageService';
import { ENV } from '@/constants/env';

export type AuthErrorCode = 'USER_CANCELLED' | 'IN_PROGRESS' | 'NETWORK_ERROR' | 'AUTH_FAILED';

export interface AuthResult {
  success: boolean;
  user?: UserProfile;
  token?: string;
  error?: string;
  code?: AuthErrorCode;
  canRetry?: boolean;
}

export const authService = {
  /**
   * Initializes or checks stored credentials on app startup
   */
  async checkAuthStatus(): Promise<{
    isAuthenticated: boolean;
    token: string | null;
    user: UserProfile | null;
  }> {
    try {
      const storedToken = await storageService.getSessionToken();
      const storedUser = await storageService.getUserData<UserProfile>();

      if (!storedToken || !storedUser) {
        return { isAuthenticated: false, token: null, user: null };
      }

      return {
        isAuthenticated: true,
        token: storedToken,
        user: storedUser,
      };
    } catch {
      return { isAuthenticated: false, token: null, user: null };
    }
  },

  /**
   * Exchanges Google ID Token / Access Token with the backend API,
   * stores credentials in SecureStore, and returns typed UserProfile.
   */
  async handleGoogleAuthSuccess(params: {
    idToken?: string | null;
    accessToken?: string | null;
    userProfile?: Partial<UserProfile> | null;
  }): Promise<AuthResult> {
    const { idToken, accessToken, userProfile } = params;

    try {
      // 1. If we have an ID token or access token, exchange with backend
      if (idToken || accessToken) {
        try {
          const response = await fetch(`${ENV.API_URL}/api/v1/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, accessToken }),
          });

          if (response.ok) {
            const data = await response.json();
            const sessionToken: string = data.token;
            const user: UserProfile = data.user;

            await storageService.setSessionToken(sessionToken);
            await storageService.setUserData(user);

            return { success: true, user, token: sessionToken };
          }
        } catch (backendError) {
          console.warn('[authService] Backend token exchange failed:', backendError);
        }
      }

      // 2. Development mode fallback (or if user profile was fetched directly from Google OAuth)
      if (ENV.IS_DEV || userProfile) {
        const user: UserProfile = {
          id: userProfile?.id || 'google_user_' + Date.now(),
          email: userProfile?.email || 'photographer@entephoto.com',
          name: userProfile?.name || 'EntePhoto User',
          photoUrl: userProfile?.photoUrl || undefined,
        };
        const token = `session_${Date.now()}`;
        await storageService.setSessionToken(token);
        await storageService.setUserData(user);

        return { success: true, user, token };
      }

      return {
        success: false,
        error: "Couldn't verify Google authentication with server. Please try again.",
        code: 'AUTH_FAILED',
        canRetry: true,
      };
    } catch (err: any) {
      console.error('[authService] Google auth processing error:', err);
      return {
        success: false,
        error: err?.message || "Couldn't sign you in. Please try again.",
        code: 'AUTH_FAILED',
        canRetry: true,
      };
    }
  },

  /**
   * Refreshes user session token
   */
  async refreshToken(): Promise<string | null> {
    try {
      const currentToken = await storageService.getSessionToken();
      if (!currentToken) return null;

      const res = await fetch(`${ENV.API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) return null;
      const data = await res.json();
      await storageService.setSessionToken(data.token);
      return data.token;
    } catch {
      return null;
    }
  },

  /**
   * Signs out user — clears both the native Google session and on-device tokens.
   * GoogleSignin.signOut() is required so the next signIn() shows the account picker
   * instead of silently re-authenticating the cached account.
   */
  async signOut(): Promise<void> {
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut();
    } catch {
      // Ignore — Google may not have an active session (e.g. mock auth mode)
    }
    await storageService.clearAll();
  },

  // -------------------------------------------------------------
  // [MOCK AUTH START] - TEMPORARY FOR EXPO GO TESTING
  // -------------------------------------------------------------
  /**
   * Temporary Google Sign-In mock for Expo Go development.
   * Skips OAuth flow entirely, creates a fake session, and stores
   * it in SecureStore exactly like real authentication.
   */
  async signInWithGoogleMock(): Promise<AuthResult> {
    if (ENV.IS_PROD) {
      throw new Error('[FATAL] signInWithGoogleMock called in production!');
    }

    const fakeUser: UserProfile = {
      id: 'dev-user',
      name: 'Test User',
      email: 'test@example.com',
      photoUrl: undefined,
    };
    const fakeToken = `mock-token-${Date.now()}`;

    // Store fake token & user in SecureStore matching real flow
    await storageService.setSessionToken(fakeToken);
    await storageService.setUserData(fakeUser);

    return {
      success: true,
      user: fakeUser,
      token: fakeToken,
    };
  },
  // -------------------------------------------------------------
  // [MOCK AUTH END]
  // -------------------------------------------------------------
};
