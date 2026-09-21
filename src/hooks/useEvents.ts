import { useQuery } from '@tanstack/react-query';
import { eventService, EventModel } from '@/services/eventService';
import { useAuthStore } from '@/store/authStore';

export type { EventModel };

export interface UseEventsResult {
  data: EventModel[];
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch events from the Django backend API (`/mobile/events/`)
 * Powered by TanStack Query with automatic caching and background revalidation.
 */
export const useEvents = (): UseEventsResult => {
  const { isAuthenticated, token } = useAuthStore();

  const {
    data = [],
    isLoading,
    isRefetching,
    error,
    refetch: queryRefetch,
  } = useQuery<EventModel[], Error>({
    queryKey: ['events'],
    queryFn: () => eventService.getEvents(),
    enabled: isAuthenticated && Boolean(token),
  });

  const refetch = async (): Promise<void> => {
    await queryRefetch();
  };

  return {
    data,
    isLoading: isLoading && isAuthenticated && Boolean(token),
    isRefetching,
    error,
    refetch,
  };
};
