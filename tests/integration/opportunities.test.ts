import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// Everything the research finds that isn't a person: To apply / Applied / On hold / Dismissed.
describe.skipIf(!hasDevDb)("opportunities (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let o: typeof import("@/db/queries/opportunities");
  let owner = randomUUID();
  const users: string[] = [];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows[0] as T;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const item = async (title: string, x: { kind?: string; feed?: string; score?: number; status?: string; event_date?: string | null; tags?: string[] } = {}) =>
    (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, status, event_date, tags, dedupe_key)
       values ($1, $2, $3, $4, 'https://x.com/' || $5, $6, $7, $8::date, $9, $5) returning id`,
      [owner, x.feed ?? "sooz", x.kind ?? "event", title, title.toLowerCase().replace(/\W+/g, "-"), x.score ?? 70, x.status ?? "new", x.event_date ?? null, x.tags ?? []],
    ))!.id;
  const titles = (rows: { title: string }[]) => rows.map((x) => x.title);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    o = await import("@/db/queries/opportunities");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `opp-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("lists everything but people, by view, soonest first; To apply hides what is already past", async () => {
    await item("Expo Soon", { event_date: day(10) });
    await item("Expo Sooner", { event_date: day(3), status: "saved" });
    await item("Expo Past", { event_date: day(-3) });
    await item("Grant", { kind: "funding", score: 90 });
    await item("Applied One", { kind: "competition", status: "applied" });
    await item("Held One", { status: "on_hold" });
    await item("Gone One", { status: "dismissed" });
    await item("Angel Person", { kind: "angel" });
    await item("Hack", { feed: "personal", kind: "hackathon" });
    const base = { feed: "sooz" as const, view: "to_apply" as const, sort: "date" as const };
    expect(titles(await o.listOpportunities(owner, base))).toEqual(["Expo Sooner", "Expo Soon", "Grant"]);
    expect(titles(await o.listOpportunities(owner, { ...base, sort: "score" }))).toEqual(["Grant", "Expo Sooner", "Expo Soon"]);
    expect(titles(await o.listOpportunities(owner, { ...base, kind: "funding" }))).toEqual(["Grant"]);
    expect(titles(await o.listOpportunities(owner, { ...base, q: "soon" }))).toEqual(["Expo Sooner", "Expo Soon"]);
    expect(titles(await o.listOpportunities(owner, { ...base, view: "applied" }))).toEqual(["Applied One"]);
    expect(titles(await o.listOpportunities(owner, { ...base, view: "on_hold" }))).toEqual(["Held One"]);
    expect(titles(await o.listOpportunities(owner, { ...base, view: "dismissed" }))).toEqual(["Gone One"]);
    expect(await o.opportunityCounts(owner, "sooz")).toEqual({ to_apply: 3, applied: 1, on_hold: 1, dismissed: 1 });
    expect(await o.opportunityKindCounts(owner, "sooz", "to_apply")).toEqual(expect.arrayContaining([{ kind: "event", n: 2 }, { kind: "funding", n: 1 }]));
    expect(await o.newOpportunityCounts(owner)).toEqual({ sooz: 2, personal: 1, career: 0 }); // not the past expo, not the person
  });

  it("changes status for opportunities only, never for people or another owner's items", async () => {
    const expo = await item("Expo");
    const person = await item("Pat Person", { kind: "creator" });
    expect(await o.setOpportunityStatus(owner, expo, "applied")).toBe(true);
    expect(await o.setOpportunityStatus(owner, expo, "on_hold")).toBe(true);
    expect(await o.setOpportunityStatus(owner, expo, "saved")).toBe(true);
    expect(await o.setOpportunityStatus(owner, person, "dismissed")).toBe(false);
    expect(await o.setOpportunityStatus(randomUUID(), expo, "dismissed")).toBe(false);
    expect(await one(`select status from radar_items where id = $1`, [expo])).toEqual({ status: "saved" });
    await item("Fresh");
    await o.markOpportunitiesSeen(owner, "sooz");
    expect(await o.newOpportunityCounts(owner)).toEqual({ sooz: 0, personal: 0, career: 0 });
    expect(await one(`select status from radar_items where id = $1`, [person])).toEqual({ status: "new" });
  });

  it("search finds opportunities and links to them; people are found as CRM records instead", async () => {
    await item("Findable Expo");
    await item("Findable Intern", { feed: "career", kind: "internship", status: "applied" });
    await item("Findable Angel", { kind: "angel" });
    const { searchRecords } = await import("@/db/queries/search");
    const hits = await searchRecords(owner, "findable");
    expect(hits.map((h) => [h.label, h.detail, h.href])).toEqual([
      ["Findable Expo", "Opportunities · Sooz · Event", "/opportunities?q=Findable+Expo"],
      ["Findable Intern", "Opportunities · Career · Internship", "/opportunities?feed=career&view=applied&q=Findable+Intern"],
    ]);
  });
});
