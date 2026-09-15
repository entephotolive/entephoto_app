import { useState, useEffect, useCallback } from 'react';
import userRaw from '@/data/user.json';
import { useAuthStore, UserProfile } from '@/store/authStore';

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

/**
 * Hook to retrieve current logged in user profile.
 * Merges local user.json with Zustand authStore.
 */
export const useCurrentUser = (): UseCurrentUserResult => {
  const storeUser = useAuthStore(state => state.user);
  const [data, setData] = useState<UserModel>(() => {
    return {
      ...(userRaw as UserModel),
      name: storeUser?.name || userRaw.name,
      email: storeUser?.email || userRaw.email,
      avatarUrl: storeUser?.photoUrl || userRaw.avatarUrl,
    };
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      setData({
        ...(userRaw as UserModel),
        name: storeUser?.name || userRaw.name,
        email: storeUser?.email || userRaw.email,
        avatarUrl: storeUser?.photoUrl || userRaw.avatarUrl,
      });
      setError(null);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error('Failed to fetch user'));
    } finally {
      setIsLoading(false);
    }
  }, [storeUser]);

  useEffect(() => {
    if (storeUser) {
      setData(prev => ({
        ...prev,
        name: storeUser.name || prev.name,
        email: storeUser.email || prev.email,
        avatarUrl: storeUser.photoUrl || prev.avatarUrl,
      }));
    }
  }, [storeUser]);

  return {
    data,
    isLoading,
    error,
    refetch,
  };
};
