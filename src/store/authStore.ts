import { create } from 'zustand';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  photoUrl?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isInitializing: boolean;
  isLoading: boolean;
  user: UserProfile | null;
  token: string | null;
  setAuthenticated: (
    isAuthenticated: boolean,
    token?: string | null,
    user?: UserProfile | null,
  ) => void;
  setInitializing: (isInitializing: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isInitializing: true,
  isLoading: false,
  user: null,
  token: null,
  setAuthenticated: (isAuthenticated, token = null, user = null) => {
    const prev = get();
    console.log('[authStore:setAuthenticated] State transition:', {
      before: { isAuthenticated: prev.isAuthenticated, userEmail: prev.user?.email },
      after: { isAuthenticated, userEmail: user?.email },
    });
    set({
      isAuthenticated,
      token,
      user,
      isInitializing: false,
      isLoading: false,
    });
  },
  setInitializing: isInitializing => {
    console.log('[authStore:setInitializing]', isInitializing);
    set({ isInitializing });
  },
  setLoading: isLoading => {
    console.log('[authStore:setLoading]', isLoading);
    set({ isLoading });
  },
  logout: () => {
    console.log('[authStore:logout] Resetting auth store');
    set({
      isAuthenticated: false,
      token: null,
      user: null,
      isInitializing: false,
      isLoading: false,
    });
  },
}));
