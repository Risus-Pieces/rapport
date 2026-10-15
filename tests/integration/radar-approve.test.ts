import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("approving radar findings into the CRM (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let r: typeof import("@/db/queries/radar");
  let owner = randomUUID();
  const users: string[] = [];

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];

  const item = async (title: string, o: { kind?: string; firm?: string; role?: string; feed?: string; tags?: string[] } = {}) =>
    (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, details, dedupe_key, summary, why_relevant, tags)
       values ($1, $2, $3, $4, 'https://src.example/' || $5, 85, $6::jsonb, $5, 'Backed two beverage brands in 2025.', 'Beverage operator.', $7)
       returning id`,
      [owner, o.feed ?? "sooz", o.kind ?? "angel", title, `${o.kind ?? "angel"}-${title}-${o.firm ?? ""}`.toLowerCase().replace(/\W+/g, "-"),
       JSON.stringify({ firm: o.firm ?? "Acme Ventures", role: o.role ?? "Partner", contact_path: "Taste Radio guest", rice_connection: "MBA '09" }),
       o.tags ?? ["beverage"]],
    ))!.id;
  const contactsNamed = (name: string) => q<{ id: string; section: string }>(`select id, section::text from contacts where user_id = $1 and name = $2`, [owner, name]);
  const dealsFor = (contactId: string) => q<{ id: string; stage: string }>(`select id, stage from deals where user_id = $1 and contact_id = $2`, [owner, contactId]);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    r = await import("@/db/queries/radar");
  });

  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `radar-a-${owner}@example.test`, emailVerified: true });
  });

  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("an angel becomes an Investors angel deal at Target, with the research on the contact", async () => {
    const id = await item("Jane Doe");
    const res = await r.approveRadarItem(owner, id);
    expect(res.section).toBe("investors");
    expect(res.companyId).toBeNull();
    expect(res.href).toBe(`/investors/${res.dealId}`);
    const c = (await one<{ title: string; details: Record<string, unknown>; tags: string[]; priority: string | null }>(
      `select title, details, tags, priority::text from contacts where id = $1`, [res.contactId]))!;
    expect(c.title).toBe("Partner · Acme Ventures");
    expect(c.details.background).toBe("Backed two beverage brands in 2025.");
    expect(c.details.radar).toMatchObject({
      radarItemId: id, kind: "angel", sourceUrl: expect.stringContaining("https://src.example/"), whyRelevant: "Beverage operator.",
      contactPath: "Taste Radio guest", riceConnection: "MBA '09",
    });
    expect(c.tags).toEqual(["beverage"]);
    expect(await one(`select stage, status::text, details, company_id from deals where id = $1`, [res.dealId])).toEqual({
      stage: "target", status: "open", details: { investorType: "angel" }, company_id: null,
    });
    expect(await q(`select type::text, summary from activities where contact_id = $1`, [res.contactId])).toEqual([
      { type: "note", summary: "Added from Radar" },
    ]);
    expect(await one(`select status, contact_id, deal_id, company_id from radar_items where id = $1`, [id])).toEqual({
      status: "approved", contact_id: res.contactId, deal_id: res.dealId, company_id: null,
    });
  });

  it("a next-gen investor is an angel deal too", async () => {
    const res = await r.approveRadarItem(owner, await item("Nia Heir", { kind: "nextgen" }));
    expect(res.section).toBe("investors");
    expect(await dealsFor(res.contactId)).toHaveLength(1);
  });

  it("a buyer becomes a Restaurants company + contact + Lead deal; a second buyer there reuses both company and deal", async () => {
    const first = await r.approveRadarItem(owner, await item("Bea Buyer", { kind: "buyer", firm: "H-E-B; Central Market", role: "Category manager" }));
    expect(first.section).toBe("restaurants");
    expect(await one(`select name, section::text from companies where id = $1`, [first.companyId])).toEqual({ name: "H-E-B", section: "restaurants" });
    expect(await one(`select company_id, title from contacts where id = $1`, [first.contactId])).toEqual({ company_id: first.companyId, title: "Category manager" });
    expect(await one(`select stage, company_id, contact_id from deals where id = $1`, [first.dealId])).toEqual({
      stage: "lead", company_id: first.companyId, contact_id: null,
    });
    const second = await r.approveRadarItem(owner, await item("Cal Buyer", { kind: "buyer", firm: "h-e-b" }));
    expect(second.companyId).toBe(first.companyId);
    expect(second.dealId).toBe(first.dealId);
    expect(second.href).toBe(`/restaurants/${first.dealId}`);
    expect((await one<{ n: number }>(`select count(*)::int n from deals where user_id = $1`, [owner]))!.n).toBe(1);
  });

  it("celebrities, creators and press become General contacts with high priority and no deal", async () => {
    for (const kind of ["celebrity", "creator", "media"]) {
      const res = await r.approveRadarItem(owner, await item(`Person ${kind}`, { kind }));
      expect(res).toMatchObject({ section: "general", dealId: null, companyId: null, href: `/general/${res.contactId}` });
      expect(await one(`select section::text, priority::text from contacts where id = $1`, [res.contactId])).toEqual({ section: "general", priority: "high" });
    }
  });

  it("links an existing same-name contact instead of duplicating it", async () => {
    const existing = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'investors', 'jane doe') returning id`, [owner]))!.id;
    const res = await r.approveRadarItem(owner, await item("Jane Doe"));
    expect(res.contactId).toBe(existing);
    expect(await contactsNamed("Jane Doe")).toHaveLength(0);
    expect(await dealsFor(existing)).toHaveLength(1);
    const again = await r.approveRadarItem(owner, await item("Jane Doe", { firm: "Other Fund" }));
    expect(again.contactId).toBe(existing);
    expect(again.dealId).toBe(res.dealId);
  });

  it("carries the outreach email, LinkedIn and links the outreach row", async () => {
    const id = await item("Ola Reach");
    await q(`insert into outreach (user_id, radar_item_id, email, linkedin_url, purpose) values ($1, $2, 'ola@fund.vc', 'https://www.linkedin.com/in/ola', 'invest')`, [owner, id]);
    const res = await r.approveRadarItem(owner, id);
    expect(await one(`select email, linkedin_url from contacts where id = $1`, [res.contactId])).toEqual({ email: "ola@fund.vc", linkedin_url: "https://www.linkedin.com/in/ola" });
    expect(await one(`select contact_id, deal_id from outreach where radar_item_id = $1`, [id])).toEqual({ contact_id: res.contactId, deal_id: res.dealId });
  });

  it("is idempotent, even when two approvals race", async () => {
    const id = await item("Race Person");
    const [a, b] = await Promise.all([r.approveRadarItem(owner, id), r.approveRadarItem(owner, id)]);
    expect(a.contactId).toBe(b.contactId);
    expect(a.dealId).toBe(b.dealId);
    expect(await contactsNamed("Race Person")).toHaveLength(1);
    expect((await one<{ n: number }>(`select count(*)::int n from activities where user_id = $1`, [owner]))!.n).toBe(1);
  });

  it("can approve again after the CRM contact was deleted", async () => {
    const id = await item("Gone Person", { kind: "media" });
    const first = await r.approveRadarItem(owner, id);
    await q(`delete from contacts where id = $1`, [first.contactId]);
    expect(await one(`select status, contact_id from radar_items where id = $1`, [id])).toEqual({ status: "approved", contact_id: null });
    const again = await r.approveRadarItem(owner, id);
    expect(again.contactId).not.toBe(first.contactId);
    expect(await contactsNamed("Gone Person")).toHaveLength(1);
  });

  it("refuses non-people, other feeds, other owners' items and missing items", async () => {
    await expect(r.approveRadarItem(owner, await item("Expo", { kind: "event" }))).rejects.toThrow(r.RadarError);
    await expect(r.approveRadarItem(owner, await item("Intern Person", { feed: "career", kind: "internship" }))).rejects.toThrow(r.RadarError);
    await expect(r.approveRadarItem(randomUUID(), await item("Not Yours"))).rejects.toThrow(r.RadarError);
    await expect(r.approveRadarItem(owner, randomUUID())).rejects.toThrow(r.RadarError);
  });
});
