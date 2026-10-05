import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL,
);

type Db = typeof import("@/db").db;
type Schema = typeof import("@/db/schema");

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

describe.skipIf(!hasDb)("domain schema (runs against the Neon dev branch)", () => {
  let db: Db;
  let s: Schema;
  const userId = randomUUID();

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    await db.insert(s.user).values({
      id: userId,
      name: "Schema Test",
      email: `schema-${userId}@example.test`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(eq(s.user.id, userId));
  });

  it("stores an angel investor as a contact-only deal with a timeline entry and a task", async () => {
    const [contact] = await db
      .insert(s.contacts)
      .values({
        userId,
        section: "investors",
        name: "Ada Angel",
        priority: "high",
        details: { background: "operator" },
        tags: ["warm-intro"],
      })
      .returning();
    const [deal] = await db
      .insert(s.deals)
      .values({
        userId,
        section: "investors",
        contactId: contact.id,
        title: "Ada Angel",
        stage: "target",
        amountCents: 2_500_000,
        details: { investorType: "angel" },
      })
      .returning();
    const [activity] = await db
      .insert(s.activities)
      .values({ userId, type: "call", summary: "Intro call", contactId: contact.id, dealId: deal.id })
      .returning();
    const [task] = await db
      .insert(s.tasks)
      .values({ userId, title: "Send deck", dueDate: "2026-10-12", dealId: deal.id })
      .returning();

    expect(deal.status).toBe("open");
    expect(deal.amountCents).toBe(2_500_000);
    expect(contact.tags).toEqual(["warm-intro"]);
    expect(activity.occurredAt).toBeInstanceOf(Date);
    expect(task.doneAt).toBeNull();
  });

  it("stores a restaurant as a company plus a deal", async () => {
    const [company] = await db
      .insert(s.companies)
      .values({ userId, section: "restaurants", name: "Trattoria Test", city: "Chicago" })
      .returning();
    const [deal] = await db
      .insert(s.deals)
      .values({ userId, section: "restaurants", companyId: company.id, title: "Trattoria Test", stage: "lead" })
      .returning();
    expect(deal.companyId).toBe(company.id);
    expect(deal.details).toEqual({});
  });

  it("rejects a deal that has neither a company nor a contact", async () => {
    await expect(
      db.insert(s.deals).values({ userId, section: "investors", title: "Nobody", stage: "target" }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });

  it("rejects a deal in the general section", async () => {
    const [contact] = await db
      .insert(s.contacts)
      .values({ userId, section: "general", name: "Friend" })
      .returning();
    await expect(
      db.insert(s.deals).values({
        userId,
        section: "general",
        contactId: contact.id,
        title: "Not allowed",
        stage: "x",
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });

  it("rejects an activity attached to neither a contact nor a company", async () => {
    await expect(
      db.insert(s.activities).values({ userId, type: "note", summary: "Orphan" }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });

  it("deletes a contact's activities with it", async () => {
    const [contact] = await db
      .insert(s.contacts)
      .values({ userId, section: "general", name: "Short Lived" })
      .returning();
    await db.insert(s.activities).values({ userId, type: "call", summary: "Hello", contactId: contact.id });
    await db.delete(s.contacts).where(eq(s.contacts.id, contact.id));
    const left = await db.select().from(s.activities).where(eq(s.activities.contactId, contact.id));
    expect(left).toHaveLength(0);
  });

  it("refuses to delete a company that still has deals", async () => {
    const [company] = await db
      .insert(s.companies)
      .values({ userId, section: "investors", name: "Fund I" })
      .returning();
    await db.insert(s.deals).values({
      userId,
      section: "investors",
      companyId: company.id,
      title: "Fund I",
      stage: "target",
      details: { investorType: "institution" },
    });
    await expect(
      db.delete(s.companies).where(eq(s.companies.id, company.id)),
    ).rejects.toSatisfy((e) => pgCode(e) === "23503");
  });
});
