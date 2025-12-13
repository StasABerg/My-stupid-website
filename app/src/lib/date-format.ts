// Cached formatters for performance
const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const DATE_FORMAT = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});
const LS_DATE_FORMAT_SAME_YEAR = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: '2-digit',
});
const LS_DATE_FORMAT_OTHER_YEAR = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
});

/**
 * Format a date relative to now (e.g., "3 days ago", "in 2 hours")
 */
export function formatRelativeTime(date: Date | number): string {
  const now = Date.now();
  const targetTime = typeof date === 'number' ? date : date.getTime();
  const diffMs = targetTime - now;

  // Calculate directly from milliseconds to avoid cascading precision loss
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  const diffWeek = Math.floor(diffMs / 604800000);
  const diffMonth = Math.floor(diffMs / 2592000000); // 30 days approx
  const diffYear = Math.floor(diffMs / 31536000000); // 365 days approx

  if (Math.abs(diffYear) >= 1) return RTF.format(diffYear, 'year');
  if (Math.abs(diffMonth) >= 1) return RTF.format(diffMonth, 'month');
  if (Math.abs(diffWeek) >= 1) return RTF.format(diffWeek, 'week');
  if (Math.abs(diffDay) >= 1) return RTF.format(diffDay, 'day');
  if (Math.abs(diffHour) >= 1) return RTF.format(diffHour, 'hour');
  if (Math.abs(diffMin) >= 1) return RTF.format(diffMin, 'minute');
  return RTF.format(diffSec, 'second');
}

/**
 * Format a date for display (e.g., "Dec 13, 2025")
 */
export function formatDate(date: Date | number | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (d instanceof Date && isNaN(d.getTime())) {
    return 'Invalid Date';
  }
  return DATE_FORMAT.format(d);
}

/**
 * Format time for display (e.g., "2:30 PM")
 */
export function formatTime(date: Date | number): string {
  return TIME_FORMAT.format(date);
}

/**
 * Format ls-style date (used in terminal components)
 */
export function formatLsDate(date: Date): string {
  const now = new Date();
  const isThisYear = date.getFullYear() === now.getFullYear();

  if (isThisYear) {
    return LS_DATE_FORMAT_SAME_YEAR.format(date);
  } else {
    return LS_DATE_FORMAT_OTHER_YEAR.format(date);
  }
}
