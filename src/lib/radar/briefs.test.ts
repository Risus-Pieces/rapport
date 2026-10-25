import { describe, expect, it } from "vitest";
import { CAREER_PROFILE, PROFILES, TASKS, buildResearchPrompt } from "@/lib/radar/briefs";
import { FEEDS, KINDS, PERSON_KINDS, crmHref, crmTargetFor, defaultPurpose, kindLabel, outreachResultMessage } from "@/lib/radar/types";

describe("research tasks", () => {
  it("have unique ids and only emit kinds their feed allows", () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    for (const t of TASKS) for (const k of t.kinds) expect(KINDS[t.feed], `${t.id}: ${k}`).toContain(k);
  });
  it("cover every feed and every kind", () => {
    const ids = TASKS.map((t) => t.id);
    for (const id of [
      "sooz-angels-rice", "sooz-celebrities", "sooz-nextgen", "sooz-creators-nil", "sooz-buyers", "sooz-media", "sooz-sampling",
      "personal-events", "personal-passes-speaking", "career-internships", "career-programs", "career-externships", "career-fellowships",
    ]) expect(ids).toContain(id);
    for (const f of FEEDS) {
      const emitted = new Set(TASKS.filter((t) => t.feed === f).flatMap((t) => t.kinds));
      for (const k of KINDS[f]) expect(emitted, `${f}: ${k}`).toContain(k);
    }
  });
  it("looks for Houston cafés and coffee shops as buyers (pre-launch proof)", () => {
    expect(TASKS.find((t) => t.id === "sooz-buyers")!.brief).toMatch(/cafés, coffee shops and specialty stores/);
  });
  it("has a dedicated, deeper pitch-competition search for Sooz", () => {
    const t = TASKS.find((x) => x.id === "sooz-pitch-competitions")!;
    expect(t).toMatchObject({ feed: "sooz", kinds: ["funding", "event"], upcomingOnly: true });
    expect(t.maxSearches).toBeGreaterThanOrEqual(30);
    expect(t.brief).toMatch(/tag "pitch-competition"/);
    expect(t.brief).toMatch(/prize/);
    expect(t.brief).toMatch(/next cycle/);
    // Anywhere in the U.S., found by who can enter (young / student founders), under every name these go by.
    expect(t.brief).toMatch(/anywhere in the United States/);
    expect(t.brief).toMatch(/under 30/);
    expect(t.brief).toMatch(/summit/);
    expect(t.brief).toMatch(/past winners/);
    expect(t.brief).toMatch(/WATCHLIST/);
    expect(t.brief).toMatch(/SEEDS/);
    expect(t.brief).not.toMatch(/Houston\/Texas or virtual/);
  });
  it("hunts retail accelerators and retailer programs, tagged and watched like competitions", () => {
    const t = TASKS.find((x) => x.id === "sooz-resources")!;
    expect(t.brief).toMatch(/tag "accelerator"/);
    expect(t.brief).toMatch(/Whole Foods LEAP/);
    expect(t.brief).toMatch(/WATCHLIST/);
    expect(t.maxSearches).toBeGreaterThanOrEqual(20);
  });
  it("keeps job in Career only", () => {
    expect(KINDS.personal).not.toContain("job");
    expect(KINDS.career).toContain("job");
  });
  it("tells people tasks to stay public, adult and one-person-per-item", () => {
    for (const t of TASKS.filter((t) => t.kinds.some((k) => (PERSON_KINDS as readonly string[]).includes(k) && k !== "angel"))) {
      expect(t.brief, t.id).toMatch(/ONE PERSON/);
      expect(t.brief, t.id).toMatch(/Adults only/);
      expect(t.brief, t.id).toMatch(/never personal emails/);
    }
  });
  it("uses each feed's profile in the research prompt", () => {
    const t = TASKS.find((x) => x.id === "career-internships")!;
    const p = buildResearchPrompt(t, { today: "2026-10-14", homeBase: "Houston, TX", known: ["Known Thing"] });
    expect(p).toContain(CAREER_PROFILE);
    expect(p).toContain("Known Thing");
    expect(Object.keys(PROFILES).sort()).toEqual([...FEEDS].sort());
  });
});

describe("CRM targets and purposes", () => {
  it("maps each person kind to the Rapport section it lands in", () => {
    expect(PERSON_KINDS.map((k) => [k, crmTargetFor(k)])).toEqual([
      ["angel", "investors"], ["celebrity", "general"], ["nextgen", "investors"], ["creator", "general"], ["buyer", "restaurants"], ["media", "general"],
    ]);
    expect(crmTargetFor("event")).toBeNull();
    expect(crmTargetFor("internship")).toBeNull();
  });
  it("links an approved finding to its CRM page, or nowhere when the record is gone", () => {
    expect(crmHref({ kind: "angel", contactId: "c1", dealId: "d1" })).toBe("/investors/d1");
    expect(crmHref({ kind: "buyer", contactId: "c1", dealId: "d2" })).toBe("/restaurants/d2");
    expect(crmHref({ kind: "media", contactId: "c3", dealId: null })).toBe("/general/c3");
    expect(crmHref({ kind: "angel", contactId: null, dealId: null })).toBeNull();
    expect(crmHref({ kind: "angel", contactId: "c1", dealId: null })).toBeNull();
    expect(crmHref({ kind: "event", contactId: "c1", dealId: "d1" })).toBeNull();
  });
  it("explains an outreach button that did nothing", () => {
    expect(outreachResultMessage("ok")).toBeNull();
    expect(outreachResultMessage("ignored")).toBeNull();
    expect(outreachResultMessage("not approved")).toBe("That person is no longer in the CRM.");
    expect(outreachResultMessage("not found")).toBe("That outreach no longer exists.");
  });
  it("labels kinds for people", () => {
    expect(["nextgen", "media", "angel", "pass"].map(kindLabel)).toEqual(["Next-gen", "Press", "Angel", "Pass"]);
  });
  it("defaults the outreach purpose from the kind", () => {
    expect(PERSON_KINDS.map((k) => defaultPurpose(k))).toEqual(["invest", "ambassador", "invest", "ambassador", "buyer", "press"]);
  });
});
