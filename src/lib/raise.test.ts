import { describe, expect, it } from "vitest";
import { DEFAULT_RAISE, isStale, parseRaiseForm } from "@/lib/raise";

describe("raise settings", () => {
  const current = { target: 75000, launchDate: "2027-01-15", phase: "building" as const };

  it("defaults to a $75k raise in the building phase", () => {
    expect(DEFAULT_RAISE).toEqual({ target: 75000, launchDate: null, phase: "building" });
  });

  it("accepts valid values, including dollar signs and commas", () => {
    expect(parseRaiseForm({ target: "$100,000", launchDate: "2026-12-01", phase: "raising" }, current)).toEqual({
      target: 100000, launchDate: "2026-12-01", phase: "raising",
    });
  });

  it.each([[""], ["-5"], ["abc"], ["0"], ["0.4"], ["1e12"]])("keeps the current target when given %j", (target) => {
    expect(parseRaiseForm({ target, launchDate: "2027-01-15", phase: "building" }, current).target).toBe(75000);
  });

  it("keeps the current launch date for a bad date, clears it for an empty one, and ignores unknown phases", () => {
    expect(parseRaiseForm({ target: "75000", launchDate: "2027-13-45", phase: "building" }, current).launchDate).toBe("2027-01-15");
    expect(parseRaiseForm({ target: "75000", launchDate: "", phase: "building" }, current).launchDate).toBeNull();
    expect(parseRaiseForm({ target: "75000", launchDate: "2027-01-15", phase: "party" }, current).phase).toBe("building");
  });

  it("calls facts stale after 14 days or when never set", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale(new Date("2026-10-06T12:00:00Z"), now)).toBe(false);
    expect(isStale(new Date("2026-10-04T12:00:00Z"), now)).toBe(true);
  });
});
