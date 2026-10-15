import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dedupeKey, normalizeUrl, slug } from "@/lib/radar/dedupe";
import { hasDevDb } from "./db-guard";

// The weekly routines write through SQL functions; these tests pin them to the TypeScript reference.
describe.skipIf(!hasDevDb)("radar ingest SQL (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  const owner = randomUUID();
  const other = randomUUID();

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const ingest = async (feed: string, kinds: string[], upcoming: boolean, findings: unknown, user = owner) =>
    (await one<{ r: Record<string, unknown> & { rejected: { title: string; reason: string }[] } }>(
      `select rr_ingest($1, 't1', $2::text[], $3, $4::jsonb, $5) as r`,
      [feed, kinds, upcoming, JSON.stringify(findings), user],
    )).r;
  const f = (o: Record<string, unknown> = {}) => ({
    kind: "event", title: "Expo", url: "https://example.com/expo", summary: "s", why_relevant: "w",
    score: 70, tags: ["a"], event_date: "2099-01-01", ...o,
  });

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `radar-${id}@example.test`, emailVerified: true });
    }
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  describe("parity with src/lib/radar/dedupe.ts", () => {
    const urls = [
      "https://www.Example.com/Events/?utm_source=x&b=2&a=1#top",
      "http://a.com/p/", "https://a.com/p?utm_campaign=1", "https://a.com", "https://a.com/",
      "https://sub.a.com/x/y/?ref=1&q=2", "https://a.com/x?source=z&fbclid=1&keep=1", "https://A.COM:8080/x",
      "javascript:alert(1)", "not a url", "ftp://x.com/a", "",
    ];
    it.each(urls)("normalizes %s the same way", async (u) => {
      expect((await one<{ v: string | null }>(`select rr_norm_url($1) as v`, [u]))!.v).toBe(normalizeUrl(u));
    });
    it.each(["José  O'Neil!", "Jane Doe", "  --x--  ", "Ünïcödé Çafé"])("slugs %s the same way", async (v) => {
      expect((await one<{ v: string }>(`select rr_slug($1) as v`, [v]))!.v).toBe(slug(v));
    });
    const keys = [
      { feed: "sooz", kind: "angel", title: "Jane Doe", url: "https://a.com/x", firm: "Acme VC" },
      { feed: "sooz", kind: "angel", title: "jane doe", firm: null },
      { feed: "sooz", kind: "angel", title: "Ann Top", firm: "The Angel Group; Supernatural Ventures" },
      { feed: "sooz", kind: "celebrity", title: "Sam Star", url: "https://a.com/x", firm: "Houston Texans" },
      { feed: "sooz", kind: "nextgen", title: "Ann Heir", firm: "Heir Family Office; Heir Ventures" },
      { feed: "sooz", kind: "creator", title: "Cree Ator", firm: " ; Other" },
      { feed: "sooz", kind: "buyer", title: "Bea Buyer", firm: "H-E-B | Central Market" },
      { feed: "sooz", kind: "media", title: "Pat Writer", firm: null },
      { feed: "personal", kind: "event", title: "Hack", url: "https://www.x.com/e/?utm_source=a" },
      { feed: "personal", kind: "other", title: "No url", url: null, event_date: "2026-12-01" },
      { feed: "career", kind: "internship", title: "Acme: Intern", url: "https://acme.com/jobs/1?utm_source=x" },
      { feed: "sooz", kind: "event", title: "No url or date" },
    ];
    it.each(keys)("builds the same dedupe key for %o", async (k) => {
      const v = (await one<{ v: string }>(`select rr_dedupe_key($1,$2,$3,$4,$5::date,$6) as v`, [
        k.feed, k.kind, k.title, k.url ?? null, (k as { event_date?: string }).event_date ?? null, k.firm ?? null,
      ]))!.v;
      expect(v).toBe(dedupeKey(k));
    });
  });

  describe("rr_ingest", () => {
    it("inserts valid findings and rejects bad ones with reasons", async () => {
      const r = await ingest("sooz", ["event"], true, [
        f({ url: "https://example.com/v1" }),
        f({ title: "Past", url: "https://example.com/past", event_date: "2020-01-01" }),
        f({ title: "Low", url: "https://example.com/low", score: 30 }),
        f({ title: "No url", url: null }),
        f({ title: "Bad url", url: "javascript:alert(1)" }),
        f({ title: "Wrong kind", url: "https://example.com/wk", kind: "angel" }),
        f({ title: "", url: "https://example.com/blank" }),
        f({ title: "Bad score", url: "https://example.com/bs", score: "high" }),
        f({ title: "Bad date", url: "https://example.com/bd", event_date: "2026-13-45" }),
      ]);
      expect(r).toMatchObject({ received: 9, valid: 2, inserted: 2, updated: 0 });
      expect(r.rejected.map((x) => x.title).sort()).toEqual(["", "Bad score", "Bad url", "Low", "No url", "Past", "Wrong kind"].sort());
      const rows = await q(`select title, event_date::text as d, feed, status from radar_items where user_id = $1 and url in ('https://example.com/v1','https://example.com/bd') order by title`, [owner]);
      expect(rows).toEqual([
        { title: "Bad date", d: null, feed: "sooz", status: "new" },
        { title: "Expo", d: "2099-01-01", feed: "sooz", status: "new" },
      ]);
    });

    it("normalises fields and keys people like Query did", async () => {
      await ingest("sooz", ["angel"], false, [{
        kind: "Angel", title: "  Jane Norm ", url: "https://a.com/jane", score: 250,
        tags: ["Houston", "houston", " ", "Food-Bev", "a", "b", "c", "d", "e", "f"],
        summary: "x".repeat(900), why_relevant: "y".repeat(500),
        details: { firm: " Acme ", role: null, rice_connection: "MBA '09", contact_path: "Rice Alliance" },
      }]);
      const r = (await one<Record<string, unknown> & { summary: string; why_relevant: string }>(
        `select * from radar_items where user_id = $1 and title = 'Jane Norm'`, [owner]))!;
      expect(r.score).toBe(100);
      expect(r.tags).toEqual(["houston", "food-bev", "a", "b", "c", "d", "e", "f", "rice"]);
      expect(r.summary).toHaveLength(600);
      expect(r.why_relevant).toHaveLength(300);
      expect(r.details).toEqual({ firm: "Acme", rice_connection: "MBA '09", contact_path: "Rice Alliance" });
      expect(r.dedupe_key).toBe("angel:jane-norm:acme");
    });

    it("accepts career and new person kinds", async () => {
      const c = await ingest("career", ["internship", "job"], true, [
        f({ kind: "internship", title: "Acme: Summer 2027 Intern", url: "https://acme.com/jobs/77", event_date: null, deadline: "2099-01-01" }),
        f({ kind: "internship", title: "Closed", url: "https://acme.com/jobs/78", event_date: null, deadline: "2020-01-01" }),
      ]);
      expect(c).toMatchObject({ valid: 1, inserted: 1 });
      const p = await ingest("sooz", ["celebrity"], false, [
        { kind: "celebrity", title: "Sam Starr", url: "https://a.com/s", score: 80, tags: [], summary: "", why_relevant: "", details: { firm: "Houston Texans; Star Drinks" } },
        { kind: "celebrity", title: "Sam Starr", url: "https://b.com/s", score: 82, tags: [], summary: "", why_relevant: "", details: { firm: "Houston Texans" } },
      ]);
      expect(p).toMatchObject({ inserted: 1, updated: 1 });
    });

    it("never resets triage or approval on refresh, and records runs per user", async () => {
      await ingest("sooz", ["event"], true, [f({ title: "Kept", url: "https://example.com/kept" })]);
      const contactId = (await one<{ id: string }>(
        `insert into contacts (user_id, section, name) values ($1, 'general', 'Kept Person') returning id`, [owner]))!.id;
      await q(`update radar_items set status = 'approved', notes = 'mine', contact_id = $2 where user_id = $1 and url = 'https://example.com/kept'`, [owner, contactId]);
      const again = await ingest("sooz", ["event"], true, [f({ title: "Kept", summary: "v2", score: 90, url: "https://www.example.com/kept/", event_date: null })]);
      expect(again).toMatchObject({ inserted: 0, updated: 1 });
      const r = await one(`select status, notes, summary, score, event_date::text as d, contact_id from radar_items where user_id = $1 and url = 'https://example.com/kept'`, [owner]);
      expect(r).toMatchObject({ status: "approved", notes: "mine", summary: "v2", score: 90, d: "2099-01-01", contact_id: contactId });
      const runs = await q(`select found, inserted from radar_runs where user_id = $1 and task_id = 't1' order by started_at desc limit 1`, [owner]);
      expect(runs).toEqual([{ found: 1, inserted: 0 }]);
    });

    it("scopes everything by owner", async () => {
      await ingest("sooz", ["event"], true, [f({ title: "Shared", url: "https://example.com/shared" })], other);
      await ingest("sooz", ["event"], true, [f({ title: "Shared", url: "https://example.com/shared" })], owner);
      expect((await one<{ n: number }>(`select count(*)::int n from radar_items where url = 'https://example.com/shared' and user_id in ($1, $2)`, [owner, other]))!.n).toBe(2);
      const known = (await one<{ t: string[] }>(`select rr_known_titles('sooz', $1) as t`, [other]))!.t;
      expect(known).toEqual(["Shared"]);
    });

    it("stores hostile text verbatim and safely", async () => {
      const evil = "'$oq$'); drop table radar_items; --";
      const r = await ingest("sooz", ["angel"], false, [
        { kind: "angel", title: `Jane ${evil}`, url: "https://a.com/1", score: 80, tags: [], summary: evil, why_relevant: "", details: { firm: "Acme" } },
      ]);
      expect(r).toMatchObject({ inserted: 1 });
      expect((await one<{ summary: string }>(`select summary from radar_items where user_id = $1 and title like 'Jane %drop%'`, [owner]))!.summary).toBe(evil);
    });

    it("rejects malformed calls atomically", async () => {
      await expect(ingest("nope", ["event"], false, [f()])).rejects.toThrow(/feed/);
      await expect(ingest("sooz", ["event"], false, { not: "array" })).rejects.toThrow(/array/);
    });
  });

  it("rr_owner refuses to guess when there is not exactly one user", async () => {
    await expect(q(`select rr_owner()`)).rejects.toThrow(/exactly one owner/);
  });
});
