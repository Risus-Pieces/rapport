// Dates are handled as UTC calendar days until the owner-timezone setting exists (see backlog).

/** Today as YYYY-MM-DD in UTC. */
export function todayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The timestamp to store for an activity the owner dates by day. Today means "now"; any
 * other day is noon UTC so it stays on that day in every timezone from UTC-11 to UTC+11.
 */
export function resolveOccurredAt(day: string | null, now: Date = new Date()): Date {
  if (!day || day === todayString(now)) return now;
  return new Date(`${day}T12:00:00Z`);
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return dayFormat.format(date);
}
