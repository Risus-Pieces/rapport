import { describe, expect, it } from "vitest";
import {
  compareReminders,
  describeLastTouch,
  describeReminder,
  getReminder,
  type Reminder,
} from "./reminders";

const now = new Date("2026-10-06T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("getReminder", () => {
  it("is overdue one day past the target gap", () => {
    expect(getReminder("high", daysAgo(31), daysAgo(400), now)).toEqual({
      status: "overdue",
      daysSince: 31,
      daysOverdue: 1,
    });
  });

  it("is due soon exactly on the target day and 7 days before it", () => {
    expect(getReminder("high", daysAgo(30), daysAgo(400), now).status).toBe("due_soon");
    expect(getReminder("high", daysAgo(23), daysAgo(400), now).status).toBe("due_soon");
  });

  it("is on track more than 7 days before the target", () => {
    expect(getReminder("high", daysAgo(22), daysAgo(400), now).status).toBe("on_track");
  });

  it("uses the documented gap for every priority", () => {
    expect(getReminder("very_high", daysAgo(16), daysAgo(400), now).status).toBe("overdue");
    expect(getReminder("very_high", daysAgo(15), daysAgo(400), now).status).toBe("due_soon");
    expect(getReminder("medium", daysAgo(91), daysAgo(400), now).status).toBe("overdue");
    expect(getReminder("low", daysAgo(181), daysAgo(400), now).status).toBe("overdue");
    expect(getReminder("low", daysAgo(180), daysAgo(400), now).status).toBe("due_soon");
  });

  it("falls back to the created date when there is no touch", () => {
    expect(getReminder("very_high", null, daysAgo(20), now)).toMatchObject({ status: "overdue", daysSince: 20 });
  });

  it("gives gone and null priorities no reminder", () => {
    expect(getReminder("gone", daysAgo(999), daysAgo(999), now)).toMatchObject({ status: "none", daysOverdue: null });
    expect(getReminder(null, daysAgo(999), daysAgo(999), now).status).toBe("none");
  });

  it("never reports negative days for a touch dated in the future", () => {
    expect(getReminder("high", new Date(now.getTime() + 86_400_000), daysAgo(5), now).daysSince).toBe(0);
  });
});

describe("compareReminders", () => {
  const r = (status: Reminder["status"], daysOverdue: number | null): Reminder => ({ status, daysSince: 0, daysOverdue });

  it("orders most overdue first, then due soon, on track, none", () => {
    const sorted = [r("none", null), r("on_track", -20), r("overdue", 3), r("due_soon", -2), r("overdue", 40)].sort(
      compareReminders,
    );
    expect(sorted.map((x) => [x.status, x.daysOverdue])).toEqual([
      ["overdue", 40],
      ["overdue", 3],
      ["due_soon", -2],
      ["on_track", -20],
      ["none", null],
    ]);
  });
});

describe("descriptions", () => {
  it("describes reminders in words, not color", () => {
    expect(describeReminder({ status: "overdue", daysSince: 31, daysOverdue: 1 })).toBe("1 day overdue");
    expect(describeReminder({ status: "overdue", daysSince: 40, daysOverdue: 10 })).toBe("10 days overdue");
    expect(describeReminder({ status: "due_soon", daysSince: 30, daysOverdue: 0 })).toBe("Due today");
    expect(describeReminder({ status: "due_soon", daysSince: 25, daysOverdue: -5 })).toBe("Due in 5 days");
    expect(describeReminder({ status: "none", daysSince: 5, daysOverdue: null })).toBe("No reminder");
  });

  it("describes the last touch", () => {
    expect(describeLastTouch(0, true)).toBe("Last touch today");
    expect(describeLastTouch(1, true)).toBe("Last touch yesterday");
    expect(describeLastTouch(12, true)).toBe("Last touch 12 days ago");
    expect(describeLastTouch(3, false)).toBe("Added 3 days ago, no touch yet");
  });
});
