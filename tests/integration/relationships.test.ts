import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("relationships (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let rel: typeof import("@/db/queries/relationships");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const contact = async (name: string, section = "investors", o: { priority?: string | null; archived?: boolean } = {}) =>
    (await one<{ id: string }>(`insert into contacts (user_id, section, name, priority, archived_at) values ($1, $2, $3, $4, $5) returning id`,
      [owner, section, name, o.priority ?? null, o.archived ? new Date() : null]))!.id;
  const deal = async (contactId: string, stage: string, section = "investors") =>
    (await one<{ id: string }>(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, $2, $3, 'D', $4, '{"investorType":"angel"}') returning id`,
      [owner, section, contactId, stage]))!.id;
  const relOf = async (table: "contacts" | "deals", id: string) => (await one<{ r: string }>(`select relationship as r from ${table} where id = $1`, [id]))!.r;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    rel = await import("@/db/queries/relationships");
  });
  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `rel-${owner}@example.test`, emailVerified: true });
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("backfills from what already happened", async () => {
    const fresh = await contact("Fresh Target");
    const freshDeal = await deal(fresh, "target");
    const intro = await contact("At Intro");
    const introDeal = await deal(intro, "intro");
    const called = await contact("Called Target");
    const calledDeal = await deal(called, "target");
    await q(`insert into activities (user_id, type, summary, contact_id) values ($1, 'call', 'Chat', $2)`, [owner, called]);
    const found = await contact("Found Person", "general", { priority: "high" });
    await q(`insert into radar_items (user_id, feed, kind, title, url, score, status, dedupe_key, contact_id) values ($1, 'sooz', 'media', 'Found Person', 'https://x.com/f', 80, 'approved', 'media:found', $2)`, [owner, found]);
    const friend = await contact("Old Friend", "general", { priority: "medium" });
    const shelved = await contact("Shelved", "general", { archived: true });
    await q(`update contacts set relationship = 'known' where user_id = $1`, [owner]);
    await q(`update deals set relationship = 'known' where user_id = $1`, [owner]);
    await q(`select rr_backfill_relationships($1)`, [owner]);
    expect(await relOf("deals", freshDeal)).toBe("to_reach_out");
    expect(await relOf("contacts", fresh)).toBe("to_reach_out");
    expect(await relOf("deals", introDeal)).toBe("known");
    expect(await relOf("contacts", intro)).toBe("known");
    expect(await relOf("deals", calledDeal)).toBe("known");
    expect(await one(`select relationship, priority::text from contacts where id = $1`, [found])).toEqual({ relationship: "to_reach_out", priority: null });
    expect(await relOf("contacts", friend)).toBe("known");
    expect(await relOf("contacts", shelved)).toBe("on_hold");
  });

  it("logging a call, email, meeting or tasting means you know them; a note doesn't", async () => {
    const { logActivity } = await import("@/db/queries/activities");
    const c = await contact("Prospect Pat");
    const d = await deal(c, "target");
    await q(`update contacts set relationship = 'to_reach_out' where id = $1`, [c]);
    await q(`update deals set relationship = 'to_reach_out' where id = $1`, [d]);
    await logActivity(owner, { type: "note", summary: "Looked them up", contactId: c });
    expect(await relOf("contacts", c)).toBe("to_reach_out");
    await logActivity(owner, { type: "call", summary: "Called", contactId: c });
    expect(await relOf("contacts", c)).toBe("known");
    expect(await relOf("deals", d)).toBe("known");
  });

  it("moving a deal past its first stage means you know them", async () => {
    const { moveDeal } = await import("@/db/queries/deals");
    const c = await contact("Mover");
    const d = await deal(c, "target");
    await q(`update deals set relationship = 'to_reach_out' where id = $1`, [d]);
    await q(`update contacts set relationship = 'to_reach_out' where id = $1`, [c]);
    await moveDeal(owner, d, "intro");
    expect(await relOf("deals", d)).toBe("known");
    expect(await relOf("contacts", c)).toBe("known");
  });

  it("On hold and Dismissed archive a contact; Know them brings it back; reminders only for people you know", async () => {
    const { getContact } = await import("@/db/queries/contacts");
    const c = await contact("Hold Me", "general", { priority: "very_high" });
    await q(`update contacts set created_at = now() - interval '60 days' where id = $1`, [c]);
    expect((await getContact(owner, c))!.reminder.status).toBe("overdue");
    expect(await rel.setContactRelationship(owner, c, "dismissed")).toBe(true);
    expect(await one(`select relationship, archived_at is not null as archived from contacts where id = $1`, [c])).toEqual({ relationship: "dismissed", archived: true });
    expect(await rel.setContactRelationship(owner, c, "to_reach_out")).toBe(true);
    expect(await one(`select relationship, archived_at is not null as archived from contacts where id = $1`, [c])).toEqual({ relationship: "to_reach_out", archived: false });
    expect((await getContact(owner, c))!.reminder.status).toBe("none");
    await rel.setContactRelationship(owner, c, "known");
    expect((await getContact(owner, c))!.reminder.status).toBe("overdue");
    expect(await rel.setContactRelationship(randomUUID(), c, "known")).toBe(false);
  });

  it("sets a deal's relationship and its person's together, and counts per section", async () => {
    const c = await contact("Deal Person");
    const d = await deal(c, "target");
    expect(await rel.setDealRelationship(owner, d, "on_hold")).toBe(true);
    expect(await relOf("deals", d)).toBe("on_hold");
    expect(await relOf("contacts", c)).toBe("on_hold");
    expect(await rel.relationshipCounts(owner, "investors")).toMatchObject({ on_hold: 1, to_reach_out: 0, known: 0 });
    await deal(await contact("Snap Known"), "intro");
    await deal(await contact("Snap New"), "target");
    const { pipelineSnapshot } = await import("@/db/queries/dashboard");
    const snap = await pipelineSnapshot(owner, "investors");
    expect(snap.stages.filter((x) => x.count > 0).map((x) => [x.key, x.count])).toEqual([["intro", 1]]);
  });

  it("lists deals and contacts by relationship; On hold and Dismissed contacts are the archived ones", async () => {
    const { listDeals } = await import("@/db/queries/deals");
    const { listContacts } = await import("@/db/queries/contacts");
    const fresh = await deal(await contact("Fresh Fay"), "target");
    await deal(await contact("Known Kim"), "intro");
    const held = await deal(await contact("Held Hal"), "target");
    await rel.setDealRelationship(owner, held, "on_hold");
    const titles = async (r: "to_reach_out" | "known" | "on_hold") =>
      (await listDeals(owner, "investors", { relationship: r })).map((d) => d.contactName);
    expect(await titles("to_reach_out")).toEqual(["Fresh Fay"]);
    expect(await titles("known")).toEqual(["Known Kim"]);
    expect(await titles("on_hold")).toEqual(["Held Hal"]);
    expect(fresh).toBeTruthy();

    const reach = await contact("Reach Rae", "general");
    await rel.setContactRelationship(owner, reach, "to_reach_out");
    await contact("Friend Flo", "general");
    const gone = await contact("Gone Gil", "general");
    await rel.setContactRelationship(owner, gone, "dismissed");
    const names = async (r: "to_reach_out" | "known" | "dismissed") =>
      (await listContacts(owner, "general", { relationship: r })).map((c) => c.name);
    expect(await names("to_reach_out")).toEqual(["Reach Rae"]);
    expect(await names("known")).toEqual(["Friend Flo"]);
    expect(await names("dismissed")).toEqual(["Gone Gil"]);
    expect(await rel.relationshipCounts(owner, "general")).toMatchObject({ to_reach_out: 1, known: 1, dismissed: 1 });
  });

  it("Restore puts someone back where they were: To reach out if never contacted, Know them otherwise", async () => {
    const c1 = await contact("Never Met");
    const d1 = await deal(c1, "target");
    await rel.setDealRelationship(owner, d1, "dismissed");
    expect(await rel.restoreRelationship(owner, { dealId: d1 })).toBe(true);
    expect(await relOf("deals", d1)).toBe("to_reach_out");
    expect(await relOf("contacts", c1)).toBe("to_reach_out");
    const c2 = await contact("Met Once", "general");
    await q(`insert into activities (user_id, type, summary, contact_id) values ($1, 'meeting', 'Coffee', $2)`, [owner, c2]);
    await rel.setContactRelationship(owner, c2, "on_hold");
    expect(await rel.restoreRelationship(owner, { contactId: c2 })).toBe(true);
    expect(await one(`select relationship, archived_at is null as live from contacts where id = $1`, [c2])).toEqual({ relationship: "known", live: true });
    expect(await rel.restoreRelationship(randomUUID(), { contactId: c2 })).toBe(false);
  });

  it("Try again from a CRM record finds that person's outreach", async () => {
    const { approveRadarItem } = await import("@/db/queries/radar");
    const item = (await one<{ id: string }>(`insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'sooz', 'creator', 'Gone Quiet', 'https://x.com/g', 80, 'g') returning id`, [owner]))!.id;
    const a = await approveRadarItem(owner, item);
    await q(`update outreach set stage = 'sent', touches = 3, last_touch_at = now() - interval '9 days', email = 'g@x.example' where radar_item_id = $1`, [item]);
    await q(`update contacts set relationship = 'known' where id = $1`, [a.contactId]);
    expect(await rel.tryAgainFor(owner, { contactId: a.contactId })).toBe(false);
    await q(`select rr_refresh_ghosted($1)`, [owner]);
    expect(await rel.tryAgainFor(owner, { contactId: a.contactId })).toBe(true);
    expect(await relOf("contacts", a.contactId)).toBe("to_reach_out");
  });
});
