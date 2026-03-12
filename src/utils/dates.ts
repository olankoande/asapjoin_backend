/**
 * Calculate hours between now and a future date.
 */
export function hoursUntil(futureDate: Date): number {
  const now = new Date();
  const diffMs = futureDate.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Calculate hours between two dates.
 */
export function hoursBetween(dateA: Date, dateB: Date): number {
  const diffMs = Math.abs(dateB.getTime() - dateA.getTime());
  return diffMs / (1000 * 60 * 60);
}

/**
 * Add days to a date.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Check if a date is in the past.
 */
export function isPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

/**
 * Parse a date string safely.
 */
export function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}
