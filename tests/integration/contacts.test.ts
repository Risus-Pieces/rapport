import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("contacts and companies data layer (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Schema = typeof import("@/db/schema");
  type C = typeof import("@/db/queries/contacts");
  type Co = typeof import("@/db/queries/companies");
  let db: Db;
  let s: Schema;
  let c: C;
  let co: Co;
  const owner = randomUUID();
  const other = randomUUID();
  const input = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    title: null,
    email: null,
    phone: null,
    linkedinUrl: null,
    notes: null,
    priority: null,
    tags: [] as string[],
    ...extra,
  });
  const companyInput = (name: string) => ({ name, website: null, city: null, notes: null, tags: [] as string[] });
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    c = await import("@/db/queries/contacts");
    co = await import("@/db/queries/companies");
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `contacts-${id}@example.test`, emailVerified: true });
    }
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  it("computes overdue status from calls, emails, meetings and tastings but not notes", async () => {
    const stale = await c.createContact(owner, "general", input("Stale Friend", { priority: "high" }));
    await db.update(s.contacts).set({ createdAt: days(100) }).where(eq(s.contacts.id, stale.id));
    await c.logTouch(owner, stale.id, { type: "note", summary: "Thought of them", occurredAt: days(1) });
    let [row] = (await c.listContacts(owner, "general")).filter((x) => x.id === stale.id);
    expect(row.lastTouchAt).toBeNull();
    expect(row.reminder.status).toBe("overdue");

    await c.logTouch(owner, stale.id, { type: "call", summary: "Caught up", occurredAt: days(2) });
    [row] = (await c.listContacts(owner, "general")).filter((x) => x.id === stale.id);
    expect(row.lastTouchAt?.getTime()).toBeGreaterThan(days(3).getTime());
    expect(row.reminder.status).toBe("on_track");
  });

  it("sorts overdue contacts first", async () => {
    const fresh = await c.createContact(owner, "general", input("Zed Fresh", { priority: "low" }));
    const late = await c.createContact(owner, "general", input("Amy Late", { priority: "very_high" }));
    await db.update(s.contacts).set({ createdAt: days(60) }).where(eq(s.contacts.id, late.id));
    const names = (await c.listContacts(owner, "general")).map((x) => x.name);
    expect(names.indexOf("Amy Late")).toBeLessThan(names.indexOf("Zed Fresh"));
    expect(fresh.id).toBeTruthy();
  });

  it("scopes every read and write to the owner", async () => {
    const mine = await c.createContact(owner, "general", input("Private Pat"));
    expect(await c.getContact(other, mine.id)).toBeNull();
    expect(await c.updateContact(other, "general", mine.id, input("Hijacked"))).toBeNull();
    expect(await c.setContactArchived(other, "general", mine.id, true)).toBe(false);
    expect(await c.deleteContact(other, "general", mine.id)).toBe(false);
    expect(await c.logTouch(other, mine.id, { type: "call", summary: "x" })).toBeNull();
    expect((await c.listContacts(other, "general")).some((x) => x.id === mine.id)).toBe(false);
    expect((await c.getContact(owner, mine.id))?.name).toBe("Private Pat");

    const company = await co.createCompany(owner, "restaurants", companyInput("Private Bistro"));
    expect(await co.getCompany(other, company.id)).toBeNull();
    expect(await co.updateCompany(other, company.id, companyInput("Hijacked"))).toBeNull();
    expect(await co.deleteCompany(other, company.id)).toBe(false);
  });

  it("only touches contacts in the section the caller names", async () => {
    const partner = await c.createContact(owner, "investors", input("Partner Pat"));
    expect(await c.updateContact(owner, "general", partner.id, input("Renamed"))).toBeNull();
    expect(await c.setContactArchived(owner, "general", partner.id, true)).toBe(false);
    expect(await c.deleteContact(owner, "general", partner.id)).toBe(false);
    expect((await c.getContact(owner, partner.id))?.name).toBe("Partner Pat");
  });

  it("keeps the company link when an update does not mention it, and clears it when blank", async () => {
    const company = await co.createCompany(owner, "restaurants", companyInput("Linked Co"));
    const person = await c.createContact(owner, "restaurants", input("Linked", { companyId: company.id }));
    await c.updateContact(owner, "restaurants", person.id, input("Linked Renamed"));
    expect((await c.getContact(owner, person.id))?.companyId).toBe(company.id);
    await c.updateContact(owner, "restaurants", person.id, input("Linked Renamed", { companyId: null }));
    expect((await c.getContact(owner, person.id))?.companyId).toBeNull();
  });

  it("lists the newest activities first and caps the list", async () => {
    const person = await c.createContact(owner, "general", input("Chatty"));
    for (let i = 0; i < 12; i++) {
      await c.logTouch(owner, person.id, { type: "call", summary: `call ${i}`, occurredAt: days(30 - i) });
    }
    const recent = await c.listRecentActivities(owner, person.id, 10);
    expect(recent).toHaveLength(10);
    expect(recent[0].summary).toBe("call 11");
    expect(recent[9].summary).toBe("call 2");
  });

  it("shows no live reminder for an archived contact", async () => {
    const person = await c.createContact(owner, "general", input("Archived Late", { priority: "very_high" }));
    await db.update(s.contacts).set({ createdAt: days(100) }).where(eq(s.contacts.id, person.id));
    await c.setContactArchived(owner, "general", person.id, true);
    const [row] = (await c.listContacts(owner, "general", { archived: true })).filter((x) => x.id === person.id);
    expect(row.reminder.status).toBe("none");
    expect((await c.getContact(owner, person.id))?.reminder.status).toBe("none");
  });

  it("matches search text literally, including % and _", async () => {
    await c.createContact(owner, "general", input("100% Pure"));
    await c.createContact(owner, "general", input("Plain Name"));
    const hits = await c.listContacts(owner, "general", { q: "100%" });
    expect(hits.map((x) => x.name)).toEqual(["100% Pure"]);
    expect(await c.listContacts(owner, "general", { q: "%" })).toHaveLength(1);
  });

  it("hides archived contacts by default and restores them", async () => {
    const x = await c.createContact(owner, "general", input("Archivable"));
    await c.setContactArchived(owner, "general", x.id, true);
    expect((await c.listContacts(owner, "general")).some((r) => r.id === x.id)).toBe(false);
    expect((await c.listContacts(owner, "general", { archived: true })).some((r) => r.id === x.id)).toBe(true);
    await c.setContactArchived(owner, "general", x.id, false);
    expect((await c.listContacts(owner, "general")).some((r) => r.id === x.id)).toBe(true);
  });

  it("refuses a company from another section or another owner", async () => {
    const restaurant = await co.createCompany(owner, "restaurants", companyInput("Wrong Section"));
    const theirs = await co.createCompany(other, "general", companyInput("Theirs"));
    await expect(c.createContact(owner, "general", input("A", { companyId: restaurant.id }))).rejects.toThrow(
      c.InvalidCompanyError,
    );
    await expect(c.createContact(owner, "general", input("B", { companyId: theirs.id }))).rejects.toThrow(
      c.InvalidCompanyError,
    );
  });

  describe("delete flows", () => {
    it("deleting a contact removes its activities, nulls its tasks and removes sole-party deals", async () => {
      const contact = await c.createContact(owner, "investors", input("Ada Angel"));
      await c.logTouch(owner, contact.id, { type: "call", summary: "Intro" });
      const [task] = await db.insert(s.tasks).values({ userId: owner, title: "Send deck", contactId: contact.id }).returning();
      const [deal] = await db
        .insert(s.deals)
        .values({ userId: owner, section: "investors", contactId: contact.id, title: "Ada", stage: "target" })
        .returning();
      expect(await c.getContactDeleteImpact(owner, contact.id)).toEqual({
        activities: 1,
        deals: 1,
        detachedDeals: 0,
        tasks: 1,
      });

      expect(await c.deleteContact(owner, "investors", contact.id)).toBe(true);

      expect(await db.select().from(s.activities).where(eq(s.activities.contactId, contact.id))).toHaveLength(0);
      expect(await db.select().from(s.deals).where(eq(s.deals.id, deal.id))).toHaveLength(0);
      const [keptTask] = await db.select().from(s.tasks).where(eq(s.tasks.id, task.id));
      expect(keptTask.contactId).toBeNull();
    });

    it("deleting a contact detaches it from a deal that also has a company", async () => {
      const company = await co.createCompany(owner, "restaurants", companyInput("Chef Place"));
      const chef = await c.createContact(owner, "restaurants", input("Chef", { companyId: company.id }));
      const [deal] = await db
        .insert(s.deals)
        .values({
          userId: owner,
          section: "restaurants",
          companyId: company.id,
          contactId: chef.id,
          title: "Chef Place",
          stage: "lead",
        })
        .returning();
      expect((await c.getContactDeleteImpact(owner, chef.id)).detachedDeals).toBe(1);
      await c.deleteContact(owner, "restaurants", chef.id);
      const [kept] = await db.select().from(s.deals).where(eq(s.deals.id, deal.id));
      expect(kept.contactId).toBeNull();
      expect(kept.companyId).toBe(company.id);
    });

    it("deleting a company removes its deals and activities and unlinks its contacts and tasks", async () => {
      const company = await co.createCompany(owner, "restaurants", companyInput("Doomed Diner"));
      const person = await c.createContact(owner, "restaurants", input("Owner Person", { companyId: company.id }));
      const [deal] = await db
        .insert(s.deals)
        .values({ userId: owner, section: "restaurants", companyId: company.id, title: "Doomed", stage: "lead" })
        .returning();
      await db.insert(s.activities).values({
        userId: owner,
        type: "tasting",
        summary: "Tasting",
        companyId: company.id,
        dealId: deal.id,
      });
      const [task] = await db.insert(s.tasks).values({ userId: owner, title: "Call", companyId: company.id }).returning();
      expect(await co.getCompanyDeleteImpact(owner, company.id)).toEqual({ activities: 1, deals: 1, contacts: 1 });

      expect(await co.deleteCompany(owner, company.id)).toBe(true);

      expect(await db.select().from(s.deals).where(eq(s.deals.id, deal.id))).toHaveLength(0);
      expect(await db.select().from(s.activities).where(eq(s.activities.companyId, company.id))).toHaveLength(0);
      const [keptPerson] = await db.select().from(s.contacts).where(eq(s.contacts.id, person.id));
      expect(keptPerson.companyId).toBeNull();
      const [keptTask] = await db.select().from(s.tasks).where(eq(s.tasks.id, task.id));
      expect(keptTask.companyId).toBeNull();
    });

    it("deleting a deal clears activities.deal_id and keeps the activity", async () => {
      const contact = await c.createContact(owner, "investors", input("Keeps History"));
      const [deal] = await db
        .insert(s.deals)
        .values({ userId: owner, section: "investors", contactId: contact.id, title: "Deal", stage: "target" })
        .returning();
      const [activity] = await db
        .insert(s.activities)
        .values({ userId: owner, type: "call", summary: "Call", contactId: contact.id, dealId: deal.id })
        .returning();
      await db.delete(s.deals).where(eq(s.deals.id, deal.id));
      const [kept] = await db.select().from(s.activities).where(eq(s.activities.id, activity.id));
      expect(kept.dealId).toBeNull();
    });
  });
});
