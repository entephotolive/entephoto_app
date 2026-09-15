import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'entephoto_session_token';
const USER_KEY = 'entephoto_user_data';

export const storageService = {
  async getSessionToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  async setSessionToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch (error) {
      console.warn('Failed to save session token to SecureStore:', error);
    }
  },

  async removeSessionToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch (error) {
      console.warn('Failed to remove session token from SecureStore:', error);
    }
  },

  async getUserData<T>(): Promise<T | null> {
    try {
      const data = await SecureStore.getItemAsync(USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async setUserData<T>(data: T): Promise<void> {
    try {
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save user data to SecureStore:', error);
    }
  },

  async removeUserData(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(USER_KEY);
    } catch (error) {
      console.warn('Failed to remove user data from SecureStore:', error);
    }
  },

  async clearAll(): Promise<void> {
    await this.removeSessionToken();
    await this.removeUserData();
  },
};
