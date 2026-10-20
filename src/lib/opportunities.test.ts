import { describe, expect, it } from "vitest";
import { OPPORTUNITY_VIEWS, OPPORTUNITY_VIEW_LABELS, opportunityHref, radarRedirect, statusesFor } from "@/lib/opportunities";

describe("opportunity views", () => {
  it("map statuses: new, seen and saved are To apply", () => {
    expect(OPPORTUNITY_VIEWS).toEqual(["to_apply", "applied", "on_hold", "dismissed"]);
    expect(OPPORTUNITY_VIEWS.map((v) => OPPORTUNITY_VIEW_LABELS[v])).toEqual(["To apply", "Applied", "On hold", "Dismissed"]);
    expect(statusesFor("to_apply")).toEqual(["new", "seen", "saved"]);
    expect(statusesFor("applied")).toEqual(["applied"]);
  });

  it("links a finding to its feed, view and a search for it", () => {
    expect(opportunityHref({ feed: "sooz", status: "new", title: "Food Expo" })).toBe("/opportunities?q=Food+Expo");
    expect(opportunityHref({ feed: "career", status: "applied", title: "Acme Intern" })).toBe("/opportunities?feed=career&view=applied&q=Acme+Intern");
    expect(opportunityHref({ feed: "personal", status: "saved", title: "Hack" })).toBe("/opportunities?feed=personal&q=Hack");
  });
});

describe("old /radar links", () => {
  it("land on the matching Opportunities feed, view and search", () => {
    expect(radarRedirect({})).toBe("/opportunities");
    expect(radarRedirect({ tab: "career", q: "x" })).toBe("/opportunities?feed=career&q=x");
    expect(radarRedirect({ tab: "sooz", view: "dismissed", kind: "event" })).toBe("/opportunities?view=dismissed&kind=event");
    expect(radarRedirect({ tab: "personal", view: "saved" })).toBe("/opportunities?feed=personal");
    // People live in the CRM now: an old link to a person searches Investors' To reach out (most of them are there).
    expect(radarRedirect({ tab: "people", view: "approved", kind: "angel", q: ["Ann", "Bo"] })).toBe("/investors?rel=to_reach_out&q=Ann");
    expect(radarRedirect({ q: "Ann" })).toBe("/investors?rel=to_reach_out&q=Ann");
    expect(radarRedirect({ tab: "people" })).toBe("/opportunities");
  });
});
