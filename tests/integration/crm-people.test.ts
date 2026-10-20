import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// People go straight from research into the CRM as To reach out; Ghosted and Try again are automatic/one click.
describe.skipIf(!hasDevDb)("people in the CRM (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let raise: typeof import("@/db/queries/raise");
  let rel: typeof import("@/db/queries/relationships");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const slug = (name: string) => name.toLowerCase().replace(/\W+/g, "-");

  const ingest = async (findings: Record<string, unknown>[], kinds = ["angel", "nextgen", "buyer", "creator", "event"]) =>
    (await one<{ r: Record<string, unknown> }>(`select rr_ingest('sooz', 't1', $1::text[], false, $2::jsonb, $3) as r`,
      [kinds, JSON.stringify(findings), owner]))!.r;
  const finding = (title: string, kind = "angel", extra: Record<string, unknown> = {}) =>
    ({ kind, title, url: `https://example.com/${slug(title)}`, score: 80, summary: `${title} invests in drinks.`, why_relevant: "Fit", ...extra });
  type Item = { id: string; status: string; contact_id: string | null; deal_id: string | null };
  const item = (title: string) => one<Item>(`select id, status, contact_id, deal_id from radar_items where user_id = $1 and title = $2`, [owner, title]);
  const relOf = async (table: "contacts" | "deals", id: string | null) => (await one<{ r: string }>(`select relationship as r from ${table} where id = $1`, [id]))!.r;
  const candidates = async () =>
    (await one<{ c: { investors: { name: string; retry?: boolean }[] } }>(`select rr_shortlist_candidates($1) as c`, [owner]))!.c.investors;
  const gmailTodo = async () => (await one<{ t: { messages: { kind: string; radar_item_id: string }[] } }>(`select rr_gmail_todo($1) as t`, [owner]))!.t.messages;

  // An angel straight from research, with a sent intro whose cadence is in the state given.
  const sentAngel = async (name: string, o: { lastTouchDaysAgo?: number | null; nextFollowup?: string | null; touches?: number } = {}) => {
    await ingest([finding(name)]);
    const found = (await item(name))!;
    await q(`update outreach set email = $2, subject = 'Hello', body = 'Hi', followup_1 = 'Nudge', gmail_ok = true, stage = 'drafted' where radar_item_id = $1`,
      [found.id, `${slug(name)}@fund.example`]);
    const oid = (await one<{ id: string }>(`select id from outreach where radar_item_id = $1`, [found.id]))!.id;
    await q(`select rr_gmail_record($1, 'd1', 't1', $2)`, [`${oid}:first:`, owner]);
    await q(`select rr_gmail_observe($1, 'sent', now() - interval '30 days', $2)`, [`${oid}:first:`, owner]);
    const last = o.lastTouchDaysAgo === undefined ? 8 : o.lastTouchDaysAgo;
    await q(`update outreach set touches = $2, next_followup_at = $3::date,
               last_touch_at = case when $4::int is null then null else now() - make_interval(days => $4::int) end where id = $1`,
      [oid, o.touches ?? 3, o.nextFollowup ?? null, last]);
    return { ...found, oid };
  };

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    raise = await import("@/db/queries/raise");
    rel = await import("@/db/queries/relationships");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `crm-p-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  describe("research goes straight into the CRM", () => {
    it("a new angel becomes a To reach out contact with a Target deal; a creator a General contact with no reminder", async () => {
      const r = await ingest([finding("Angel Ann"), finding("Creator Cy", "creator"), finding("Food Fest", "event")]);
      expect(r).toMatchObject({ inserted: 3, added_to_crm: 2 });
      const ann = (await item("Angel Ann"))!;
      expect(ann.status).toBe("approved");
      expect(await one(`select stage, section, relationship from deals where id = $1`, [ann.deal_id])).toEqual({ stage: "target", section: "investors", relationship: "to_reach_out" });
      expect(await relOf("contacts", ann.contact_id)).toBe("to_reach_out");
      const cy = (await item("Creator Cy"))!;
      expect(await one(`select section, relationship, priority::text from contacts where id = $1`, [cy.contact_id])).toEqual({ section: "general", relationship: "to_reach_out", priority: null });
      expect((await item("Food Fest"))!.status).toBe("new");
      expect(await one(`select count(*)::int n from outreach where radar_item_id = $1`, [ann.id])).toEqual({ n: 1 });
    });

    it("re-ingesting is idempotent and a dismissed person found again stays dismissed, not duplicated", async () => {
      await ingest([finding("Twice Tim")]);
      await ingest([finding("Twice Tim")]);
      expect(await one(`select count(*)::int n from contacts where user_id = $1`, [owner])).toEqual({ n: 1 });
      const tim = (await item("Twice Tim"))!;
      await rel.setDealRelationship(owner, tim.deal_id!, "dismissed");
      await ingest([finding("Twice Tim", "angel", { url: "https://other.example/tim", details: { firm: "New Fund" } })]);
      expect(await one(`select count(*)::int n from contacts where user_id = $1`, [owner])).toEqual({ n: 1 });
      expect(await relOf("contacts", tim.contact_id)).toBe("dismissed");
    });

    it("lists the people added to To reach out in the digest", async () => {
      await ingest([finding("Digest Dee")]);
      const d = (await one<{ d: { html: string; text: string } }>(`select rr_digest_email(55, 'https://app.example', $1) as d`, [owner]))!.d;
      expect(d.text).toContain("ADDED TO TO REACH OUT");
      expect(d.text).toContain("Digest Dee");
      expect(d.html).toContain("https://app.example/opportunities");
    });

    it("a hand-added deal at its first stage is someone to reach out to; at a later stage someone you know", async () => {
      const c = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'investors', 'By Hand') returning id`, [owner]))!.id;
      const d = (await one<{ id: string }>(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'By Hand', 'target', '{"investorType":"angel"}') returning id`, [owner, c]))!.id;
      expect(await relOf("deals", d)).toBe("to_reach_out");
      expect(await relOf("contacts", c)).toBe("to_reach_out");
      const c2 = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'investors', 'Met Already') returning id`, [owner]))!.id;
      const d2 = (await one<{ id: string }>(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Met', 'pitched', '{"investorType":"angel"}') returning id`, [owner, c2]))!.id;
      expect(await relOf("deals", d2)).toBe("known");
      expect(await relOf("contacts", c2)).toBe("known");
    });
  });

  describe("Dismissed and On hold people get nothing", () => {
    it.each(["dismissed", "on_hold"] as const)("%s: no shortlist slot, first note, follow-up, update or launch ask", async (r) => {
      await ingest([finding("Pause Pam"), finding("Live Lou")]);
      const pam = (await item("Pause Pam"))!;
      expect((await candidates()).map((c) => c.name)).toContain("Pause Pam");
      await rel.setDealRelationship(owner, pam.deal_id!, r);
      expect((await candidates()).map((c) => c.name)).toEqual(["Live Lou"]);

      await q(`update outreach set email = 'pam@fund.example', subject = 'S', body = 'B', followup_1 = 'F', gmail_ok = true, stage = 'drafted' where radar_item_id = $1`, [pam.id]);
      expect(await gmailTodo()).toEqual([]);
      const prospects = async () => (await one<{ t: { prospects: { name: string }[] } }>(`select rr_outreach_todo(8, $1) as t`, [owner]))!.t.prospects.map((p) => p.name);
      await q(`update outreach set stage = 'prospect' where radar_item_id = $1`, [pam.id]);
      expect(await prospects()).not.toContain("Pause Pam");

      // Already in conversation, then paused: no follow-up, update or launch ask either.
      await q(`update outreach set stage = 'sent', touches = 1, next_followup_at = current_date where radar_item_id = $1`, [pam.id]);
      await q(`update deals set details = details || '{"adviceCallAt":"2026-10-15"}'::jsonb where id = $1`, [pam.deal_id]);
      expect(await gmailTodo()).toEqual([]);
      const ready = (await one<{ p: unknown[] }>(`select rr_ready_people($1, 'update', '2026-11') as p`, [owner]))!.p;
      expect(ready).toEqual([]);
      await rel.setDealRelationship(owner, pam.deal_id!, "known");
      expect((await gmailTodo()).map((m) => m.kind)).toEqual(["followup_1"]);
      expect((await one<{ p: unknown[] }>(`select rr_ready_people($1, 'update', '2026-11') as p`, [owner]))!.p).toHaveLength(1);
    });
  });

  describe("Ghosted", () => {
    it("after the cadence ends and 7 quiet days; not before, not with a follow-up pending, not without a touch date", async () => {
      const ghost = await sentAngel("Ghost Gus");
      const recent = await sentAngel("Recent Rae", { lastTouchDaysAgo: 3 });
      const pending = await sentAngel("Pending Pia", { touches: 2, nextFollowup: "2026-12-01" });
      const undated = await sentAngel("Undated Uma", { lastTouchDaysAgo: null });
      const called = await sentAngel("Called Cal");
      await q(`insert into activities (user_id, type, summary, contact_id) values ($1, 'call', 'Spoke', $2)`, [owner, called.contact_id]);
      expect(await raise.refreshGhosted(owner)).toBe(1);
      expect(await relOf("deals", ghost.deal_id)).toBe("ghosted");
      expect(await relOf("contacts", ghost.contact_id)).toBe("ghosted");
      for (const p of [recent, pending, undated, called]) expect(await relOf("deals", p.deal_id)).toBe("known");
      expect(await raise.refreshGhosted(owner)).toBe(0);
    });

    it("a reply brings a ghosted person back to Know them", async () => {
      const g = await sentAngel("Late Reply");
      await raise.refreshGhosted(owner);
      await q(`select rr_gmail_observe($1, 'replied', now(), $2)`, [`${g.oid}:first:`, owner]);
      expect(await relOf("deals", g.deal_id)).toBe("known");
    });
  });

  describe("Try again", () => {
    it("only from Ghosted: resets the outreach, drops old Gmail records, and offers a fresh circling-back first note", async () => {
      const g = await sentAngel("Retry Rob");
      expect(await raise.tryAgain(owner, g.id!)).toBe(false);
      await raise.refreshGhosted(owner);
      expect(await raise.tryAgain(owner, g.id!)).toBe(true);
      expect(await relOf("deals", g.deal_id)).toBe("to_reach_out");
      expect(await relOf("contacts", g.contact_id)).toBe("to_reach_out");
      expect(await one(`select stage, touches, subject, body, followup_1, gmail_ok, next_followup_at, last_touch_at from outreach where id = $1`, [g.oid]))
        .toEqual({ stage: "prospect", touches: 0, subject: null, body: null, followup_1: null, gmail_ok: false, next_followup_at: null, last_touch_at: null });
      expect(await one(`select count(*)::int n from outreach_messages where outreach_id = $1`, [g.oid])).toEqual({ n: 0 });
      expect((await candidates()).find((c) => c.name === "Retry Rob")).toMatchObject({ retry: true });

      await q(`update outreach set gmail_ok = true where id = $1`, [g.oid]);
      const todo = (await one<{ t: { prospects: { name: string; retry: boolean }[] } }>(`select rr_outreach_todo(8, $1) as t`, [owner]))!.t.prospects;
      expect(todo).toEqual([expect.objectContaining({ name: "Retry Rob", retry: true })]);
      await q(`update outreach set stage = 'drafted', subject = 'Circling back', body = 'Hi again' where id = $1`, [g.oid]);
      expect(await gmailTodo()).toEqual([expect.objectContaining({ kind: "first", radar_item_id: g.id })]);
    });
  });

  describe("institution partners are reached through the institution", () => {
    it("are not synced as angels, and untouched synced ones are cleaned up while ones in Gmail stay", async () => {
      const co = (await one<{ id: string }>(`insert into companies (user_id, section, name) values ($1, 'investors', 'Big Fund') returning id`, [owner]))!.id;
      await q(`insert into deals (user_id, section, company_id, title, stage, details) values ($1, 'investors', $2, 'Big Fund', 'target', '{"investorType":"institution"}')`, [owner, co]);
      const partner = async (name: string) =>
        (await one<{ id: string }>(`insert into contacts (user_id, section, name, company_id) values ($1, 'investors', $2, $3) returning id`, [owner, name, co]))!.id;
      const quiet = await partner("Quiet Partner");
      const busy = await partner("Busy Partner");
      // As the old sync created them:
      for (const c of [quiet, busy]) {
        const it = (await one<{ id: string }>(`insert into radar_items (user_id, feed, kind, title, score, status, task_id, dedupe_key, contact_id) values ($1, 'sooz', 'angel', 'P', 70, 'approved', 'crm', 'crm:' || $2, $2::uuid) returning id`, [owner, c]))!.id;
        await q(`insert into outreach (user_id, radar_item_id, contact_id, email, gmail_ok) values ($1, $2, $3, 'p@fund.example', $4)`, [owner, it, c, c === busy]);
      }
      expect(await one<{ n: number }>(`select rr_cleanup_partner_items($1) as n`, [owner])).toEqual({ n: 1 });
      expect(await one(`select count(*)::int n from radar_items where contact_id = $1`, [quiet])).toEqual({ n: 0 });
      expect(await one(`select count(*)::int n from radar_items where contact_id = $1`, [busy])).toEqual({ n: 1 });
      await partner("New Partner");
      expect(await one<{ n: number }>(`select rr_sync_crm_investors($1) as n`, [owner])).toEqual({ n: 0 });
    });
  });

  describe("moving the Radar's people into the CRM", () => {
    it("adds every Sooz person still waiting in the Radar, once; dismissals and opportunities stay as they are", async () => {
      const raw = (title: string, kind: string, status: string) =>
        q(`insert into radar_items (user_id, feed, kind, title, url, score, status, dedupe_key) values ($1, 'sooz', $2, $3, 'https://x.com/' || $4, 70, $5, $4)`,
          [owner, kind, title, slug(title), status]);
      await raw("New Angel", "angel", "new");
      await raw("Seen Creator", "creator", "seen");
      await raw("Saved Buyer", "buyer", "saved");
      await raw("Gone Angel", "angel", "dismissed");
      await raw("Some Expo", "event", "new");
      expect(await one(`select rr_move_radar_people($1) as n`, [owner])).toEqual({ n: 3 });
      expect(await one(`select rr_move_radar_people($1) as n`, [owner])).toEqual({ n: 0 });
      const rows = await q<{ title: string; status: string; in_crm: boolean }>(
        `select title, status, contact_id is not null as in_crm from radar_items where user_id = $1 order by title`, [owner]);
      expect(rows).toEqual([
        { title: "Gone Angel", status: "dismissed", in_crm: false },
        { title: "New Angel", status: "approved", in_crm: true },
        { title: "Saved Buyer", status: "approved", in_crm: true },
        { title: "Seen Creator", status: "approved", in_crm: true },
        { title: "Some Expo", status: "new", in_crm: false },
      ]);
      expect(await rel.relationshipCounts(owner, "investors")).toMatchObject({ to_reach_out: 1 });
      expect(await rel.relationshipCounts(owner, "restaurants")).toMatchObject({ to_reach_out: 1 });
      expect(await rel.relationshipCounts(owner, "general")).toMatchObject({ to_reach_out: 1 });
    });
  });
});
