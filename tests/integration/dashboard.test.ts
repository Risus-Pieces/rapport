import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("dashboard queries (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Schema = typeof import("@/db/schema");
  let db: Db;
  let s: Schema;
  let q: typeof import("@/db/queries/dashboard");
  const owner = randomUUID();
  const other = randomUUID();

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    q = await import("@/db/queries/dashboard");
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `dash-${id}@example.test`, emailVerified: true });
    }
    const [mine] = await db.insert(s.companies).values({ userId: owner, section: "restaurants", name: "Mine" }).returning();
    const [theirs] = await db.insert(s.companies).values({ userId: other, section: "restaurants", name: "Theirs" }).returning();
    await db.insert(s.deals).values([
      { userId: owner, section: "restaurants", companyId: mine.id, title: "a", stage: "lead", amountCents: 1000 },
      { userId: owner, section: "restaurants", companyId: mine.id, title: "b", stage: "lead", amountCents: 500 },
      { userId: owner, section: "restaurants", companyId: mine.id, title: "c", stage: "active", status: "won", amountCents: 7000 },
      { userId: other, section: "restaurants", companyId: theirs.id, title: "x", stage: "lead", amountCents: 999_999 },
    ]);
    await db.insert(s.activities).values([
      { userId: owner, type: "call", summary: "old", companyId: mine.id, occurredAt: new Date("2026-01-01") },
      { userId: owner, type: "call", summary: "new", companyId: mine.id, occurredAt: new Date("2026-02-01") },
      { userId: other, type: "call", summary: "not mine", companyId: theirs.id },
    ]);
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  it("totals the owner's pipeline by stage and ignores other users", async () => {
    const snap = await q.pipelineSnapshot(owner, "restaurants");
    expect(snap.stages.find((x) => x.key === "lead")).toMatchObject({ count: 2, amountCents: 1500 });
    expect(snap).toMatchObject({ openCount: 2, openCents: 1500, wonCount: 1 });
    const empty = await q.pipelineSnapshot(owner, "investors");
    expect(empty.openCount).toBe(0);
  });

  it("lists the owner's recent activity newest first", async () => {
    const rows = await q.recentActivities(owner, 5);
    expect(rows.map((r) => r.summary)).toEqual(["new", "old"]);
    expect(rows[0].companyName).toBe("Mine");
  });
});
