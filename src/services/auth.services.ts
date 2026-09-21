import { apiClient } from './apiClient';
import { API_ENDPOINTS } from '../config/api.config';
import { storageService } from './storageService';

export interface PhotographerProfile {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface GoogleLoginResponse {
  access: string;
  refresh: string;
  photographer: PhotographerProfile;
}

export const authService = {
  /**
   * Sends Google ID Token to the Backend
   */
  async loginWithGoogle(idToken: string): Promise<GoogleLoginResponse> {
    const response = await apiClient.post<GoogleLoginResponse>(API_ENDPOINTS.AUTH.GOOGLE_SIGN_IN, {
      id_token: idToken, // Expected by Django backend (mobile_auth/views.py)
    });

    const { access, photographer } = response.data;

    // Save tokens and user info locally
    await storageService.setSessionToken(access);
    await storageService.setUserData(photographer);

    return response.data;
  },

  async logout(): Promise<void> {
    await storageService.clearAll();
  },
};
