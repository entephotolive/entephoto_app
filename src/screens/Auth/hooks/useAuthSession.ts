import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
  isSuccessResponse,
  isCancelledResponse,
} from '@react-native-google-signin/google-signin';
import { useAuthStore } from '@/store/authStore';
import { authService, AuthErrorCode } from '@/services/authService';
import { ENV } from '@/constants/env';

// ---------------------------------------------------------------------------
// Configure GoogleSignin once.
// This is synchronous and cheap — safe to call on every hook mount.
// webClientId is REQUIRED: it is what causes Google to include an idToken
// in the sign-in result, which your backend uses to verify the user.
// ---------------------------------------------------------------------------
GoogleSignin.configure({
  webClientId: ENV.GOOGLE_WEB_CLIENT_ID,
  iosClientId: ENV.GOOGLE_IOS_CLIENT_ID ?? undefined,
  // androidClientId is NOT set here — it is determined automatically from
  // the SHA-1 fingerprint registered in Google Cloud Console.
  offlineAccess: false,
  scopes: ['profile', 'email'],
});

export const useAuthSession = () => {
  const { setAuthenticated, setLoading, isLoading } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AuthErrorCode | null>(null);
  const [canRetry, setCanRetry] = useState<boolean>(false);

  // Synchronous double-tap guard
  const isSigningInRef = useRef<boolean>(false);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setCanRetry(false);
  }, []);

  // On mount: restore session if the user was already signed in to Google
  // and we have a stored token. GoogleSignin.getCurrentUser() is synchronous.
  useEffect(() => {
    const currentGoogleUser = GoogleSignin.getCurrentUser();
    // If Google still has a session locally, authService.checkAuthStatus()
    // will find the stored session token and rehydrate the auth store.
    // This is handled in RootNavigator already — no need to duplicate here.
    void currentGoogleUser; // intentional no-op reference to avoid lint warning
  }, []);

  const signIn = useCallback(async () => {
    if (isSigningInRef.current || isLoading) return;

    // -----------------------------------------------------------
    // [MOCK AUTH] - Active when EXPO_PUBLIC_USE_MOCK_AUTH=true
    // Set to false in .env before testing real Google Sign-In.
    // -----------------------------------------------------------
    if (ENV.USE_MOCK_AUTH) {
      setLoading(true);
      clearError();
      try {
        const result = await authService.signInWithGoogleMock();
        if (result.success && result.user && result.token) {
          setAuthenticated(true, result.token, result.user);
        } else {
          setError(result.error || 'Mock sign-in failed.');
          setErrorCode(result.code || 'AUTH_FAILED');
        }
      } catch (err: any) {
        setError(err?.message || 'Mock sign-in failed.');
        setErrorCode('AUTH_FAILED');
      } finally {
        setLoading(false);
      }
      return;
    }
    // -----------------------------------------------------------
    // [END MOCK AUTH]
    // -----------------------------------------------------------

    isSigningInRef.current = true;
    clearError();
    setLoading(true);

    try {
      // Check Play Services availability first (required on Android)
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Open the native Google account picker
      const response = await GoogleSignin.signIn();

      if (isCancelledResponse(response)) {
        // User dismissed the picker — silent reset, no error shown
        return;
      }

      if (!isSuccessResponse(response)) {
        setError('Google sign-in was unsuccessful. Please try again.');
        setErrorCode('AUTH_FAILED');
        setCanRetry(true);
        return;
      }

      const { idToken } = response.data;
      const userInfo = response.data.user;

      // Send idToken to your backend (POST /api/v1/auth/google)
      const result = await authService.handleGoogleAuthSuccess({
        idToken,
        accessToken: null,
        userProfile: {
          id: userInfo.id,
          email: userInfo.email,
          name: userInfo.name ?? undefined,
          photoUrl: userInfo.photo ?? undefined,
        },
      });

      if (result.success && result.user && result.token) {
        setAuthenticated(true, result.token, result.user);
      } else {
        setError(result.error || "Couldn't sign you in. Please try again.");
        setErrorCode(result.code || 'AUTH_FAILED');
        setCanRetry(Boolean(result.canRetry));
      }
    } catch (err: unknown) {
      if (isErrorWithCode(err)) {
        switch (err.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            // User pressed back — silent, no error banner
            clearError();
            break;

          case statusCodes.IN_PROGRESS:
            // Another sign-in already in flight — ignore
            break;

          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            setError(
              'Google Play Services is not available on this device. Please update Play Services and try again.',
            );
            setErrorCode('AUTH_FAILED');
            setCanRetry(true);
            break;

          case statusCodes.SIGN_IN_REQUIRED:
            // Silent sign-in failed (expected on first launch) — show picker
            setError('Please sign in with your Google account.');
            setErrorCode('AUTH_FAILED');
            setCanRetry(true);
            break;

          default:
            // code 10 = DEVELOPER_ERROR — almost always a SHA-1 mismatch.
            // See: https://rnfirebase.io/auth/social-auth#google — same root cause.
            if ((err as any).code === 10 || String(err.code) === '10') {
              setError(
                'Configuration error (code 10). This is usually a SHA-1 fingerprint mismatch in Google Cloud Console. Check that your debug SHA-1 is registered.',
              );
            } else {
              setError(`Google sign-in error (code ${err.code}). Please try again.`);
            }
            setErrorCode('AUTH_FAILED');
            setCanRetry(true);
        }
      } else {
        // Non-Google error (network failure, etc.)
        const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
        const isNetworkError =
          message.toLowerCase().includes('network') || message.toLowerCase().includes('connection');
        setError(isNetworkError ? 'Network error. Check your connection and try again.' : message);
        setErrorCode(isNetworkError ? 'NETWORK_ERROR' : 'AUTH_FAILED');
        setCanRetry(true);
      }
    } finally {
      isSigningInRef.current = false;
      setLoading(false);
    }
  }, [clearError, isLoading, setAuthenticated, setLoading]);

  return {
    signIn,
    isLoading,
    error,
    errorCode,
    canRetry,
    clearError,
  } as const;
};
