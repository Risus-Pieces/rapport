import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// Hand-added CRM investors join the raise workflow through a synthetic radar item (task_id 'crm').
describe.skipIf(!hasDevDb)("rr_sync_crm_investors (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const sync = async () => (await one<{ n: number }>(`select rr_sync_crm_investors($1) as n`, [owner]))!.n;

  const investor = async (name: string, stage: string | null = "target", o: { archived?: boolean; section?: string } = {}) => {
    const contact = (await one<{ id: string }>(
      `insert into contacts (user_id, section, name, email, archived_at) values ($1, $2, $3, $4, $5) returning id`,
      [owner, o.section ?? "investors", name, `${name.toLowerCase().replace(/\W+/g, ".")}@fund.example`, o.archived ? new Date() : null],
    ))!.id;
    let deal: string | null = null;
    if (stage && (o.section ?? "investors") === "investors") {
      deal = (await one<{ id: string }>(
        `insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, $3, $4, '{"investorType":"angel"}') returning id`,
        [owner, contact, name, stage],
      ))!.id;
    }
    return { contact, deal };
  };
  const itemFor = (contact: string) =>
    one<Record<string, unknown>>(`select feed, kind, title, status, task_id, dedupe_key, contact_id, deal_id, url from radar_items where contact_id = $1`, [contact]);
  const outreachFor = (contact: string) =>
    one<Record<string, unknown>>(`select stage, touches, next_followup_at, purpose, deal_id, gmail_ok from outreach where contact_id = $1`, [contact]);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `raise-s-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("gives a hand-added investor an approved radar item and a fresh outreach row", async () => {
    const a = await investor("Hand Added");
    expect(await sync()).toBe(1);
    expect(await itemFor(a.contact)).toEqual({
      feed: "sooz", kind: "angel", title: "Hand Added", status: "approved", task_id: "crm",
      dedupe_key: `crm:${a.contact}`, contact_id: a.contact, deal_id: a.deal, url: null,
    });
    expect(await outreachFor(a.contact)).toEqual({ stage: "prospect", touches: 0, next_followup_at: null, purpose: "invest", deal_id: a.deal, gmail_ok: false });
  });

  it("treats people already past Target, or already emailed, as contacted", async () => {
    const intro = await investor("Already Intro", "intro");
    const emailed = await investor("Already Emailed", "target");
    await q(`insert into activities (user_id, type, summary, contact_id) values ($1, 'email', 'Hi', $2)`, [owner, emailed.contact]);
    await sync();
    for (const p of [intro, emailed]) {
      expect(await outreachFor(p.contact)).toMatchObject({ stage: "sent", touches: 1, next_followup_at: null });
    }
  });

  it("is idempotent and skips people already linked, General contacts and archived investors", async () => {
    await investor("Once");
    await investor("Gone", "target", { archived: true });
    await investor("Friend", null, { section: "general" });
    const linked = await investor("From Radar");
    await q(
      `insert into radar_items (user_id, feed, kind, title, url, score, status, dedupe_key, contact_id, deal_id)
       values ($1, 'sooz', 'angel', 'From Radar', 'https://x.com/r', 80, 'approved', 'angel:from-radar', $2, $3)`,
      [owner, linked.contact, linked.deal],
    );
    expect(await sync()).toBe(1);
    expect(await sync()).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int n from radar_items where user_id = $1 and task_id = 'crm'`, [owner]))!.n).toBe(1);
  });
});
