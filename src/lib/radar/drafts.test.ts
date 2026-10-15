import { describe, expect, it } from "vitest";
import { gmailComposeUrl, missingPitch, templateDrafts, type DraftInput } from "@/lib/radar/drafts";
import { PERSON_KINDS, defaultPurpose } from "@/lib/radar/types";

const pitch = {
  "pitch.company": "Sooz Beverage",
  "pitch.one_liner": "A better-for-you sparkling drink.",
  "pitch.sender_name": "Alex Founder",
  "pitch.sender_title": "Co-founder",
  "pitch.website": "drinksooz.com",
};
const angel = (o: Partial<DraftInput> = {}) =>
  ({ name: "Jane Q Doe", details: { firm: "Acme Ventures", role: "Partner" }, why_relevant: "", warm_path: null, ...o }) as DraftInput;


describe("templateDrafts", () => {
  it("uses only given facts and the angel's sourced details", () => {
    const d = templateDrafts(angel(), pitch);
    expect(d.body).toContain("Hi Jane,");
    expect(d.body).toContain("Partner at Acme Ventures");
    expect(d.body).toContain("Sooz Beverage. A better-for-you sparkling drink.");
    expect(d.body).not.toMatch(/raising|round|\$/i); // no raise given → no raise mentioned
    expect(d.body).not.toContain("Rice");
    expect(d.body).not.toMatch(/\n{3,}/);
    expect(d.intro_request).toBeNull(); // no warm path → no intro request
  });
  it("adds the fellow-Owl angle only when both sides have a Rice connection", () => {
    const d = templateDrafts(angel({ details: { firm: "Acme", rice_connection: "MBA '09" } }), { ...pitch, "pitch.rice_affiliation": "Rice '25" });
    expect(d.subject).toBe("Fellow Owl building Sooz Beverage");
    expect(d.body).toContain("fellow Rice alum (Rice '25)");
    expect(d.linkedin_note).toContain("fellow Owl");
    const one = templateDrafts(angel({ details: { firm: "Acme", rice_connection: "MBA '09" } }), pitch);
    expect(one.subject).not.toContain("Owl");
  });
  it("mentions the raise and traction only when provided", () => {
    const d = templateDrafts(angel(), { ...pitch, "pitch.raise": "$500k pre-seed", "pitch.traction": "In 40 H-E-B stores." });
    expect(d.body).toContain("ahead of our $500k pre-seed");
    expect(d.body).toContain("In 40 H-E-B stores.");
  });
  it("leaves visible placeholders when pitch facts are missing", () => {
    const d = templateDrafts(angel(), {});
    expect(d.body).toContain("[Company]");
    expect(missingPitch({})).toEqual(["Company", "One-liner", "Sender name"]);
  });
  it("keeps LinkedIn notes within 300 characters and writes an intro request when a warm path exists", () => {
    const d = templateDrafts(angel({ warm_path: "Sam at Acme" }), { ...pitch, "pitch.one_liner": "x".repeat(400) });
    expect(d.linkedin_note.length).toBeLessThanOrEqual(300);
    expect(d.intro_request).toContain("introducing me to Jane Q Doe (Acme Ventures)");
  });
});

describe("templateDrafts by purpose", () => {
  const raisePitch = { ...pitch, "pitch.raise": "$500k pre-seed SAFE", "pitch.deck_url": "https://deck.example" };
  it("defaults the purpose from the kind", () => {
    expect(PERSON_KINDS.map((k) => [k, defaultPurpose(k)])).toEqual([
      ["angel", "invest"], ["celebrity", "ambassador"], ["nextgen", "invest"], ["creator", "ambassador"], ["buyer", "buyer"], ["media", "press"],
    ]);
    const d = templateDrafts(angel({ kind: "celebrity" }), pitch);
    expect(d.subject).toBe("Can we send you some Sooz Beverage?");
  });
  it("ambassador notes offer product, never equity, terms, the raise or the deck", () => {
    const d = templateDrafts(angel({ kind: "creator", purpose: "ambassador" }), raisePitch);
    expect(d.body).toContain("send you some to try, no strings attached");
    for (const text of [d.body, d.linkedin_note, d.followup_1, d.followup_2]) {
      expect(text).not.toMatch(/equity|shares|stake|advis[eo]r|SAFE|pre-seed|raise|invest|\$|deck\.example/i);
    }
  });
  it("buyer notes ask for 15 minutes or a sample drop at the buyer's first firm", () => {
    const d = templateDrafts(angel({ kind: "buyer", purpose: "buyer", details: { firm: "H-E-B; Central Market", role: "Category manager" } }), raisePitch);
    expect(d.subject).toBe("Sooz Beverage for H-E-B: 15 minutes?");
    expect(d.body).toContain("15 minutes");
    expect(d.body).toMatch(/samples/);
    expect(d.body).not.toMatch(/pre-seed|raise/i);
  });
  it("press notes pitch a story angle from pitch facts only", () => {
    const d = templateDrafts(angel({ kind: "media", purpose: "press", details: { firm: "Houston Chronicle", role: "Food writer" } }), {
      ...pitch, "pitch.rice_affiliation": "Rice '29",
    });
    expect(d.subject).toBe("Story idea: a Rice student founder building Sooz Beverage");
    expect(d.body).toContain("a Rice student (Rice '29)");
    expect(d.body).toContain("send samples or do a short interview");
    const noRice = templateDrafts(angel({ kind: "media", purpose: "press" }), pitch);
    expect(noRice.body).not.toContain("Rice");
  });
  it("intro notes ask for a pointer; invest keeps the raise wording", () => {
    expect(templateDrafts(angel({ purpose: "intro" }), raisePitch).body).toContain("comfortable introducing me to");
    const inv = templateDrafts(angel({ kind: "nextgen" }), raisePitch);
    expect(inv.body).toContain("ahead of our $500k pre-seed SAFE");
    expect(inv.body).toContain("https://deck.example");
  });
});

describe("helpers", () => {
  it("builds a Gmail compose link without sending anything", () => {
    const u = new URL(gmailComposeUrl({ to: "a@b.co", subject: "Hi & bye", body: "Line 1\nLine 2", from: "me@x.co" }));
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("su")).toBe("Hi & bye");
    expect(u.searchParams.get("body")).toBe("Line 1\nLine 2");
    expect(u.searchParams.get("authuser")).toBe("me@x.co");
  });
});
