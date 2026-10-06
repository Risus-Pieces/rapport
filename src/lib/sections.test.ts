import { describe, expect, it } from "vitest";
import { parseDollars, formatCents, centsToInput } from "./money";
import {
  checkInvestorParties,
  compactDetails,
  firstStage,
  getStage,
  institutionCompanyDetails,
  investorTypeOf,
  PIPELINES,
  stageChange,
} from "./sections";

describe("pipelines", () => {
  it("matches the spec's stage lists and terminal stages", () => {
    expect(PIPELINES.restaurants.stages.map((s) => s.key)).toEqual([
      "lead", "contacted", "tasting", "negotiating", "active", "lost",
    ]);
    expect(PIPELINES.investors.stages.map((s) => s.key)).toEqual([
      "target", "intro", "pitched", "follow_up", "term_sheet", "committed", "passed",
    ]);
    expect(getStage("restaurants", "active")?.outcome).toBe("won");
    expect(getStage("restaurants", "lost")?.outcome).toBe("lost");
    expect(getStage("investors", "committed")?.outcome).toBe("won");
    expect(getStage("investors", "passed")?.outcome).toBe("lost");
  });

  it("has unique keys and exactly one open start stage", () => {
    for (const { stages } of Object.values(PIPELINES)) {
      expect(new Set(stages.map((s) => s.key)).size).toBe(stages.length);
    }
    expect(firstStage("restaurants").key).toBe("lead");
    expect(firstStage("investors").key).toBe("target");
  });
});

describe("stageChange", () => {
  const now = new Date("2026-10-06T12:00:00Z");

  it("sets status and closedAt for terminal stages and clears them otherwise", () => {
    expect(stageChange("restaurants", "active", now)).toEqual({ stage: "active", status: "won", closedAt: now });
    expect(stageChange("investors", "passed", now)).toEqual({ stage: "passed", status: "lost", closedAt: now });
    expect(stageChange("restaurants", "tasting", now)).toEqual({ stage: "tasting", status: "open", closedAt: null });
  });

  it("rejects a stage from the wrong section or an unknown one", () => {
    expect(stageChange("restaurants", "pitched")).toBeNull();
    expect(stageChange("investors", "lead")).toBeNull();
    expect(stageChange("investors", "nope")).toBeNull();
  });
});

describe("checkInvestorParties", () => {
  it("angels need a contact and no company", () => {
    expect(checkInvestorParties("angel", { contactId: "c", companyId: null })).toBeNull();
    expect(checkInvestorParties("angel", { contactId: null, companyId: null })).toMatch(/needs a person/);
    expect(checkInvestorParties("angel", { contactId: "c", companyId: "co" })).toMatch(/not a company/);
  });

  it("institutions need a company, and may have a partner contact", () => {
    expect(checkInvestorParties("institution", { contactId: null, companyId: "co" })).toBeNull();
    expect(checkInvestorParties("institution", { contactId: "c", companyId: "co" })).toBeNull();
    expect(checkInvestorParties("institution", { contactId: "c", companyId: null })).toMatch(/needs a company/);
  });

  it("reads the stored type, never inferring it", () => {
    expect(investorTypeOf({ investorType: "angel" })).toBe("angel");
    expect(investorTypeOf({ investorType: "institution" })).toBe("institution");
    expect(investorTypeOf({})).toBeNull();
    expect(investorTypeOf({ investorType: "whale" })).toBeNull();
  });
});

describe("details", () => {
  it("defaults the firm type and drops blanks", () => {
    const parsed = institutionCompanyDetails.parse({ focusStage: "Seed" });
    expect(parsed.firmType).toBe("vc");
    expect(compactDetails(parsed)).toEqual({ firmType: "vc", focusStage: "Seed" });
  });

  it("rejects an unknown firm type", () => {
    expect(institutionCompanyDetails.safeParse({ firmType: "hedge" }).success).toBe(false);
  });
});

describe("money", () => {
  it("parses dollars into cents", () => {
    expect(parseDollars("250,000")).toBe(25_000_000);
    expect(parseDollars("$1,500.50")).toBe(150_050);
    expect(parseDollars("  ")).toBeNull();
    expect(parseDollars("12.345")).toBe("invalid");
    expect(parseDollars("-5")).toBe("invalid");
    expect(parseDollars("abc")).toBe("invalid");
    expect(parseDollars("99999999999999999999")).toBe("invalid");
  });

  it("formats and round-trips", () => {
    expect(formatCents(25_000_000)).toBe("$250,000");
    expect(formatCents(null)).toBe("");
    expect(centsToInput(150_050)).toBe("1500.5");
    expect(parseDollars(centsToInput(150_050))).toBe(150_050);
  });
});
