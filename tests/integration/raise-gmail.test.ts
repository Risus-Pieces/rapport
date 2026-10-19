import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("Gmail drafts, updates and launch asks (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let radar: typeof import("@/db/queries/radar");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];

  type Msg = { key: string; kind: string; to: string; subject: string | null; body: string | null; thread_id: string | null; radar_item_id: string };
  const todo = async () => (await one<{ t: { sender_email: string | null; messages: Msg[] } }>(`select rr_gmail_todo($1) as t`, [owner]))!.t;
  const record = async (key: string, draft = "d1", thread = "t1") =>
    (await one<{ r: string }>(`select rr_gmail_record($1, $2, $3, $4) as r`, [key, draft, thread, owner]))!.r;
  const observe = async (key: string, event: string, at = "2026-10-20T15:00:00Z") =>
    (await one<{ r: string }>(`select rr_gmail_observe($1, $2, $3::timestamptz, $4) as r`, [key, event, at, owner]))!.r;
  const saveMsg = async (item: string, kind: string, period: string) =>
    (await one<{ r: string }>(`select rr_message_save($1, $2, $3, 'Subj', 'Body', $4) as r`, [item, kind, period, owner]))!.r;
  const setting = (key: string, value: string) =>
    q(`insert into app_settings (user_id, key, value) values ($1, $2, $3) on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`, [owner, key, value]);

  // An angel approved into the CRM, with an outreach row ready to go.
  const person = async (name: string, o: { gmailOk?: boolean; email?: string | null; stage?: string; advice?: boolean; dealStage?: string } = {}) => {
    const id = (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'sooz', 'angel', $2, 'https://x.com/' || $3, 80, $3) returning id`,
      [owner, name, name.toLowerCase().replace(/\W+/g, "-")],
    ))!.id;
    const a = await radar.approveRadarItem(owner, id);
    await q(`update outreach set gmail_ok = $2, email = $3, stage = $4, subject = 'Hello', body = 'Hi there', followup_1 = 'Nudge one', followup_2 = 'Last note' where radar_item_id = $1`,
      [id, o.gmailOk ?? true, o.email === undefined ? `${name.toLowerCase().replace(/\W+/g, ".")}@fund.example` : o.email, o.stage ?? "drafted"]);
    if (o.advice) await q(`update deals set details = details || '{"adviceCallAt":"2026-10-15"}'::jsonb where id = $1`, [a.dealId]);
    if (o.dealStage) await q(`update deals set stage = $2 where id = $1`, [a.dealId, o.dealStage]);
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
    await db.insert(s.user).values({ id: owner, name: "T", email: `raise-g-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("offers a first-note draft only when approved for Gmail, with an email and a written draft", async () => {
    const ok = await person("Ok Person");
    await person("No Gmail", { gmailOk: false });
    await person("No Email", { email: null });
    await person("No Draft", { stage: "prospect" });
    await setting("pitch.sender_email", "me@sooz.example");
    const t = await todo();
    expect(t.sender_email).toBe("me@sooz.example");
    expect(t.messages).toEqual([
      { key: `${ok.oid}:first:`, radar_item_id: ok.id, kind: "first", period: "", to: "ok.person@fund.example", subject: "Hello", body: "Hi there", thread_id: null },
    ]);
  });

  it("never drafts a first note for someone already contacted (synced as sent)", async () => {
    const c = (await one<{ id: string }>(`insert into contacts (user_id, section, name, email) values ($1, 'investors', 'Old Friend', 'old@fund.example') returning id`, [owner]))!.id;
    await q(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Old Friend', 'intro', '{"investorType":"angel"}')`, [owner, c]);
    await q(`select rr_sync_crm_investors($1)`, [owner]);
    await q(`update outreach set gmail_ok = true, body = 'Hi', subject = 'Hey' where contact_id = $1`, [c]);
    expect((await todo()).messages).toEqual([]);
  });

  it("records each Gmail draft once, even when the push is retried", async () => {
    const p = await person("Retry Person");
    const key = `${p.oid}:first:`;
    expect(await record(key, "draft-1", "thread-1")).toBe("ok");
    expect(await record(key, "draft-2", "thread-2")).toBe("exists");
    expect(await q(`select kind, status, gmail_draft_id, gmail_thread_id from outreach_messages where outreach_id = $1`, [p.oid])).toEqual([
      { kind: "first", status: "in_gmail", gmail_draft_id: "draft-1", gmail_thread_id: "thread-1" },
    ]);
    expect((await todo()).messages).toEqual([]);
    expect(await record(`${randomUUID()}:first:`)).toBe("not found");
  });

  it("sending the first note runs the usual effects; the follow-up arrives on its due date in the same thread", async () => {
    const p = await person("Flow Person");
    await record(`${p.oid}:first:`, "d1", "thread-A");
    expect(await observe(`${p.oid}:first:`, "sent", "2026-10-20T15:00:00Z")).toBe("ok");
    expect(await one(`select stage, touches, next_followup_at::text as next from outreach where id = $1`, [p.oid])).toEqual({ stage: "sent", touches: 1, next: "2026-10-25" });
    expect(await one(`select stage from deals where id = $1`, [p.dealId])).toEqual({ stage: "intro" });
    expect(await one(`select status from outreach_messages where outreach_id = $1 and kind = 'first'`, [p.oid])).toEqual({ status: "sent" });
    await q(`update outreach set next_followup_at = current_date + 1 where id = $1`, [p.oid]);
    expect((await todo()).messages).toEqual([]);
    await q(`update outreach set next_followup_at = current_date where id = $1`, [p.oid]);
    expect((await todo()).messages).toEqual([expect.objectContaining({ key: `${p.oid}:followup_1:`, kind: "followup_1", subject: "Re: Hello", body: "Nudge one", thread_id: "thread-A" })]);
    await record(`${p.oid}:followup_1:`, "d2", "thread-A");
    expect(await observe(`${p.oid}:followup_1:`, "sent")).toBe("ok");
    expect(await one(`select touches from outreach where id = $1`, [p.oid])).toEqual({ touches: 2 });
    expect(await observe(`${p.oid}:followup_1:`, "replied")).toBe("ok");
    expect(await one(`select stage from outreach where id = $1`, [p.oid])).toEqual({ stage: "replied" });
  });

  it("only queues updates and launch asks for people marked Advice call done", async () => {
    await setting("raise.phase", "raising");
    const no = await person("Not Yet Talked", { stage: "sent" });
    const yes = await person("Talked To", { stage: "sent", advice: true });
    expect(await saveMsg(no.id, "launch_ask", "launch")).toBe("not ready");
    expect(await saveMsg(yes.id, "launch_ask", "launch")).toBe("ok");
    expect(await saveMsg(yes.id, "first", "")).toBe("bad kind");
    expect((await todo()).messages.map((m) => [m.kind, m.to])).toEqual([["launch_ask", "talked.to@fund.example"]]);
  });

  it("monthly update: due from the first Monday once the month's facts changed, never twice", async () => {
    await person("Ready Reader", { stage: "sent", advice: true });
    const upd = async (day: string) => (await one<{ t: { due: boolean; reason: string; period: string; people: unknown[] } }>(`select rr_update_todo($1::date, $2) as t`, [day, owner]))!.t;
    expect(await upd("2026-11-02")).toMatchObject({ due: false, reason: "no facts" });
    await setting("month.progress", "Finished the label");
    await setting("month.ask", "Intros to Houston cafés");
    await setting("month.next", "Production run");
    expect(await upd("2026-11-01")).toMatchObject({ due: false, reason: "not yet this month" });
    const t = await upd("2026-11-02");
    expect(t).toMatchObject({ due: true, period: "2026-11" });
    expect(t.people).toHaveLength(1);
    const item = (await one<{ id: string }>(`select id from radar_items where user_id = $1`, [owner]))!.id;
    expect(await saveMsg(item, "update", "2026-11")).toBe("ok");
    expect(await upd("2026-11-09")).toMatchObject({ due: false, reason: "already drafted" });
    expect(await upd("2026-12-07")).toMatchObject({ due: false, reason: "facts not updated" });
    await setting("month.progress", "First batch canned");
    expect(await upd("2026-12-07")).toMatchObject({ due: true, period: "2026-12" });
    await setting("raise.phase", "raising");
    expect(await upd("2026-12-07")).toMatchObject({ due: false, reason: "raising" });
  });

  it("launch ask: offered only in the raising phase; a reply moves the deal to Pitched, never backwards", async () => {
    const a = await person("Launch A", { stage: "sent", advice: true });
    const b = await person("Launch B", { stage: "sent", advice: true, dealStage: "term_sheet" });
    const launch = async () => (await one<{ t: { phase: string; launch_asks: { radar_item_id: string }[] } }>(`select rr_launch_todo($1) as t`, [owner]))!.t;
    expect((await launch()).launch_asks).toEqual([]);
    await setting("raise.phase", "raising");
    expect((await launch()).launch_asks.map((x) => x.radar_item_id).sort()).toEqual([a.id, b.id].sort());
    for (const p of [a, b]) {
      await saveMsg(p.id, "launch_ask", "launch");
      await record(`${p.oid}:launch_ask:launch`, `d-${p.oid}`, `t-${p.oid}`);
      expect(await observe(`${p.oid}:launch_ask:launch`, "sent")).toBe("ok");
      expect(await observe(`${p.oid}:launch_ask:launch`, "replied")).toBe("ok");
    }
    expect(await one(`select stage from deals where id = $1`, [a.dealId])).toEqual({ stage: "pitched" });
    expect(await one(`select stage from deals where id = $1`, [b.dealId])).toEqual({ stage: "term_sheet" });
    expect((await q(`select summary from activities where deal_id = $1 and type = 'email' order by occurred_at, summary`, [a.dealId])).map((x) => x.summary)).toEqual(
      expect.arrayContaining(["Sent launch ask", "Replied to launch ask"]),
    );
    expect((await launch()).launch_asks).toEqual([]);
  });

  it("watch lists drafts in Gmail and sent messages awaiting a reply", async () => {
    const p = await person("Watch Person");
    await record(`${p.oid}:first:`, "d1", "t1");
    const w = (await one<{ w: { key: string; status: string; to: string; draft_id: string }[] }>(`select rr_gmail_watch($1) as w`, [owner]))!.w;
    expect(w).toEqual([expect.objectContaining({ key: `${p.oid}:first:`, status: "in_gmail", to: "watch.person@fund.example", draft_id: "d1" })]);
    expect(await observe(`${p.oid}:first:`, "teleported")).toBe("ignored");
  });
});
