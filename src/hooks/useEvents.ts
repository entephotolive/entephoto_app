import { useState, useEffect, useCallback } from 'react';
import eventsRaw from '@/data/events.json';

export interface EventModel {
  _id: { $oid: string };
  title: string;
  category?: string;
  coverImage?: string | null;
  date: { $date: string };
  mobile?: boolean;
  location: string;
  photoCount: number;
  createdBy: { $oid: string };
  createdAt: { $date: string };
  updatedAt: { $date: string };
  __v?: number;
}

export interface UseEventsResult {
  data: EventModel[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch events.
 * Currently backed by local mock data (src/data/events.json),
 * designed to be seamlessly swapped with React Query / fetch API.
 */
export const useEvents = (): UseEventsResult => {
  const [data, setData] = useState<EventModel[]>(eventsRaw as EventModel[]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      // Future API call: const response = await fetch(`${ENV.API_URL}/api/v1/events`);
      setData(eventsRaw as EventModel[]);
      setError(null);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error('Failed to fetch events'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load simulation
    setData(eventsRaw as EventModel[]);
  }, []);

  return {
    data,
    isLoading,
    error,
    refetch,
  };
};
