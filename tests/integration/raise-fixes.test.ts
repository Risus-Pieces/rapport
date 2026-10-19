import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// Fixes from the final review of raise mode: nothing unwanted may land in Gmail.
describe.skipIf(!hasDevDb)("raise mode safeguards (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let radar: typeof import("@/db/queries/radar");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  type Msg = { key: string; kind: string; thread_id: string | null };
  const todo = async () => (await one<{ t: { messages: Msg[] } }>(`select rr_gmail_todo($1) as t`, [owner]))!.t.messages;
  const saveMsg = async (item: string, kind: string, period: string) =>
    (await one<{ r: string }>(`select rr_message_save($1, $2, $3, 'Subj', 'Body', $4) as r`, [item, kind, period, owner]))!.r;
  const setting = (key: string, value: string) =>
    q(`insert into app_settings (user_id, key, value) values ($1, $2, $3) on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`, [owner, key, value]);
  const candidates = async () =>
    (await one<{ c: { investors: { name: string }[] } }>(`select rr_shortlist_candidates($1) as c`, [owner]))!.c.investors.map((x) => x.name);

  const person = async (name: string, o: { stage?: string; advice?: boolean; gmailOk?: boolean } = {}) => {
    const id = (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'sooz', 'angel', $2, 'https://x.com/' || $3, 80, $3) returning id`,
      [owner, name, name.toLowerCase().replace(/\W+/g, "-")],
    ))!.id;
    const a = await radar.approveRadarItem(owner, id);
    await q(`update outreach set gmail_ok = $2, email = $3, stage = $4, subject = 'Hello', body = 'Hi', followup_1 = 'Nudge' where radar_item_id = $1`,
      [id, o.gmailOk ?? true, `${name.toLowerCase().replace(/\W+/g, ".")}@fund.example`, o.stage ?? "drafted"]);
    if (o.advice) await q(`update deals set details = details || '{"adviceCallAt":"2026-10-15"}'::jsonb where id = $1`, [a.dealId]);
    const oid = (await one<{ id: string }>(`select id from outreach where radar_item_id = $1`, [id]))!.id;
    return { id, oid, ...a };
  };

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    radar = await import("@/db/queries/radar");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `raise-f-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  describe("already contacted, at any time", () => {
    it("no first-note draft once the deal moved past Target by hand", async () => {
      const p = await person("Moved Ahead");
      await q(`update deals set stage = 'intro' where id = $1`, [p.dealId]);
      expect(await todo()).toEqual([]);
    });

    it.each(["email", "call", "meeting"])("no first-note draft and no shortlist after a logged %s", async (type) => {
      const p = await person(`Logged ${type}`);
      await q(`insert into activities (user_id, type, summary, contact_id) values ($1, $2::activity_type, 'Talked', $3)`, [owner, type, p.contactId]);
      expect(await todo()).toEqual([]);
      await q(`update outreach set gmail_ok = false where id = $1`, [p.oid]);
      expect(await candidates()).not.toContain(`Logged ${type}`);
    });

    it("a hand-added investor emailed after the sync is no longer offered", async () => {
      const c = (await one<{ id: string }>(`insert into contacts (user_id, section, name, email) values ($1, 'investors', 'Hand Later', 'h@fund.example') returning id`, [owner]))!.id;
      await q(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Hand Later', 'target', '{"investorType":"angel"}')`, [owner, c]);
      expect(await candidates()).toContain("Hand Later");
      await q(`insert into activities (user_id, type, summary, contact_id) values ($1, 'email', 'Emailed by hand', $2)`, [owner, c]);
      expect(await candidates()).not.toContain("Hand Later");
    });
  });

  describe("launch messages follow the phase", () => {
    it("launch asks can only be saved, and only go to Gmail, while raising; updates only while building", async () => {
      const p = await person("Phase Person", { stage: "sent", advice: true });
      expect(await saveMsg(p.id, "launch_ask", "launch")).toBe("not raising");
      expect(await saveMsg(p.id, "update", "2026-11")).toBe("ok");
      await setting("raise.phase", "raising");
      expect(await saveMsg(p.id, "launch_ask", "launch")).toBe("ok");
      expect(await saveMsg(p.id, "update", "2026-12")).toBe("not building");
      expect((await todo()).map((m) => m.kind).sort()).toEqual(["launch_ask"]);
      await setting("raise.phase", "building");
      expect((await todo()).map((m) => m.kind)).toEqual(["update"]);
    });

    it("pins the period: one launch ask per person whatever the routine writes, months as YYYY-MM", async () => {
      const p = await person("Period Person", { stage: "sent", advice: true });
      await setting("raise.phase", "raising");
      expect(await saveMsg(p.id, "launch_ask", "Launch")).toBe("ok");
      expect(await saveMsg(p.id, "launch_ask", "launch-2")).toBe("ok");
      expect(await q(`select period from outreach_messages where outreach_id = $1`, [p.oid])).toEqual([{ period: "launch" }]);
      await setting("raise.phase", "building");
      expect(await saveMsg(p.id, "update", "november")).toBe("bad period");
    });

    it("no launch follow-up once the launch ask got a reply", async () => {
      const p = await person("Replied Launch", { stage: "sent", advice: true });
      await setting("raise.phase", "raising");
      await saveMsg(p.id, "launch_ask", "launch");
      await q(`select rr_gmail_record($1, 'd1', 't1', $2)`, [`${p.oid}:launch_ask:launch`, owner]);
      await q(`select rr_gmail_observe($1, 'sent', now(), $2)`, [`${p.oid}:launch_ask:launch`, owner]);
      await saveMsg(p.id, "launch_followup", "launch");
      expect((await todo()).map((m) => m.kind)).toEqual(["launch_followup"]);
      await q(`select rr_gmail_observe($1, 'replied', now(), $2)`, [`${p.oid}:launch_ask:launch`, owner]);
      expect(await todo()).toEqual([]);
    });
  });

  it("stores an empty thread id as no thread, so follow-ups start a fresh draft", async () => {
    const p = await person("No Thread");
    await q(`select rr_gmail_record($1, 'd1', '', $2)`, [`${p.oid}:first:`, owner]);
    await q(`select rr_gmail_observe($1, 'sent', now(), $2)`, [`${p.oid}:first:`, owner]);
    await q(`update outreach set next_followup_at = current_date where id = $1`, [p.oid]);
    expect(await todo()).toEqual([expect.objectContaining({ kind: "followup_1", thread_id: null })]);
  });

  it("a monthly update saved for some people doesn't block the rest", async () => {
    const a = await person("Upd A", { stage: "sent", advice: true });
    await person("Upd B", { stage: "sent", advice: true });
    await setting("month.progress", "Label done");
    const upd = async () => (await one<{ t: { due: boolean; reason: string; people: { name: string }[] } }>(`select rr_update_todo('2026-11-02'::date, $1) as t`, [owner]))!.t;
    expect((await upd()).people).toHaveLength(2);
    expect(await saveMsg(a.id, "update", "2026-11")).toBe("ok");
    expect(await upd()).toMatchObject({ due: true, people: [{ name: "Upd B" }] });
  });

  it("Gmail-pushed threads are watched by the Gmail messages, everything else by the old outreach watch", async () => {
    const pushed = await person("Pushed One");
    const manual = await person("Manual One", { gmailOk: false });
    await q(`select rr_gmail_record($1, 'd1', 't1', $2)`, [`${pushed.oid}:first:`, owner]);
    const w = (await one<{ w: { name: string }[] }>(`select rr_outreach_watch($1) as w`, [owner]))!.w;
    expect(w.map((x) => x.name)).toEqual(["Manual One"]);
    expect(manual.oid).toBeTruthy();
  });

  it("drafts only this week's shortlist and people approved for Gmail, not every hand-added investor", async () => {
    const c = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'investors', 'Hand Waiting') returning id`, [owner]))!.id;
    await q(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Hand Waiting', 'target', '{"investorType":"angel"}')`, [owner, c]);
    await q(`select rr_sync_crm_investors($1)`, [owner]);
    const ok = await person("Gmail Ok", { stage: "prospect" });
    const names = async () => (await one<{ t: { prospects: { name: string }[] } }>(`select rr_outreach_todo(8, $1) as t`, [owner]))!.t.prospects.map((p) => p.name);
    expect(await names()).toEqual(["Gmail Ok"]);
    expect(ok.oid).toBeTruthy();
  });
});
