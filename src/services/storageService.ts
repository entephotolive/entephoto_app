import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'entephoto_session_token';
const REFRESH_TOKEN_KEY = 'entephoto_refresh_token';
const USER_KEY = 'entephoto_user_data';
const FAVORITES_KEY = 'entephoto_favorite_photo_ids_v1';

export const storageService = {
  async getSessionToken(): Promise<string | null> {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      console.log('[storageService:getSessionToken]', {
        found: Boolean(token),
        length: token ? token.length : 0,
        prefix: token ? token.substring(0, 15) : null,
      });
      return token;
    } catch (error) {
      console.error('[storageService] Failed to get session token from SecureStore:', error);
      return null;
    }
  },

  async setSessionToken(token: string): Promise<void> {
    try {
      console.log('[storageService:setSessionToken] Writing token to SecureStore:', {
        length: token.length,
        prefix: token.substring(0, 15),
      });
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      console.log('[storageService] Successfully saved session token to SecureStore');
    } catch (error) {
      console.error('[storageService] Failed to save session token to SecureStore:', error);
      throw error;
    }
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error('[storageService] Failed to get refresh token from SecureStore:', error);
      return null;
    }
  },

  async setRefreshToken(refreshToken: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      console.log('[storageService] Successfully saved refresh token to SecureStore');
    } catch (error) {
      console.error('[storageService] Failed to save refresh token to SecureStore:', error);
    }
  },

  async removeSessionToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
      console.log('[storageService] Successfully removed session token from SecureStore');
    } catch (error) {
      console.error('[storageService] Failed to remove session token from SecureStore:', error);
    }
  },

  async getUserData<T>(): Promise<T | null> {
    try {
      const data = await SecureStore.getItemAsync(USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[storageService] Failed to get user data from SecureStore:', error);
      return null;
    }
  },

  async setUserData<T>(data: T): Promise<void> {
    try {
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data));
      console.log('[storageService] Successfully saved user data to SecureStore');
    } catch (error) {
      console.error('[storageService] Failed to save user data to SecureStore:', error);
      throw error;
    }
  },

  async removeUserData(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(USER_KEY);
      console.log('[storageService] Successfully removed user data from SecureStore');
    } catch (error) {
      console.error('[storageService] Failed to remove user data from SecureStore:', error);
    }
  },

  async clearAll(): Promise<void> {
    try {
      await this.removeSessionToken();
      await this.removeUserData();
      console.log('[storageService] Cleared all stored credentials from SecureStore');
    } catch (error) {
      console.error('[storageService] Error in clearAll:', error);
    }
  },

  async getFavoritePhotoIds(): Promise<string[]> {
    try {
      const data = await SecureStore.getItemAsync(FAVORITES_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return parsed;
      }
      return [];
    } catch (error) {
      console.error('[storageService] Failed to get favorite photo IDs:', error);
      return [];
    }
  },

  async setFavoritePhotoIds(ids: string[]): Promise<void> {
    try {
      await SecureStore.setItemAsync(FAVORITES_KEY, JSON.stringify(ids));
    } catch (error) {
      console.error('[storageService] Failed to save favorite photo IDs:', error);
    }
  },
};
