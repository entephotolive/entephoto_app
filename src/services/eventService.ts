import { apiClient } from './apiClient';
import { API_ENDPOINTS } from '../config/api.config';

export interface EventModel {
  _id: { $oid: string };
  id: string;
  title: string;
  category?: string;
  coverImage?: string | null;
  date: { $date: string };
  mobile?: boolean;
  location: string;
  photoCount: number;
  createdBy?: { $oid: string };
  createdAt?: { $date: string };
  updatedAt?: { $date: string };
  __v?: number;
}

/**
 * Normalizes backend response objects into a consistent EventModel
 * Compatible with Django DRF PhotographerFoldersAPIView fields:
 * { id, name, slug, photoCount, eventId, createdAt, date, coverImage, ... }
 */
const normalizeEvent = (raw: any): EventModel => {
  const id =
    raw.id ||
    raw.eventId ||
    raw.slug ||
    (typeof raw._id === 'string' ? raw._id : raw._id?.$oid) ||
    String(raw._id || Math.random());

  const dateStr =
    (typeof raw.date === 'string' ? raw.date : raw.date?.$date) ||
    raw.event_date ||
    raw.eventDate ||
    raw.createdAt ||
    raw.created_at ||
    new Date().toISOString();

  const title =
    raw.title || raw.name || raw.event_name || raw.eventName || raw.slug || 'Untitled Event';

  const location = raw.location || raw.venue || raw.place || raw.city || 'Location not specified';

  const category = raw.category || raw.type || raw.event_type || raw.eventType || undefined;

  const coverImage =
    raw.coverImage ||
    raw.cover_image ||
    raw.cover ||
    raw.image ||
    raw.thumbnail ||
    raw.poster ||
    null;

  const photoCount = Number(
    raw.photoCount ??
      raw.photo_count ??
      raw.photos_count ??
      raw.total_photos ??
      raw.photosCount ??
      0,
  );

  const mobile = Boolean(raw.mobile ?? raw.is_mobile ?? raw.mobile_enabled ?? raw.isMobile ?? true);

  return {
    _id: { $oid: String(id) },
    id: String(id),
    title,
    category,
    coverImage,
    date: { $date: dateStr },
    mobile,
    location,
    photoCount,
    createdBy: raw.createdBy?.$oid
      ? raw.createdBy
      : { $oid: String(raw.createdBy || raw.user_id || raw.photographer || '') },
    createdAt: raw.createdAt?.$date
      ? raw.createdAt
      : { $date: raw.createdAt || raw.created_at || dateStr },
    updatedAt: raw.updatedAt?.$date
      ? raw.updatedAt
      : { $date: raw.updatedAt || raw.updated_at || dateStr },
  };
};

export const eventService = {
  /**
   * Fetches all event for the authenticated photographer
   */
  async getEvents(): Promise<EventModel[]> {
    console.log('[eventService:getEvents] Fetching events from:', API_ENDPOINTS.EVENTS.EVENTS);
    try {
      const response = await apiClient.get(API_ENDPOINTS.EVENTS.EVENTS);
      console.log('[eventService:getEvents] Response status:', response.status);

      const rawData = response.data;
      let rawList: any[] = [];

      if (Array.isArray(rawData)) {
        rawList = rawData;
      } else if (Array.isArray(rawData?.events)) {
        rawList = rawData.events;
      } else if (Array.isArray(rawData?.folders)) {
        rawList = rawData.folders;
      } else if (Array.isArray(rawData?.results)) {
        rawList = rawData.results;
      } else if (Array.isArray(rawData?.data)) {
        rawList = rawData.data;
      } else {
        console.warn('[eventService:getEvents] Unexpected payload shape:', rawData);
        rawList = [];
      }

      console.log(`[eventService:getEvents] Raw item count from API: ${rawList.length}`);
      if (rawList.length > 0) {
        console.log(
          '[eventService:getEvents] Sample raw event record:',
          JSON.stringify(rawList[0], null, 2),
        );
      }

      const normalized = rawList.map(normalizeEvent);
      console.log(
        `[eventService:getEvents] Successfully parsed ${normalized.length} events:`,
        normalized.map(e => ({
          id: e.id,
          title: e.title,
          photoCount: e.photoCount,
          date: e.date.$date,
        })),
      );
      return normalized;
    } catch (error: any) {
      console.error(
        '[eventService:getEvents] Failed to fetch events:',
        error?.response?.data || error?.message || error,
      );
      throw error;
    }
  },

  /**
   * Fetches details of a specific event
   */
  async getEventDetails(eventId: string): Promise<EventModel> {
    console.log(`[eventService:getEventDetails] Fetching event details for: ${eventId}`);
    try {
      const response = await apiClient.get(API_ENDPOINTS.EVENTS.EVENT_DETAILS(eventId));
      return normalizeEvent(response.data);
    } catch (error: any) {
      console.error(
        `[eventService:getEventDetails] Failed to fetch event ${eventId}:`,
        error?.response?.data || error?.message || error,
      );
      throw error;
    }
  },
};
