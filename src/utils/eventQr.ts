import type { EventModel } from '../services/eventService';

/**
 * Extracts the real event ID from an EventModel or string identifier.
 * Prevents using invalid inputs such as user IDs (createdBy), event titles, or list indices.
 */
export function extractEventId(eventOrId: EventModel | string | null | undefined): string | null {
  if (!eventOrId) {
    return null;
  }

  if (typeof eventOrId === 'string') {
    const trimmed = eventOrId.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
      return null;
    }
    return trimmed;
  }

  if (typeof eventOrId === 'object') {
    // Check canonical `id` field
    if (typeof eventOrId.id === 'string' && eventOrId.id.trim().length > 0) {
      const trimmed = eventOrId.id.trim();
      if (trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }

    // Check MongoDB `_id.$oid` structure
    if (
      eventOrId._id &&
      typeof eventOrId._id === 'object' &&
      typeof eventOrId._id.$oid === 'string' &&
      eventOrId._id.$oid.trim().length > 0
    ) {
      const trimmed = eventOrId._id.$oid.trim();
      if (trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }

    // Fallback if _id is a plain string
    if (typeof (eventOrId as any)._id === 'string' && (eventOrId as any)._id.trim().length > 0) {
      const trimmed = (eventOrId as any)._id.trim();
      if (trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }
  }

  return null;
}

/**
 * Normalizes and validates the redirect base URL.
 * Prevents accidental duplicate or missing slashes.
 * Ensures the base URL starts with http:// or https://.
 */
export function normalizeRedirectUrl(rawUrl?: string | null): string {
  const urlToClean =
    rawUrl !== undefined && rawUrl !== null ? rawUrl : process.env.EXPO_PUBLIC_REDIRECT_URL;

  if (urlToClean === undefined || urlToClean === null) {
    throw new Error(
      'Missing redirect URL: EXPO_PUBLIC_REDIRECT_URL environment variable is not configured.',
    );
  }

  if (typeof urlToClean !== 'string') {
    throw new Error('Redirect URL must be a string.');
  }

  const trimmed = urlToClean.trim();
  if (!trimmed) {
    throw new Error('Redirect URL cannot be empty.');
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `Invalid redirect URL "${trimmed}". The URL must start with http:// or https://.`,
    );
  }

  // Strip all trailing slashes to prevent duplicate slashes
  return trimmed.replace(/\/+$/, '');
}

/**
 * Generates the QR destination URL dynamically from an event's real ID.
 *
 * URL Format: {EXPO_PUBLIC_REDIRECT_URL}/event/{eventId}/live
 *
 * Example: https://staging.entephoto.co.in/event/6ae232dda3d8336883d8b69b/live
 *
 * @param eventOrId - The EventModel object or event ID string
 * @param customRedirectUrl - Optional override for the redirect base URL
 * @returns The fully qualified normalized QR destination URL
 * @throws Error if redirect URL or event ID is missing or invalid
 */
export function generateEventLiveQrUrl(
  eventOrId: EventModel | string | null | undefined,
  customRedirectUrl?: string | null,
): string {
  const normalizedBase = normalizeRedirectUrl(customRedirectUrl);

  const eventId = extractEventId(eventOrId);
  if (!eventId) {
    throw new Error(
      'Missing or invalid event ID: Cannot generate QR URL without a valid event ID.',
    );
  }

  // Strip leading and trailing slashes from the event ID to prevent duplicate slashes
  const sanitizedEventId = encodeURIComponent(eventId.replace(/^\/+|\/+$/g, ''));
  if (!sanitizedEventId) {
    throw new Error('Event ID is empty after sanitization.');
  }

  return `${normalizedBase}/event/${sanitizedEventId}/live`;
}

export interface GenerateQrUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Safe version of generateEventLiveQrUrl that returns a result object
 * instead of throwing an error.
 */
export function tryGenerateEventLiveQrUrl(
  eventOrId: EventModel | string | null | undefined,
  customRedirectUrl?: string | null,
): GenerateQrUrlResult {
  try {
    const url = generateEventLiveQrUrl(eventOrId, customRedirectUrl);
    return { success: true, url };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to generate QR URL' };
  }
}
