import { useState, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';

export interface UserModel {
  _id: { $oid: string };
  name: string;
  email: string;
  provider: string;
  avatarUrl: string;
  isBlocked: boolean;
  specializations: string[];
  role: string;
  createdAt: { $date: string };
  updatedAt: { $date: string };
  phoneNumber: string;
}

export interface UseCurrentUserResult {
  data: UserModel;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const DEFAULT_USER: UserModel = {
  _id: { $oid: '' },
  name: 'Photographer',
  email: '',
  provider: 'google',
  avatarUrl:
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256',
  isBlocked: false,
  specializations: ['Wedding', 'Portrait', 'Event'],
  role: 'photographer',
  createdAt: { $date: new Date().toISOString() },
  updatedAt: { $date: new Date().toISOString() },
  phoneNumber: '',
};

/**
 * Hook to retrieve current logged in user profile.
 * Reads from Zustand authStore (populated by Google Sign-In backend response).
 */
export const useCurrentUser = (): UseCurrentUserResult => {
  const storeUser = useAuthStore(state => state.user);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const data: UserModel = {
    ...DEFAULT_USER,
    _id: { $oid: storeUser?.id || '' },
    name: storeUser?.name || DEFAULT_USER.name,
    email: storeUser?.email || DEFAULT_USER.email,
    avatarUrl: storeUser?.photoUrl || DEFAULT_USER.avatarUrl,
  };

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error('Failed to fetch user'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    data,
    isLoading,
    error,
    refetch,
  };
};
