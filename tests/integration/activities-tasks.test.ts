import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("activities and tasks data layer (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Schema = typeof import("@/db/schema");
  let db: Db;
  let s: Schema;
  let a: typeof import("@/db/queries/activities");
  let t: typeof import("@/db/queries/tasks");
  const owner = randomUUID();
  const other = randomUUID();

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    a = await import("@/db/queries/activities");
    t = await import("@/db/queries/tasks");
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `at-${id}@example.test`, emailVerified: true });
    }
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  const contact = async (userId: string, name = "Person") =>
    (await db.insert(s.contacts).values({ userId, section: "general", name }).returning())[0];

  describe("activities", () => {
    it("requires a contact or company and rejects records the owner does not have", async () => {
      await expect(a.logActivity(owner, { type: "note", summary: "Orphan" })).rejects.toThrow(a.ActivityTargetError);
      const theirs = await contact(other);
      await expect(a.logActivity(owner, { type: "call", summary: "x", contactId: theirs.id })).rejects.toThrow(
        /contact does not exist/,
      );
      await expect(a.logActivity(owner, { type: "call", summary: "x", contactId: randomUUID() })).rejects.toThrow(
        a.ActivityTargetError,
      );
    });

    it("lets a deal activity inherit the deal's contact and company", async () => {
      const [company] = await db.insert(s.companies).values({ userId: owner, section: "restaurants", name: "Co" }).returning();
      const person = await contact(owner, "Chef");
      const [deal] = await db
        .insert(s.deals)
        .values({ userId: owner, section: "restaurants", companyId: company.id, contactId: person.id, title: "Co", stage: "lead" })
        .returning();
      const created = await a.logActivity(owner, { type: "tasting", summary: "Tasting", dealId: deal.id });
      expect(created.contactId).toBe(person.id);
      expect(created.companyId).toBe(company.id);
      expect(created.dealId).toBe(deal.id);
    });

    it("refuses a deal that belongs to someone else", async () => {
      const theirs = await contact(other);
      const [deal] = await db
        .insert(s.deals)
        .values({ userId: other, section: "investors", contactId: theirs.id, title: "x", stage: "target" })
        .returning();
      await expect(a.logActivity(owner, { type: "call", summary: "x", dealId: deal.id })).rejects.toThrow(/deal/);
    });

    it("deleting an activity after its contact is gone is a harmless no-op", async () => {
      const mine = await contact(owner);
      const created = await a.logActivity(owner, { type: "call", summary: "Gone", contactId: mine.id });
      await db.delete(s.contacts).where(eq(s.contacts.id, mine.id));
      expect(await a.deleteActivity(owner, created.id)).toBeNull();
    });

    it("deletes only the owner's own activity", async () => {
      const mine = await contact(owner);
      const created = await a.logActivity(owner, { type: "call", summary: "Mine", contactId: mine.id });
      expect(await a.deleteActivity(other, created.id)).toBeNull();
      expect((await a.deleteActivity(owner, created.id))?.id).toBe(created.id);
      expect(await a.listContactActivities(owner, mine.id)).toHaveLength(0);
    });
  });

  describe("follow-ups", () => {
    it("lists overdue and due-soon contacts across sections, skipping archived and reminder-less ones", async () => {
      const c = await import("@/db/queries/contacts");
      const old = new Date(Date.now() - 100 * 86_400_000);
      const make = async (name: string, section: "general" | "investors", priority: "high" | null, archived = false) =>
        (
          await db
            .insert(s.contacts)
            .values({ userId: owner, section, name, priority, createdAt: old, archivedAt: archived ? new Date() : null })
            .returning()
        )[0];
      const late = await make("FU Late", "general", "high");
      const lateInvestor = await make("FU Investor", "investors", "high");
      const none = await make("FU None", "general", null);
      const archived = await make("FU Archived", "general", "high", true);
      const ids = (await c.listFollowUps(owner)).map((x) => x.id);
      expect(ids).toContain(late.id);
      expect(ids).toContain(lateInvestor.id);
      expect(ids).not.toContain(none.id);
      expect(ids).not.toContain(archived.id);
    });
  });

  describe("tasks", () => {
    const input = (title: string, extra: Record<string, unknown> = {}) => ({ title, dueDate: null, contactId: null, ...extra });

    it("creates, completes, reopens and deletes a task", async () => {
      const created = await t.createTask(owner, input("Send deck", { dueDate: "2026-10-12" }));
      expect((await t.listOpenTasks(owner)).map((x) => x.id)).toContain(created.id);

      await t.setTaskDone(owner, created.id, true);
      expect((await t.listOpenTasks(owner)).map((x) => x.id)).not.toContain(created.id);
      expect((await t.listDoneTasks(owner)).map((x) => x.id)).toContain(created.id);

      await t.setTaskDone(owner, created.id, false);
      expect((await t.listOpenTasks(owner)).map((x) => x.id)).toContain(created.id);

      expect((await t.deleteTask(owner, created.id))?.id).toBe(created.id);
      expect((await t.listOpenTasks(owner)).map((x) => x.id)).not.toContain(created.id);
    });

    it("orders open tasks by due date with undated last and joins the contact name", async () => {
      const person = await contact(owner, "Linked Person");
      await t.createTask(owner, input("undated", { contactId: person.id }));
      await t.createTask(owner, input("later", { dueDate: "2026-12-01", contactId: person.id }));
      await t.createTask(owner, input("sooner", { dueDate: "2026-11-01", contactId: person.id }));
      const rows = await t.listOpenTasks(owner, { contactId: person.id });
      expect(rows.map((r) => r.title)).toEqual(["sooner", "later", "undated"]);
      expect(rows[0].contactName).toBe("Linked Person");
    });

    it("scopes tasks to the owner", async () => {
      const mine = await t.createTask(owner, input("Private"));
      expect(await t.setTaskDone(other, mine.id, true)).toBeNull();
      expect(await t.deleteTask(other, mine.id)).toBeNull();
      expect((await t.listOpenTasks(other)).some((x) => x.id === mine.id)).toBe(false);
      const theirs = await contact(other);
      await expect(t.createTask(owner, input("Sneaky", { contactId: theirs.id }))).rejects.toThrow(t.TaskTargetError);
    });

    it("keeps a task when its contact is deleted", async () => {
      const person = await contact(owner, "Gone Soon");
      const created = await t.createTask(owner, input("Orphaned", { contactId: person.id }));
      await db.delete(s.contacts).where(eq(s.contacts.id, person.id));
      const [row] = (await t.listOpenTasks(owner)).filter((x) => x.id === created.id);
      expect(row.contactId).toBeNull();
    });
  });
});
