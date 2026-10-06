import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("search (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Schema = typeof import("@/db/schema");
  let db: Db;
  let s: Schema;
  let search: typeof import("@/db/queries/search").searchRecords;
  const owner = randomUUID();
  const other = randomUUID();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    ({ searchRecords: search } = await import("@/db/queries/search"));
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `search-${id}@example.test`, emailVerified: true });
    }
    const [company] = await db.insert(s.companies).values({ userId: owner, section: "restaurants", name: "Zebra Grill" }).returning();
    const [deal] = await db
      .insert(s.deals)
      .values({ userId: owner, section: "restaurants", companyId: company.id, title: "Zebra Grill", stage: "tasting" })
      .returning();
    ids.deal = deal.id;
    const [chef] = await db
      .insert(s.contacts)
      .values({ userId: owner, section: "restaurants", name: "Zelda Chef", companyId: company.id, title: "Chef" })
      .returning();
    ids.chef = chef.id;
    const [friend] = await db.insert(s.contacts).values({ userId: owner, section: "general", name: "Zed Friend", email: "zed@x.test" }).returning();
    ids.friend = friend.id;
    await db.insert(s.contacts).values({ userId: owner, section: "general", name: "Zoe Archived", archivedAt: new Date() });
    await db.insert(s.contacts).values({ userId: other, section: "general", name: "Zed Stranger" });
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  it("ignores queries shorter than two characters", async () => {
    expect(await search(owner, "z")).toEqual([]);
  });

  it("finds deals, general contacts and links each to its page", async () => {
    const zed = await search(owner, "zed");
    expect(zed).toHaveLength(1);
    expect(zed[0]).toMatchObject({ label: "Zed Friend", href: `/general/${ids.friend}` });
    const zebra = await search(owner, "zebra");
    expect(zebra[0]).toMatchObject({ label: "Zebra Grill", href: `/restaurants/${ids.deal}` });
    expect(zebra[0].detail).toContain("Tasting");
  });

  it("sends a restaurant contact to its company's deal, and does not list the deal twice", async () => {
    const chef = (await search(owner, "zelda"))[0];
    expect(chef).toMatchObject({ label: "Zelda Chef", href: `/restaurants/${ids.deal}` });
    // "ze" matches both the deal and its chef: only the deal is listed.
    const both = await search(owner, "ze");
    expect(both.filter((h) => h.href === `/restaurants/${ids.deal}`)).toHaveLength(1);
  });

  it("skips archived contacts and other users' records, and matches % literally", async () => {
    const all = await search(owner, "zo");
    expect(all.map((h) => h.label)).not.toContain("Zoe Archived");
    expect((await search(owner, "zed")).map((h) => h.label)).not.toContain("Zed Stranger");
    expect(await search(owner, "z%")).toEqual([]);
  });
});
