import { create } from 'zustand';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  photoUrl?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserProfile | null;
  token: string | null;
  setAuthenticated: (
    isAuthenticated: boolean,
    token?: string | null,
    user?: UserProfile | null,
  ) => void;
  setLoading: (isLoading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>(set => ({
  isAuthenticated: false,
  isLoading: false,
  user: null,
  token: null,
  setAuthenticated: (isAuthenticated, token = null, user = null) =>
    set({ isAuthenticated, token, user, isLoading: false }),
  setLoading: isLoading => set({ isLoading }),
  logout: () => set({ isAuthenticated: false, token: null, user: null, isLoading: false }),
}));
