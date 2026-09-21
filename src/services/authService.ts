import { UserProfile, useAuthStore } from '@/store/authStore';
import { storageService } from './storageService';
import { ENV } from '@/constants/env';
import { API_ENDPOINTS } from '@/config/api.config';

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
   * Checks stored credentials on app startup.
   */
  async checkAuthStatus(): Promise<{
    isAuthenticated: boolean;
    token: string | null;
    user: UserProfile | null;
  }> {
    try {
      console.log('[authService:checkAuthStatus] Checking stored credentials in SecureStore...');
      const storedToken = await storageService.getSessionToken();
      const storedUser = await storageService.getUserData<UserProfile>();

      if (!storedToken || !storedUser) {
        console.log('[authService:checkAuthStatus] No active session found.');
        return { isAuthenticated: false, token: null, user: null };
      }

      console.log('[authService:checkAuthStatus] Active session restored for:', storedUser.email);
      return { isAuthenticated: true, token: storedToken, user: storedUser };
    } catch (error) {
      console.error('[authService:checkAuthStatus] Error retrieving stored session:', error);
      return { isAuthenticated: false, token: null, user: null };
    }
  },

  /**
   * Exchanges Google ID Token with the Django backend.
   *
   * Endpoint: POST /mobile/auth/google/
   * Payload:  { id_token: string }
   * Response: { access, refresh, photographer: { id, email, name, picture } }
   */
  async handleGoogleAuthSuccess(params: {
    idToken?: string | null;
    accessToken?: string | null;
    userProfile?: Partial<UserProfile> | null;
  }): Promise<AuthResult> {
    const { idToken } = params;

    if (!idToken) {
      console.error('[authService:handleGoogleAuthSuccess] Error: No ID token provided in params');
      return {
        success: false,
        error: 'No ID token received from Google. Please try again.',
        code: 'AUTH_FAILED',
        canRetry: true,
      };
    }

    const exchangeStart = Date.now();
    const elapsed = () => `+${Date.now() - exchangeStart}ms`;

    const endpointUrl = `${ENV.API_URL}${API_ENDPOINTS.AUTH.GOOGLE_SIGN_IN}`;
    const payload = { id_token: idToken };

    console.log(
      `[authService:handleGoogleAuthSuccess ${elapsed()}] Step 4: Dispatching backend auth request:`,
      {
        endpoint: endpointUrl,
        payload: { id_token: `${idToken.substring(0, 15)}...[length: ${idToken.length}]` },
      },
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(
        `[authService:handleGoogleAuthSuccess ${elapsed()}] Step 4: Backend responded with HTTP status:`,
        response.status,
      );

      const rawResponseText = await response.text();
      console.log(
        `[authService:handleGoogleAuthSuccess ${elapsed()}] Step 4: Raw response body:`,
        rawResponseText,
      );

      let data: any;
      try {
        data = JSON.parse(rawResponseText);
      } catch (parseErr) {
        console.error(
          `[authService:handleGoogleAuthSuccess ${elapsed()}] Failed to parse backend JSON response:`,
          parseErr,
        );
        return {
          success: false,
          error: `Server error (${response.status}). Could not parse response.`,
          code: 'AUTH_FAILED',
          canRetry: true,
        };
      }

      if (!response.ok) {
        const detail =
          data?.detail ||
          data?.error ||
          data?.message ||
          `Authentication failed (status ${response.status}).`;
        console.error(
          `[authService:handleGoogleAuthSuccess ${elapsed()}] Backend rejected authentication:`,
          detail,
        );
        return {
          success: false,
          error: detail,
          code: 'AUTH_FAILED',
          canRetry: true,
        };
      }

      console.log(
        `[authService:handleGoogleAuthSuccess ${elapsed()}] Response payload keys:`,
        Object.keys(data || {}),
      );

      // Django response shape:
      // { access, refresh, photographer: { id, email, name, picture } }
      const sessionToken: string | undefined =
        data.access ||
        data.access_token ||
        data.token ||
        data.tokens?.access ||
        data.tokens?.access_token ||
        data.jwt;

      const refreshToken: string | undefined =
        data.refresh || data.refresh_token || data.tokens?.refresh;

      const photographer = data.photographer || data.user || data.profile;

      console.log(`[authService:handleGoogleAuthSuccess ${elapsed()}] Extracted Auth Data:`, {
        hasAccessToken: Boolean(sessionToken),
        accessTokenLength: sessionToken ? sessionToken.length : 0,
        accessTokenPrefix: sessionToken ? `${sessionToken.substring(0, 15)}...` : null,
        hasRefreshToken: Boolean(refreshToken),
        hasPhotographer: Boolean(photographer),
        photographerEmail: photographer?.email,
      });

      if (!sessionToken || !photographer) {
        console.error(
          `[authService:handleGoogleAuthSuccess ${elapsed()}] Invalid payload from server (missing access token or photographer):`,
          data,
        );
        return {
          success: false,
          error: 'Invalid response received from server. Missing access token.',
          code: 'AUTH_FAILED',
          canRetry: true,
        };
      }

      const user: UserProfile = {
        id: String(photographer.id || photographer._id || ''),
        email: photographer.email || '',
        name: photographer.name || photographer.username || photographer.email || 'Photographer',
        photoUrl: photographer.picture || photographer.avatarUrl || photographer.photo || undefined,
      };

      console.log(
        `[authService:handleGoogleAuthSuccess ${elapsed()}] Step 5: Writing token to SecureStore (length: ` +
          sessionToken.length +
          ', prefix: ' +
          sessionToken.substring(0, 15) +
          ') for user: ' +
          user.email,
      );

      await storageService.setSessionToken(sessionToken);
      if (refreshToken) {
        await storageService.setRefreshToken(refreshToken);
      }
      await storageService.setUserData(user);
      console.log(
        `[authService:handleGoogleAuthSuccess ${elapsed()}] Step 5: SecureStore write complete`,
      );

      return { success: true, user, token: sessionToken };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort = err?.name === 'AbortError' || err?.message?.includes('aborted');
      const message: string = isAbort ? 'Request timed out after 30s' : (err?.message ?? '');
      const isNetworkError =
        isAbort ||
        message.toLowerCase().includes('network') ||
        message.toLowerCase().includes('fetch') ||
        message.toLowerCase().includes('connection');

      console.error(
        `[authService:handleGoogleAuthSuccess ${elapsed()}] Network/fetch error during backend auth:`,
        err,
      );

      return {
        success: false,
        error: isNetworkError
          ? 'Network error. Check your connection and try again.'
          : "Couldn't sign you in. Please try again.",
        code: isNetworkError ? 'NETWORK_ERROR' : 'AUTH_FAILED',
        canRetry: true,
      };
    }
  },

  /**
   * Refreshes the session access token using the stored refresh token.
   */
  async refreshToken(): Promise<string | null> {
    try {
      const storedRefreshToken = await storageService.getRefreshToken();
      if (!storedRefreshToken) {
        console.warn('[authService:refreshToken] No refresh token available in SecureStore');
        return null;
      }

      const endpoint = `${ENV.API_URL}${API_ENDPOINTS.AUTH.REFRESH_TOKEN}`;
      console.log('[authService:refreshToken] Refreshing token at:', endpoint);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh: storedRefreshToken }),
      });

      console.log('[authService:refreshToken] Response status:', res.status);
      if (!res.ok) {
        console.error('[authService:refreshToken] Failed with status:', res.status);
        return null;
      }

      const data = await res.json();
      const newAccessToken: string = data.access;
      const newRefreshToken: string | undefined = data.refresh;

      if (newAccessToken) {
        await storageService.setSessionToken(newAccessToken);
        if (newRefreshToken) {
          await storageService.setRefreshToken(newRefreshToken);
        }
        const currentUser = useAuthStore.getState().user;
        useAuthStore.getState().setAuthenticated(true, newAccessToken, currentUser);
        console.log('[authService:refreshToken] Token refreshed successfully');
        return newAccessToken;
      }
      return null;
    } catch (error) {
      console.error('[authService:refreshToken] Exception while refreshing token:', error);
      return null;
    }
  },

  /**
   * Signs out the user. Clears the Google native session and all on-device tokens.
   */
  async signOut(): Promise<void> {
    try {
      console.log('[authService:signOut] Signing out of native Google Sign-In...');
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut();
      console.log('[authService:signOut] GoogleSignin.signOut() succeeded');
    } catch (error) {
      console.error('[authService:signOut] Error during Google native signOut:', error);
    }
    await storageService.clearAll();
  },
};
