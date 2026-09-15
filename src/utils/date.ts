/**
 * Date formatting utilities for EntePhoto
 */

/**
 * Formats an ISO date string (e.g. from MongoDB $date) to display format "05 Sep 2026"
 */
export const formatEventDate = (dateInput: string | Date | undefined | null): string => {
  if (!dateInput) return 'Upcoming';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return 'Upcoming';

    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();

    return `${day} ${month} ${year}`;
  } catch {
    return 'Upcoming';
  }
};
