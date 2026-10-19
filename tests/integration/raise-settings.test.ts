import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("raise settings, advice calls, progress and the week (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let raise: typeof import("@/db/queries/raise");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const deal = async (name: string, stage: string, o: { amount?: number | null; status?: string; section?: string; advice?: boolean } = {}) => {
    const section = o.section ?? "investors";
    const contact = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, $2, $3) returning id`, [owner, section, name]))!.id;
    const company = section === "restaurants"
      ? (await one<{ id: string }>(`insert into companies (user_id, section, name) values ($1, 'restaurants', $2) returning id`, [owner, `${name} Co`]))!.id
      : null;
    return (await one<{ id: string }>(
      `insert into deals (user_id, section, contact_id, company_id, title, stage, status, amount_cents, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) returning id`,
      [owner, section, company ? null : contact, company, name, stage, o.status ?? "open", o.amount ?? null,
       JSON.stringify(o.advice ? { investorType: "angel", adviceCallAt: "2026-10-01" } : section === "investors" ? { investorType: "angel" } : {})],
    ))!.id;
  };
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    raise = await import("@/db/queries/raise");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `raise-t-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("saves the raise goal and the month's facts", async () => {
    expect(await raise.getRaise(owner)).toEqual({ target: 75000, launchDate: null, phase: "building" });
    await raise.saveRaise(owner, { target: 80000, launchDate: "2027-01-15", phase: "raising" });
    expect(await raise.getRaise(owner)).toEqual({ target: 80000, launchDate: "2027-01-15", phase: "raising" });
    await raise.saveMonthFacts(owner, { progress: "Label done", ask: "Café intros", next: "First run" });
    expect(await raise.getMonthFacts(owner)).toMatchObject({ progress: "Label done", ask: "Café intros", next: "First run" });
  });

  it("marks and unmarks Advice call done on investor deals only", async () => {
    const inv = await deal("Ivy Investor", "intro");
    const rest = await deal("Rex Restaurant", "lead", { section: "restaurants" });
    expect(await raise.setAdviceCall(owner, inv, true)).toBe(true);
    expect((await one<{ d: Record<string, unknown> }>(`select details as d from deals where id = $1`, [inv]))!.d).toMatchObject({ investorType: "angel", adviceCallAt: expect.any(String) });
    expect(await raise.setAdviceCall(owner, rest, true)).toBe(false);
    expect(await raise.setAdviceCall(randomUUID(), inv, false)).toBe(false);
    expect(await raise.setAdviceCall(owner, inv, false)).toBe(true);
    expect((await one<{ d: Record<string, unknown> }>(`select details as d from deals where id = $1`, [inv]))!.d).toEqual({ investorType: "angel" });
  });

  it("adds up committed and soft-circled money toward the target, and counts who is ready", async () => {
    await deal("Won A", "committed", { amount: 2_500_000, status: "won" });
    await deal("Soft B", "follow_up", { amount: 1_000_000, advice: true });
    await deal("Soft C", "term_sheet", { amount: 500_000 });
    await deal("Early D", "pitched", { amount: 900_000, advice: true });
    await deal("Lost E", "passed", { amount: 700_000, status: "lost" });
    expect(await raise.raiseProgress(owner)).toEqual({ target: 75000, committed: 25000, softCircled: 15000, ready: 2 });
  });

  it("collects the week: applications due within 30 days, replies, and nudges", async () => {
    await q(`insert into radar_items (user_id, feed, kind, title, url, score, status, deadline, dedupe_key) values
      ($1, 'sooz', 'funding', 'Pitch Prize', 'https://x.com/p', 80, 'saved', $2, 'a1'),
      ($1, 'sooz', 'funding', 'Far Prize', 'https://x.com/f', 80, 'saved', $3, 'a2'),
      ($1, 'career', 'fellowship', 'Saved Fellowship', 'https://x.com/s', 80, 'saved', $2, 'a3'),
      ($1, 'career', 'fellowship', 'Unsaved Fellowship', 'https://x.com/u', 80, 'new', $2, 'a4'),
      ($1, 'sooz', 'funding', 'Gone Prize', 'https://x.com/g', 80, 'dismissed', $2, 'a5')`, [owner, day(10), day(40)]);
    const w = await raise.weekSummary(owner);
    expect(w.applications.map((a) => a.title).sort()).toEqual(["Pitch Prize", "Saved Fellowship"]);
    expect(w.nudges).toEqual({ tractionStale: true, monthFactsStale: true });
    await q(`insert into app_settings (user_id, key, value) values ($1, 'pitch.traction', '200 cans sampled')`, [owner]);
    await raise.saveMonthFacts(owner, { progress: "p", ask: "a", next: "n" });
    expect((await raise.weekSummary(owner)).nudges).toEqual({ tractionStale: false, monthFactsStale: false });
  });
});
