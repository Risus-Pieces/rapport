import type { Priority } from "@/db/schema";

// Target gap between touches, in days. "gone" and null mean no reminder.
export const TARGET_DAYS: Record<Exclude<Priority, "gone">, number> = {
  very_high: 15,
  high: 30,
  medium: 90,
  low: 180,
};

// How many days before the target a contact starts showing as "due soon". Tunable.
export const DUE_SOON_WINDOW_DAYS = 7;

// Activity types that count as contact with the person; notes and "other" do not.
export const TOUCH_TYPES = ["call", "email", "meeting", "tasting"] as const;

export const PRIORITY_LABELS: Record<Priority, string> = {
  very_high: "Very high",
  high: "High",
  medium: "Medium",
  low: "Low",
  gone: "Gone",
};

// Filled steps out of 4 for the signal meter. "gone" and null show an empty meter.
export const PRIORITY_STEPS: Record<Priority, number> = {
  very_high: 4,
  high: 3,
  medium: 2,
  low: 1,
  gone: 0,
};

export type ReminderStatus = "overdue" | "due_soon" | "on_track" | "none";

export type Reminder = {
  status: ReminderStatus;
  /** Whole days since the last touch (or since the contact was created). */
  daysSince: number;
  /** daysSince minus the target gap; positive means overdue. Null when there is no reminder. */
  daysOverdue: number | null;
};

const MS_PER_DAY = 86_400_000;

export function getReminder(
  priority: Priority | null,
  lastTouchAt: Date | null,
  createdAt: Date,
  now: Date = new Date(),
): Reminder {
  const since = lastTouchAt ?? createdAt;
  const daysSince = Math.max(0, Math.floor((now.getTime() - since.getTime()) / MS_PER_DAY));
  if (priority === null || priority === "gone") return { status: "none", daysSince, daysOverdue: null };
  const daysOverdue = daysSince - TARGET_DAYS[priority];
  const status: ReminderStatus =
    daysOverdue > 0 ? "overdue" : daysOverdue >= -DUE_SOON_WINDOW_DAYS ? "due_soon" : "on_track";
  return { status, daysSince, daysOverdue };
}

const REMINDER_ORDER: Record<ReminderStatus, number> = { overdue: 0, due_soon: 1, on_track: 2, none: 3 };

/** Sort key: overdue first (most overdue first), then due soon, on track, then no reminder. */
export function compareReminders(a: Reminder, b: Reminder): number {
  const byStatus = REMINDER_ORDER[a.status] - REMINDER_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  return (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0);
}

export function describeReminder(reminder: Reminder): string {
  switch (reminder.status) {
    case "overdue":
      return `${plural(reminder.daysOverdue!)} overdue`;
    case "due_soon":
      return reminder.daysOverdue === 0 ? "Due today" : `Due in ${plural(-reminder.daysOverdue!)}`;
    case "on_track":
      return "On track";
    case "none":
      return "No reminder";
  }
}

export function describeLastTouch(daysSince: number, hasTouch: boolean): string {
  const when = daysSince === 0 ? "today" : daysSince === 1 ? "yesterday" : `${daysSince} days ago`;
  return hasTouch ? `Last touch ${when}` : `Added ${when}, no touch yet`;
}

function plural(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}
