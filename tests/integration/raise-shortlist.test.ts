import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("weekly shortlist (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let raise: typeof import("@/db/queries/raise");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];

  const item = async (title: string, o: { kind?: string; score?: number; status?: string; firm?: string } = {}) =>
    (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, status, details, dedupe_key, summary)
       values ($1, 'sooz', $2, $3, 'https://x.com/' || $4, $5, $6, $7::jsonb, $4, 'Backs beverage brands') returning id`,
      [owner, o.kind ?? "angel", title, title.toLowerCase().replace(/\W+/g, "-"), o.score ?? 70, o.status ?? "new", JSON.stringify({ firm: o.firm ?? `${title} Fund` })],
    ))!.id;
  const week = async () => (await one<{ w: string }>(`select rr_week_start(current_date)::text as w`))!.w;
  type Cands = { week: string; investors: { radar_item_id: string; name: string; warm_paths: { name: string; via: string }[] }[]; buyers: { name: string }[] };
  const candidates = async () => (await one<{ c: Cands }>(`select rr_shortlist_candidates($1) as c`, [owner]))!.c;
  const set = async (rows: unknown[]) => (await one<{ n: number }>(`select rr_shortlist_set($1::jsonb, $2) as n`, [JSON.stringify(rows), owner]))!.n;
  const row = (id: string, rank: number, bucket = "investor") => ({ radar_item_id: id, bucket, rank, reason: `reason ${rank}`, ask: `ask ${rank}` });

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    raise = await import("@/db/queries/raise");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `raise-l-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("starts weeks on Monday", async () => {
    expect((await one<{ w: string }>(`select rr_week_start('2026-10-22'::date)::text as w`))!.w).toBe("2026-10-19");
    expect((await one<{ w: string }>(`select rr_week_start('2026-10-19'::date)::text as w`))!.w).toBe("2026-10-19");
  });

  it("offers investors and buyers, including hand-added CRM investors with warm paths from General contacts", async () => {
    await item("Ada Angel");
    await item("Nia Heir", { kind: "nextgen" });
    await item("Bea Buyer", { kind: "buyer" });
    await item("Gone Angel", { status: "dismissed" });
    await item("Cele Brity", { kind: "celebrity" });
    const company = (await one<{ id: string }>(`insert into companies (user_id, section, name) values ($1, 'investors', 'Bayou Capital') returning id`, [owner]))!.id;
    await one(`insert into contacts (user_id, section, name, company_id) values ($1, 'investors', 'Hal Hand', $2) returning id`, [owner, company]);
    const friendCo = (await one<{ id: string }>(`insert into companies (user_id, section, name) values ($1, 'general', 'Bayou Capital LLC') returning id`, [owner]))!.id;
    await q(`insert into contacts (user_id, section, name, company_id) values ($1, 'general', 'Fran Friend', $2)`, [owner, friendCo]);
    const c = await candidates();
    expect(c.week).toBe(await week());
    expect(c.investors.map((x) => x.name).sort()).toEqual(["Ada Angel", "Hal Hand", "Nia Heir"]);
    expect(c.buyers.map((x) => x.name)).toEqual(["Bea Buyer"]);
    expect(c.investors.find((x) => x.name === "Hal Hand")!.warm_paths).toEqual([{ name: "Fran Friend", via: "T's contact", who: "T", owner_is_sender: true }]);
  });

  it("keeps at most 4 investors and 2 buyers, ignores non-candidates, and opens outreach rows", async () => {
    const ids = await Promise.all(["A1", "A2", "A3", "A4", "A5"].map((t) => item(t)));
    const buyers = await Promise.all(["B1", "B2", "B3"].map((t) => item(t, { kind: "buyer" })));
    const gone = await item("Gone", { status: "dismissed" });
    const n = await set([...ids.map((id, i) => row(id, i + 1)), ...buyers.map((id, i) => row(id, i + 1, "buyer")), row(gone, 0)]);
    expect(n).toBe(6);
    const rows = await q<{ bucket: string; n: number }>(`select bucket, count(*)::int n from shortlist where user_id = $1 group by 1 order by 1`, [owner]);
    expect(rows).toEqual([{ bucket: "buyer", n: 2 }, { bucket: "investor", n: 4 }]);
    expect((await one<{ n: number }>(`select count(*)::int n from outreach where user_id = $1`, [owner]))!.n).toBe(6);
    expect((await one<{ n: number }>(`select count(*)::int n from shortlist where radar_item_id = $1`, [gone]))!.n).toBe(0);
  });

  it("approves the checked rows into the CRM with Gmail allowed, skips the rest, and is idempotent", async () => {
    const a = await item("Yes Angel");
    const b = await item("No Angel");
    await set([row(a, 1), row(b, 2)]);
    const w = await week();
    const list = await raise.listShortlist(owner, w);
    expect(list.map((x) => [x.name, x.status, x.ask])).toEqual([["Yes Angel", "proposed", "ask 1"], ["No Angel", "proposed", "ask 2"]]);
    expect(await raise.approveShortlist(owner, w, [a])).toEqual({ approved: 1, skipped: 1 });
    expect(await one(`select status, contact_id is not null as in_crm from radar_items where id = $1`, [a])).toEqual({ status: "approved", in_crm: true });
    expect(await one(`select gmail_ok from outreach where radar_item_id = $1`, [a])).toEqual({ gmail_ok: true });
    expect(await one(`select status from shortlist where radar_item_id = $1`, [b])).toEqual({ status: "skipped" });
    expect(await raise.approveShortlist(owner, w, [a, b])).toEqual({ approved: 0, skipped: 0 });
    expect(await one(`select status from shortlist where radar_item_id = $1`, [b])).toEqual({ status: "skipped" });
    expect((await one<{ n: number }>(`select count(*)::int n from contacts where user_id = $1`, [owner]))!.n).toBe(1);
  });

  it("does not offer a skipped person again for 56 days, nor anyone already approved for Gmail", async () => {
    const skipped = await item("Skipped Recently");
    const old = await item("Skipped Long Ago");
    const done = await item("Already Going");
    await q(`insert into shortlist (user_id, week, radar_item_id, bucket, status) values ($1, rr_week_start(current_date) - 14, $2, 'investor', 'skipped'), ($1, rr_week_start(current_date) - 63, $3, 'investor', 'skipped')`, [owner, skipped, old]);
    await raise.approveShortlist(owner, await week(), []);
    await set([row(done, 1)]);
    await raise.approveShortlist(owner, await week(), [done]);
    const names = (await candidates()).investors.map((x) => x.name);
    expect(names).toEqual(["Skipped Long Ago"]);
  });

  it("puts shortlisted people first in the drafting todo, with their ask", async () => {
    const short = await item("Short Listed", { score: 60 });
    const appr = await item("Approved Earlier", { score: 95 });
    const { approveRadarItem } = await import("@/db/queries/radar");
    await approveRadarItem(owner, appr);
    await q(`update outreach set gmail_ok = true where radar_item_id = $1`, [appr]); // the owner put this one in Gmail
    await set([row(short, 1)]);
    expect((await one<{ n: number }>(`select rr_outreach_queue($1) as n`, [owner]))!.n).toBe(0); // both already have rows
    const todo = (await one<{ t: { prospects: { name: string; shortlisted: boolean; shortlist_ask: string | null }[] } }>(`select rr_outreach_todo(8, $1) as t`, [owner]))!.t;
    expect(todo.prospects.map((p) => [p.name, p.shortlisted, p.shortlist_ask])).toEqual([
      ["Short Listed", true, "ask 1"],
      ["Approved Earlier", false, null],
    ]);
  });
});
