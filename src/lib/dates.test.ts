import { describe, expect, it } from "vitest";
import { formatDay, isValidDateString, resolveOccurredAt, todayString } from "./dates";
import { groupOpenTasks } from "./tasks";

const now = new Date("2026-10-06T20:30:00Z");

describe("dates", () => {
  it("formats today as a UTC calendar day", () => {
    expect(todayString(now)).toBe("2026-10-06");
  });

  it("validates real calendar days only", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-2-3")).toBe(false);
    expect(isValidDateString("nope")).toBe(false);
  });

  it("stores today as now and other days as noon UTC", () => {
    expect(resolveOccurredAt(null, now)).toBe(now);
    expect(resolveOccurredAt("2026-10-06", now)).toBe(now);
    expect(resolveOccurredAt("2026-10-01", now).toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("formats a day without timezone drift", () => {
    expect(formatDay("2026-10-01")).toBe("Oct 1, 2026");
    expect(formatDay(new Date("2026-10-01T23:59:00Z"))).toBe("Oct 1, 2026");
  });
});

describe("groupOpenTasks", () => {
  const t = (id: string, dueDate: string | null) => ({ id, dueDate });

  it("splits by today and orders each group by date", () => {
    const groups = groupOpenTasks(
      [t("late2", "2026-10-04"), t("none", null), t("soon", "2026-10-09"), t("now", "2026-10-06"), t("late1", "2026-10-01"), t("later", "2026-11-01")],
      "2026-10-06",
    );
    expect(groups.overdue.map((x) => x.id)).toEqual(["late1", "late2"]);
    expect(groups.today.map((x) => x.id)).toEqual(["now"]);
    expect(groups.upcoming.map((x) => x.id)).toEqual(["soon", "later"]);
    expect(groups.someday.map((x) => x.id)).toEqual(["none"]);
  });

  it("returns empty groups for no tasks", () => {
    expect(groupOpenTasks([], "2026-10-06")).toEqual({ overdue: [], today: [], upcoming: [], someday: [] });
  });
});
