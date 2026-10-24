import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// Annual competitions open for a few weeks; the research checks the ones whose last cycle is over (or undated) so the next
// cycle is caught when it opens, and searches for more like the ones the owner cares about.
describe.skipIf(!hasDevDb)("competition watchlist and owner-added opportunities (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let o: typeof import("@/db/queries/opportunities");
  let owner = randomUUID();
  const users: string[] = [];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows[0] as T;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const comp = async (title: string, x: { deadline?: string | null; status?: string; tags?: string[] } = {}) =>
    one(`insert into radar_items (user_id, feed, kind, title, url, score, status, deadline, tags, dedupe_key, summary)
         values ($1, 'sooz', 'funding', $2, 'https://x.com/' || $3, 70, $4, $5::date, $6, $3, 'A pitch competition.')`,
      [owner, title, title.toLowerCase().replace(/\W+/g, "-"), x.status ?? "new", x.deadline ?? null, x.tags ?? ["pitch-competition"]]);
  type Watch = { due: { series: string; title: string; usual_month: string | null }[]; seeds: { title: string }[] };
  const watch = async () => (await one<{ w: Watch }>(`select rr_competition_watch($1) as w`, [owner])).w;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    o = await import("@/db/queries/opportunities");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `cw-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("lists competitions whose last cycle is over or undated, one per series, but not ones with a cycle still ahead", async () => {
    await comp("Spring Pitch Prize 2026", { deadline: "2026-03-01", status: "applied" });
    await comp("Fall Founders Cup 2026", { deadline: day(-20) });
    await comp("Fall Founders Cup 2027", { deadline: day(300) });
    await comp("Mystery Challenge");
    await comp("Gone Pitch 2026", { deadline: "2026-02-01", status: "dismissed" });
    await comp("Not A Competition 2026", { deadline: "2026-02-01", tags: ["grant"] });
    const w = await watch();
    expect(w.due.map((d) => d.title).sort()).toEqual(["Mystery Challenge", "Spring Pitch Prize 2026"]);
    expect(w.due.find((d) => d.title === "Spring Pitch Prize 2026")).toMatchObject({ series: "spring pitch prize", usual_month: "March" });
  });

  it("offers the competitions the owner saved, applied to or added as seeds for finding similar ones", async () => {
    await comp("Saved Showcase", { status: "saved" });
    await comp("Applied Challenge", { status: "applied" });
    await comp("Ignored Pitch Night");
    expect((await watch()).seeds.map((x) => x.title).sort()).toEqual(["Applied Challenge", "Saved Showcase"]);
  });

  it("lets the owner add an opportunity: saved, tagged, deduped, a seed, and never a person", async () => {
    const r = await o.addOpportunity(owner, {
      feed: "sooz", kind: "event", title: "NextGen Summit Pitch Competition 2026", url: "https://nextgensummit.us/",
      deadline: "2026-10-20", eventDate: "2026-10-30", pitchCompetition: true, notes: "Under-30 founders, $10K.",
    });
    expect(r).toMatchObject({ ok: true });
    expect(await one(`select status, tags, notes, task_id from radar_items where user_id = $1`, [owner]))
      .toEqual({ status: "saved", tags: ["added-by-me", "pitch-competition"], notes: "Under-30 founders, $10K.", task_id: "owner" });
    expect(await o.addOpportunity(owner, { feed: "sooz", kind: "event", title: "NextGen Summit Pitch Competition 2026", url: "https://nextgensummit.us/" }))
      .toMatchObject({ ok: false, error: "That's already in Opportunities." });
    expect(await o.addOpportunity(owner, { feed: "sooz", kind: "angel", title: "Some Person", url: "https://x.com/p" }))
      .toMatchObject({ ok: false });
    expect(await o.addOpportunity(owner, { feed: "sooz", kind: "event", title: "No Link", url: "not a url" })).toMatchObject({ ok: false });
    expect((await watch()).seeds.map((x) => x.title)).toContain("NextGen Summit Pitch Competition 2026");
  });
});
