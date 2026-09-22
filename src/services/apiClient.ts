import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { storageService } from './storageService';
import { ENV, API_ENDPOINTS } from '../config/api.config';
import { useAuthStore } from '../store/authStore';

export const apiClient: AxiosInstance = axios.create({
  baseURL: ENV.API_BASE_URL,
  timeout: ENV.TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Multipart fix: when the request body is a FormData object, remove the
// Content-Type default so the React Native native HTTP bridge can inject the
// correct `multipart/form-data; boundary=<uuid>` value automatically.
// Without this, the global `application/json` default persists and either
// the server rejects it or the native layer fails to set the boundary.
apiClient.interceptors.request.use(config => {
  if (config.data instanceof FormData) {
    // Delete via the AxiosHeaders API (Axios 1.x) and the plain object path
    if (typeof config.headers?.delete === 'function') {
      config.headers.delete('Content-Type');
    } else if (config.headers) {
      delete (config.headers as Record<string, unknown>)['Content-Type'];
    }
  }
  return config;
});

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let isRefreshing = false;
let failedQueue: {
  resolve: (token: string) => void;
  reject: (error: any) => void;
}[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Request Interceptor: Attach JWT Bearer Token
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      // 1. Check persistent SecureStore
      let token = await storageService.getSessionToken();

      // 2. Fallback to active in-memory store token if SecureStore is pending
      if (!token) {
        token = useAuthStore.getState().token;
        if (token) {
          console.log('[apiClient:interceptor] Using in-memory fallback token from authStore');
        }
      }

      if (token && config.headers) {
        const authHeader = `Bearer ${token}`;
        if (typeof config.headers.set === 'function') {
          config.headers.set('Authorization', authHeader);
        }
        config.headers.Authorization = authHeader;
        config.headers['Authorization'] = authHeader;

        console.log(`[apiClient:interceptor] -> ${config.method?.toUpperCase()} ${config.url}`, {
          headerName: 'Authorization',
          headerScheme: 'Bearer',
          tokenLength: token.length,
          headerPreview: `Bearer ${token.substring(0, 10)}...${token.substring(token.length - 6)}`,
          fullHeaderSet: true,
        });
      } else {
        console.warn(
          `[apiClient:interceptor] ⚠️ NO TOKEN AVAILABLE for ${config.method?.toUpperCase()} ${config.url}. Request dispatched without Authorization header.`,
        );
      }
    } catch (error) {
      console.error('[apiClient:interceptor] Error attaching token to request:', error);
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// Response Interceptor: Global Error, Debug Logging & Silent Token Refresh
apiClient.interceptors.response.use(
  response => {
    console.log(
      `[apiClient:response] <- ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`,
    );
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as CustomAxiosRequestConfig;

    console.error(
      `[apiClient:response:error] <- ${error.response?.status || 'NO_STATUS'} ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}:`,
      error.response?.data || error.message,
    );

    const isAuthError = error.response?.status === 401;
    const isRefreshCall = originalRequest?.url?.includes(API_ENDPOINTS.AUTH.REFRESH_TOKEN);
    const isLoginCall = originalRequest?.url?.includes(API_ENDPOINTS.AUTH.GOOGLE_SIGN_IN);

    // On 401: attempt token refresh transparently
    if (
      isAuthError &&
      originalRequest &&
      !originalRequest._retry &&
      !isRefreshCall &&
      !isLoginCall
    ) {
      if (isRefreshing) {
        console.log(
          '[apiClient:refresh] Queueing request while token refresh is in flight:',
          originalRequest.url,
        );
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((newToken: string) => {
            if (originalRequest.headers) {
              const authHeader = `Bearer ${newToken}`;
              if (typeof originalRequest.headers.set === 'function') {
                originalRequest.headers.set('Authorization', authHeader);
              }
              originalRequest.headers.Authorization = authHeader;
              originalRequest.headers['Authorization'] = authHeader;
            }
            return apiClient(originalRequest);
          })
          .catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const storedRefreshToken = await storageService.getRefreshToken();
        if (!storedRefreshToken) {
          console.warn('[apiClient:refresh] No refresh token in SecureStore. Logging out.');
          processQueue(new Error('No refresh token available'), null);
          await storageService.clearAll();
          useAuthStore.getState().logout();
          return Promise.reject(error);
        }

        console.log('[apiClient:refresh] Calling refresh token endpoint...');
        const refreshEndpoint = `${ENV.API_BASE_URL}${API_ENDPOINTS.AUTH.REFRESH_TOKEN}`;

        // Raw Axios POST to avoid interceptor loop
        const refreshResponse = await axios.post(
          refreshEndpoint,
          { refresh: storedRefreshToken },
          { headers: { 'Content-Type': 'application/json' }, timeout: ENV.TIMEOUT_MS },
        );

        const newAccessToken = refreshResponse.data?.access;
        const newRefreshToken = refreshResponse.data?.refresh;

        if (!newAccessToken) {
          throw new Error('Refresh response missing access token');
        }

        console.log(
          '[apiClient:refresh] Token refreshed successfully! Persisting new credentials...',
        );
        await storageService.setSessionToken(newAccessToken);
        if (newRefreshToken) {
          await storageService.setRefreshToken(newRefreshToken);
        }

        const currentUser = useAuthStore.getState().user;
        useAuthStore.getState().setAuthenticated(true, newAccessToken, currentUser);

        // Resolve all queued requests with the new access token
        processQueue(null, newAccessToken);

        // Update original request authorization header and retry
        if (originalRequest.headers) {
          const authHeader = `Bearer ${newAccessToken}`;
          if (typeof originalRequest.headers.set === 'function') {
            originalRequest.headers.set('Authorization', authHeader);
          }
          originalRequest.headers.Authorization = authHeader;
          originalRequest.headers['Authorization'] = authHeader;
        }

        console.log('[apiClient:refresh] Retrying original request:', originalRequest.url);
        return apiClient(originalRequest);
      } catch (refreshError: any) {
        console.error(
          '[apiClient:refresh] Refresh token invalid/expired:',
          refreshError?.response?.data || refreshError?.message,
        );
        processQueue(refreshError, null);
        await storageService.clearAll();
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Direct 401 on refresh endpoint or exhausted retries
    if (isAuthError && (isRefreshCall || originalRequest?._retry)) {
      console.warn('[apiClient] 401 encountered on auth/refresh request. Clearing credentials.');
      await storageService.clearAll();
      useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  },
);
