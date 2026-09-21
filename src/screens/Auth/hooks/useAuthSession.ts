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
// webClientId is REQUIRED: it tells Google to include an idToken in the
// sign-in result, which the Django backend (mobile_auth/views.py) verifies.
// ---------------------------------------------------------------------------
GoogleSignin.configure({
  webClientId: ENV.GOOGLE_WEB_CLIENT_ID,
  iosClientId: ENV.GOOGLE_IOS_CLIENT_ID ?? undefined,
  // androidClientId is NOT set here - it is determined automatically
  // from the SHA-1 fingerprint registered in Google Cloud Console.
  offlineAccess: false,
  scopes: ['profile', 'email'],
});

export interface AuthDebugInfo {
  step: string;
  code?: string | number;
  message?: string;
}

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
};

export const useAuthSession = () => {
  const { setAuthenticated } = useAuthStore();
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AuthErrorCode | null>(null);
  const [debugInfo, setDebugInfo] = useState<AuthDebugInfo | null>(null);
  const [canRetry, setCanRetry] = useState<boolean>(false);

  // Synchronous double-tap guard
  const isSigningInRef = useRef<boolean>(false);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
    setDebugInfo(null);
    setCanRetry(false);
  }, []);

  // On mount: no-op reference to Google's cached user.
  // Session restore is handled in RootNavigator via authService.checkAuthStatus().
  useEffect(() => {
    try {
      const currentUser = GoogleSignin.getCurrentUser();
      console.log(
        '[GoogleAuth] Current Google cached user on mount:',
        currentUser?.user?.email ?? 'None',
      );
    } catch (err) {
      console.warn('[GoogleAuth] Could not get current Google user on mount:', err);
    }
  }, []);

  const signIn = useCallback(async () => {
    if (isSigningInRef.current || isSigningIn) {
      console.warn('[GoogleAuth] Sign-in already in progress, ignoring duplicate trigger');
      return;
    }

    const startTime = Date.now();
    const elapsed = () => `+${Date.now() - startTime}ms`;

    isSigningInRef.current = true;
    clearError();
    setIsSigningIn(true);

    let currentStep = 'init';

    try {
      console.log(`[GoogleAuth ${elapsed()}] Flow started`);

      // Step 1: Check Play Services availability with 10s timeout
      currentStep = 'step1_hasPlayServices';
      console.log(
        `[GoogleAuth ${elapsed()}] Step 1: Checking Play Services availability (10s max)...`,
      );
      const playServicesAvailable = await withTimeout(
        GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }),
        10000,
        'Checking Google Play Services timed out after 10s',
      );
      console.log(
        `[GoogleAuth ${elapsed()}] Step 1: hasPlayServices result:`,
        playServicesAvailable,
      );

      // Step 2: Open native Google account picker with 30s timeout
      currentStep = 'step2_signIn';
      console.log(
        `[GoogleAuth ${elapsed()}] Step 2: Requesting GoogleSignin.signIn() (30s max)...`,
      );
      const response = await withTimeout(
        GoogleSignin.signIn(),
        30000,
        'Google account picker timed out after 30s',
      );
      console.log(
        `[GoogleAuth ${elapsed()}] Step 2: GoogleSignin.signIn() raw response:`,
        JSON.stringify(response, null, 2),
      );

      if (isCancelledResponse(response)) {
        console.log(
          `[GoogleAuth ${elapsed()}] User dismissed account picker (isCancelledResponse = true)`,
        );
        return;
      }

      if (!isSuccessResponse(response)) {
        console.error(
          `[GoogleAuth ${elapsed()}] Google Sign-in returned non-success response:`,
          response,
        );
        setError('Google sign-in was unsuccessful. Please try again.');
        setErrorCode('AUTH_FAILED');
        setDebugInfo({
          step: currentStep,
          message: 'Google Sign-in returned non-success response: ' + JSON.stringify(response),
        });
        setCanRetry(true);
        return;
      }

      // Step 3: Extract idToken and user profile
      currentStep = 'step3_extractIdToken';
      const { idToken } = response.data;
      const userInfo = response.data.user;

      console.log(`[GoogleAuth ${elapsed()}] Step 3: idToken extraction:`, {
        hasIdToken: !!idToken,
        idTokenLength: idToken?.length ?? 0,
        idTokenPreview: idToken ? `${idToken.substring(0, 20)}...` : null,
        user: userInfo,
      });

      if (!idToken) {
        throw new Error(
          'Google sign-in succeeded but returned an empty idToken. Ensure webClientId is valid.',
        );
      }

      // Steps 4 & 5: Backend exchange and SecureStore write handled in authService
      currentStep = 'step4_and_step5_backendExchange';
      console.log(
        `[GoogleAuth ${elapsed()}] Step 4 & 5: Initiating backend exchange with Django...`,
      );
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

      console.log(`[GoogleAuth ${elapsed()}] Backend exchange result:`, result);

      // Step 6: Update auth store
      currentStep = 'step6_authStoreUpdate';
      if (result.success && result.user && result.token) {
        console.log(
          `[GoogleAuth ${elapsed()}] Step 6: Auth successful, transitioning Zustand store...`,
        );
        setAuthenticated(true, result.token, result.user);
        console.log(
          `[GoogleAuth ${elapsed()}] Step 6: Zustand store updated to isAuthenticated = true`,
        );
      } else {
        console.error(`[GoogleAuth ${elapsed()}] Backend returned failure result:`, result);
        setError(result.error || "Couldn't sign you in. Please try again.");
        setErrorCode(result.code || 'AUTH_FAILED');
        setDebugInfo({
          step: currentStep,
          code: result.code,
          message: result.error,
        });
        setCanRetry(Boolean(result.canRetry));
      }
    } catch (err: unknown) {
      console.error(`🚨 [GoogleAuth ${elapsed()}] Error thrown at ${currentStep}:`, err);

      if (isErrorWithCode(err)) {
        console.error(`[GoogleAuth ${elapsed()}] Native error details:`, {
          code: err.code,
          message: err.message,
        });

        switch (err.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            console.log(`[GoogleAuth ${elapsed()}] Sign-in cancelled by user`);
            clearError();
            break;

          case statusCodes.IN_PROGRESS:
            console.warn(`[GoogleAuth ${elapsed()}] Sign-in already in progress`);
            break;

          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            setError(
              'Google Play Services is not available on this device. Please update Play Services and try again.',
            );
            setErrorCode('AUTH_FAILED');
            setDebugInfo({
              step: currentStep,
              code: err.code,
              message: 'PLAY_SERVICES_NOT_AVAILABLE',
            });
            setCanRetry(true);
            break;

          case statusCodes.SIGN_IN_REQUIRED:
            setError('Please sign in with your Google account.');
            setErrorCode('AUTH_FAILED');
            setDebugInfo({
              step: currentStep,
              code: err.code,
              message: 'SIGN_IN_REQUIRED',
            });
            setCanRetry(true);
            break;

          default:
            if ((err as any).code === 10 || String(err.code) === '10') {
              setError(
                'Configuration error (code 10). This is usually a SHA-1 fingerprint mismatch in Google Cloud Console. Check that your debug SHA-1 is registered.',
              );
              setDebugInfo({
                step: currentStep,
                code: 10,
                message:
                  'DEVELOPER_ERROR (code 10): OAuth package name / SHA-1 fingerprint mismatch',
              });
            } else {
              setError(
                `Google sign-in error (code ${err.code}): ${err.message || 'Unknown error'}`,
              );
              setDebugInfo({
                step: currentStep,
                code: err.code,
                message: err.message,
              });
            }
            setErrorCode('AUTH_FAILED');
            setCanRetry(true);
        }
      } else {
        const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
        const isNetworkError =
          message.toLowerCase().includes('network') || message.toLowerCase().includes('connection');
        setError(isNetworkError ? 'Network error. Check your connection and try again.' : message);
        setErrorCode(isNetworkError ? 'NETWORK_ERROR' : 'AUTH_FAILED');
        setDebugInfo({
          step: currentStep,
          message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        setCanRetry(true);
      }
    } finally {
      isSigningInRef.current = false;
      setIsSigningIn(false);
      console.log(
        `[GoogleAuth ${elapsed()}] Flow completed at: ${currentStep} (total: ${Date.now() - startTime}ms)`,
      );
    }
  }, [clearError, isSigningIn, setAuthenticated]);

  return {
    signIn,
    isLoading: isSigningIn,
    error,
    errorCode,
    debugInfo,
    canRetry,
    clearError,
  } as const;
};
