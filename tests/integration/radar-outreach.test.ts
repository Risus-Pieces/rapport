import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PIPELINES } from "@/lib/sections";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("radar outreach + digest SQL (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let owner = randomUUID();
  const users: string[] = [];

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];

  // A finding row; people default to an angel in the sooz feed.
  const item = async (title: string, o: { kind?: string; score?: number; status?: string; firm?: string; feed?: string } = {}) =>
    (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, status, details, dedupe_key, summary, why_relevant)
       values ($1, $2, $3, $4, 'https://x.com/' || $5, $6, $7, $8::jsonb, $5, 'Backed two beverage brands', 'Beverage fit')
       returning id`,
      [owner, o.feed ?? "sooz", o.kind ?? "angel", title, title.toLowerCase().replace(/\W+/g, "-"), o.score ?? 80, o.status ?? "new",
       JSON.stringify({ firm: o.firm ?? `${title} Fund`, role: "Partner" })],
    ))!.id;

  // An approved angel: contact + investors deal at the given stage, linked from the item.
  const approved = async (title: string, stage = "target", o: { score?: number; firm?: string } = {}) => {
    const id = await item(title, { ...o, status: "approved" });
    const contact = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'investors', $2) returning id`, [owner, title]))!.id;
    const deal = (await one<{ id: string }>(
      `insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, $3, $4, '{"investorType":"angel"}') returning id`,
      [owner, contact, title, stage],
    ))!.id;
    await q(`update radar_items set contact_id = $2, deal_id = $3 where id = $1`, [id, contact, deal]);
    return { id, contact, deal };
  };
  const queue = async () => (await one<{ n: number }>(`select rr_outreach_queue($1) as n`, [owner]))!.n;
  // Put unapproved people on this week's shortlist (the only way they get outreach rows now).
  const shortlistIt = (...ids: string[]) =>
    one(`select rr_shortlist_set($1::jsonb, $2)`, [JSON.stringify(ids.map((id, i) => ({ radar_item_id: id, rank: i + 1, ask: `ask ${i + 1}` }))), owner]);
  const todo = async (limit = 10) => (await one<{ t: { pitch: Record<string, string>; prospects: Record<string, unknown>[] } }>(
    `select rr_outreach_todo($1, $2) as t`, [limit, owner]))!.t;
  const save = async (itemId: string, p: unknown) => (await one<{ r: Record<string, unknown> }>(
    `select rr_outreach_save($1, $2::jsonb, $3) as r`, [itemId, JSON.stringify(p), owner]))!.r;
  const record = async (itemId: string, event: string, at = "2026-10-08T15:00:00Z") => (await one<{ r: string }>(
    `select rr_outreach_record($1, $2, $3::timestamptz, $4) as r`, [itemId, event, at, owner]))!.r;
  const observe = async (itemId: string, event: string, at = "2026-10-08T15:00:00Z") => (await one<{ r: string }>(
    `select rr_outreach_observe($1, $2, $3::timestamptz, $4) as r`, [itemId, event, at, owner]))!.r;
  const outreachOf = async (itemId: string) => one<Record<string, unknown>>(
    `select stage, touches, next_followup_at::text as next, email, linkedin_url, body, drafted_by, purpose from outreach where radar_item_id = $1`, [itemId]);
  const digest = async (min = 55) => (await one<{ d: Record<string, unknown> & { html: string; text: string; ids: string[] } }>(
    `select rr_digest_email($1, 'https://crm.example', $2) as d`, [min, owner]))!.d;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
  });

  // A fresh owner per test keeps the dev branch shared state out of every assertion.
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `radar-o-${owner}@example.test`, emailVerified: true });
  });

  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("uses the first two stages Rapport's pipelines define", () => {
    expect(PIPELINES.investors.stages.slice(0, 2).map((x) => x.key)).toEqual(["target", "intro"]);
    expect(PIPELINES.restaurants.stages.slice(0, 2).map((x) => x.key)).toEqual(["lead", "contacted"]);
  });

  describe("queue and todo", () => {
    it("queues approved people and this week's shortlist only, never strong finds that weren't shortlisted", async () => {
      await approved("Low Approved", "target", { score: 50 });
      await shortlistIt(await item("Short Pick", { score: 65 }));
      await item("Strong Find", { score: 90, kind: "celebrity" });
      await item("Weak Find", { score: 60 });
      await item("Dismissed Find", { score: 95, status: "dismissed" });
      await item("An Event", { score: 99, kind: "event" });
      await item("Career Person", { score: 99, feed: "career", kind: "internship" });
      expect(await queue()).toBe(1); // the shortlist already opened Short Pick's row
      expect(await queue()).toBe(0);
      const t = await todo();
      expect(t.prospects.map((p) => [p.name, p.approved, p.purpose, p.kind])).toEqual([
        ["Short Pick", false, "invest", "angel"],
        ["Low Approved", true, "invest", "angel"],
      ]);
    });

    it("hands out one person per firm and carries pitch facts and warm paths", async () => {
      await shortlistIt(
        await item("Ann Top", { score: 90, firm: "The Angel Group; Supernatural Ventures" }),
        await item("Ben Next", { score: 85, firm: "The Angel Group" }),
      );
      await q(`insert into app_settings (user_id, key, value) values ($1, 'pitch.company', 'Sooz')`, [owner]);
      await q(`insert into network (user_id, full_name, company, position, company_key, dedupe_key)
               values ($1, 'Sam Lee', 'Supernatural Ventures', 'Associate', 'supernatural ventures', 'n1')`, [owner]);
      await queue();
      const t = await todo();
      expect(t.pitch).toEqual({ "pitch.company": "Sooz" });
      expect(t.prospects.map((p) => p.name)).toEqual(["Ann Top"]);
      expect(t.prospects[0].network_matches).toEqual([{ name: "Sam Lee", via: "LinkedIn connection" }]);
    });
  });

  describe("save", () => {
    it("validates, drafts, fills the approved contact's empty fields, and freezes once sent", async () => {
      const a = await approved("Jane Doe");
      await queue();
      const r = await save(a.id, { email: "bad", linkedin_url: "https://www.linkedin.com/in/jane", subject: "s".repeat(500), body: "Hello Jane" });
      expect(r).toEqual({ ok: true, email_saved: false, linkedin_saved: true, draft_saved: true });
      expect(await outreachOf(a.id)).toMatchObject({ stage: "drafted", drafted_by: "claude", email: null });
      await save(a.id, { email: "Jane@Acme.vc", email_source: "apollo" });
      expect(await one(`select email, linkedin_url from contacts where id = $1`, [a.contact])).toEqual({
        email: "jane@acme.vc", linkedin_url: "https://www.linkedin.com/in/jane",
      });
      expect(await record(a.id, "sent")).toBe("ok");
      expect((await save(a.id, { body: "changed" })).ok).toBe(false);
      expect((await outreachOf(a.id))!.body).toBe("Hello Jane");
    });

    it("pre-drafts unapproved people without touching any contact", async () => {
      const id = await item("Pre Draft", { score: 90 });
      await shortlistIt(id);
      await queue();
      expect((await save(id, { body: "Hi", email: "pre@fund.vc" })).draft_saved).toBe(true);
      expect(await outreachOf(id)).toMatchObject({ stage: "drafted", email: "pre@fund.vc" });
      await expect(save(randomUUID(), {})).rejects.toThrow(/not in the outreach pipeline/);
    });
  });

  describe("record (the single outreach effect)", () => {
    it("sent: one email activity, a follow-up task in 5 days, and Target → Intro", async () => {
      const a = await approved("Sent Person");
      await queue();
      await save(a.id, { body: "Hi" });
      expect(await record(a.id, "sent", "2026-10-08T15:00:00Z")).toBe("ok");
      expect(await outreachOf(a.id)).toMatchObject({ stage: "sent", touches: 1, next: "2026-10-13" });
      expect(await q(`select type::text, summary, deal_id from activities where contact_id = $1`, [a.contact])).toEqual([
        { type: "email", summary: "Sent intro email", deal_id: a.deal },
      ]);
      expect(await q(`select title, due_date::text as due, done_at from tasks where contact_id = $1`, [a.contact])).toEqual([
        { title: "Follow up with Sent Person", due: "2026-10-13", done_at: null },
      ]);
      expect((await one<{ stage: string }>(`select stage from deals where id = $1`, [a.deal]))!.stage).toBe("intro");
      expect(await record(a.id, "sent")).toBe("ignored");
    });

    it("leaves a deal that is already past its first stage alone", async () => {
      const a = await approved("Pitched Person", "pitched");
      await queue();
      await record(a.id, "sent");
      expect((await one<{ stage: string }>(`select stage from deals where id = $1`, [a.deal]))!.stage).toBe("pitched");
    });

    it("follow-ups: +7 days, closing the previous task, and nothing after three touches", async () => {
      const a = await approved("Follow Person");
      await queue();
      await record(a.id, "sent", "2026-10-08T15:00:00Z");
      expect(await record(a.id, "followup", "2026-10-13T15:00:00Z")).toBe("ok");
      expect(await outreachOf(a.id)).toMatchObject({ touches: 2, next: "2026-10-20" });
      expect(await record(a.id, "followup", "2026-10-20T15:00:00Z")).toBe("ok");
      expect(await outreachOf(a.id)).toMatchObject({ touches: 3, next: null });
      expect(await record(a.id, "followup", "2026-10-27T15:00:00Z")).toBe("ignored");
      const open = await q(`select due_date::text as due from tasks where contact_id = $1 and done_at is null`, [a.contact]);
      expect(open).toEqual([]);
      expect((await one<{ n: number }>(`select count(*)::int n from activities where contact_id = $1 and type = 'email'`, [a.contact]))!.n).toBe(3);
    });

    it("replied closes the open follow-up task; closed stops it", async () => {
      const a = await approved("Reply Person");
      await queue();
      await record(a.id, "sent");
      expect(await record(a.id, "replied", "2026-10-09T15:00:00Z")).toBe("ok");
      expect(await outreachOf(a.id)).toMatchObject({ stage: "replied", next: null });
      expect(await q(`select done_at is not null as done from tasks where contact_id = $1`, [a.contact])).toEqual([{ done: true }]);
      expect(await q(`select summary from activities where contact_id = $1 order by occurred_at`, [a.contact])).toEqual([
        { summary: "Sent intro email" }, { summary: "Replied" },
      ]);
      const b = await approved("Close Person");
      await queue();
      expect(await record(b.id, "closed")).toBe("ok");
      expect(await outreachOf(b.id)).toMatchObject({ stage: "closed" });
    });

    it("refuses unapproved items and unknown events", async () => {
      const id = await item("Not Yet", { score: 90 });
      await shortlistIt(id);
      await queue();
      expect(await record(id, "sent")).toBe("not approved");
      expect(await record(randomUUID(), "sent")).toBe("not found");
      const a = await approved("Odd Event");
      await queue();
      expect(await record(a.id, "teleported")).toBe("ignored");
    });
  });

  describe("Gmail watch and observe", () => {
    it("watches approved people with an email only, and observe ignores the rest", async () => {
      const a = await approved("Watch Me");
      const pre = await item("Pre Watch", { score: 90 });
      await shortlistIt(pre);
      await queue();
      await save(a.id, { email: "watch@fund.vc", body: "Hi" });
      await save(pre, { email: "pre@fund.vc", body: "Hi" });
      const watch = (await one<{ w: { radar_item_id: string; email: string }[] }>(`select rr_outreach_watch($1) as w`, [owner]))!.w;
      expect(watch.map((w) => w.email)).toEqual(["watch@fund.vc"]);
      expect(await observe(pre, "sent")).toBe("not approved");
      expect(await observe(a.id, "closed")).toBe("ignored");
      expect(await observe(a.id, "sent")).toBe("ok");
      expect(await observe(a.id, "replied")).toBe("ok");
    });
  });

  describe("digest", () => {
    it("groups finds by feed and people, links to the radar, and counts outreach", async () => {
      await item("Angel One", { score: 80 });
      await item("Expo", { kind: "event", score: 70 });
      await item("Hack", { feed: "personal", kind: "hackathon" });
      await item("Acme: Intern", { feed: "career", kind: "internship" });
      await item("Low", { score: 40 });
      await item("Gone", { status: "dismissed" });
      const a = await approved("Ready Draft");
      const pre = await item("Waiting Draft", { score: 90, status: "seen" });
      await shortlistIt(pre);
      await queue();
      await save(a.id, { body: "Hi" });
      await save(pre, { body: "Hi" });
      const d = await digest();
      expect(d.count).toBe(4);
      expect(d.html).toContain("Sooz — new people (1)");
      expect(d.html).toContain("Sooz — events, funding &amp; resources (1)");
      expect(d.html).toContain("Personal (1)");
      expect(d.html).toContain("Career (1)");
      expect(d.html).toContain('href="https://crm.example/radar"');
      expect(d.outreach).toEqual({ drafts_ready: 1, drafts_waiting: 1, followups_due: 0, new_replies: 0, actions: 2 });
      expect(d.html).toContain("1 draft ready to send");
      expect(d.html).toContain("1 draft waiting for your approval");
      const marked = (await one<{ n: number }>(`select rr_mark_digested($1::uuid[], $2) as n`, [d.ids, owner]))!.n;
      expect(marked).toBe(4);
      expect((await digest()).count).toBe(0);
    });

    it("escapes hostile titles, summaries and URLs", async () => {
      await one(`insert into radar_items (user_id, feed, kind, title, url, summary, score, dedupe_key)
                 values ($1, 'sooz', 'event', '<script>alert(1)</script>', 'https://a.com/"onmouseover="x', '"><img src=x onerror=1>', 80, 'evil')`, [owner]);
      const d = await digest();
      expect(d.html).not.toContain("<script>");
      expect(d.html).not.toContain("<img");
      expect(d.html).not.toContain('"onmouseover="');
    });

    it("handles an owner with nothing", async () => {
      expect(await digest()).toMatchObject({ count: 0, upcoming: 0, ids: [] });
    });
  });
});
