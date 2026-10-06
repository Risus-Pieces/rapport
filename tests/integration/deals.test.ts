import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("deals data layer (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Schema = typeof import("@/db/schema");
  let db: Db;
  let s: Schema;
  let d: typeof import("@/db/queries/deals");
  let c: typeof import("@/db/queries/contacts");
  let co: typeof import("@/db/queries/companies");
  const owner = randomUUID();
  const other = randomUUID();

  const restaurant = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    city: null,
    cuisine: "",
    neighborhood: "",
    currentSupplier: "",
    orderFrequency: "",
    amount: null,
    nextStep: null,
    nextStepDate: null,
    stage: "lead",
    ...extra,
  });
  const investor = (name: string, investorType: "angel" | "institution", extra: Record<string, unknown> = {}) => ({
    investorType,
    name,
    email: null,
    background: "",
    firmType: "vc" as const,
    focusStage: "",
    checkSize: "",
    introducedBy: "",
    amount: null,
    nextStep: null,
    nextStepDate: null,
    ...extra,
  });

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    d = await import("@/db/queries/deals");
    c = await import("@/db/queries/contacts");
    co = await import("@/db/queries/companies");
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `deals-${id}@example.test`, emailVerified: true });
    }
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  it("creates a restaurant as a company plus a lead deal in one step", async () => {
    const deal = await d.createRestaurantDeal(
      owner,
      restaurant("Trattoria", { city: "Chicago", cuisine: "Italian", amount: 500_000, nextStep: "Call chef" }),
    );
    expect(deal).toMatchObject({ section: "restaurants", stage: "lead", status: "open", amountCents: 500_000 });
    const row = await d.getDeal(owner, deal.id);
    expect(row?.companyName).toBe("Trattoria");
    expect(row?.companyCity).toBe("Chicago");
    expect(row?.companyDetails).toEqual({ cuisine: "Italian" });
  });

  it("stores an angel as a contact-only deal and an institution as a company deal", async () => {
    const angel = await d.createInvestorDeal(owner, investor("Ada Angel", "angel", { background: "Operator" }));
    expect(angel.companyId).toBeNull();
    expect(angel.contactId).not.toBeNull();
    expect(angel.details).toEqual({ investorType: "angel" });
    expect(angel.stage).toBe("target");

    const firm = await d.createInvestorDeal(owner, investor("Fund I", "institution", { firmType: "family_office" }));
    expect(firm.contactId).toBeNull();
    expect(firm.companyId).not.toBeNull();
    expect(firm.details).toEqual({ investorType: "institution" });
    const row = await d.getDeal(owner, firm.id);
    expect(row?.companyDetails).toEqual({ firmType: "family_office" });
  });

  it("filters by investor type using the stored type", async () => {
    const angels = await d.listDeals(owner, "investors", { type: "angel" });
    expect(angels.length).toBeGreaterThan(0);
    expect(angels.every((r) => r.details.investorType === "angel")).toBe(true);
    const firms = await d.listDeals(owner, "investors", { type: "institution" });
    expect(firms.every((r) => r.details.investorType === "institution")).toBe(true);
    const all = await d.listDeals(owner, "investors");
    expect(all.length).toBe(angels.length + firms.length);
  });

  it("sets status and closedAt in terminal stages and clears them when moved out", async () => {
    const deal = await d.createRestaurantDeal(owner, restaurant("Mover"));
    const won = await d.moveDeal(owner, deal.id, "active", 5);
    expect(won).toMatchObject({ stage: "active", status: "won", sortKey: 5 });
    expect(won?.closedAt).toBeInstanceOf(Date);
    const again = await d.moveDeal(owner, deal.id, "active");
    expect(again?.closedAt?.getTime()).toBe(won?.closedAt?.getTime());
    const lost = await d.moveDeal(owner, deal.id, "lost");
    expect(lost).toMatchObject({ status: "lost" });
    const reopened = await d.moveDeal(owner, deal.id, "tasting");
    expect(reopened).toMatchObject({ stage: "tasting", status: "open", closedAt: null });
  });

  it("rejects a stage from the other pipeline and bad positions", async () => {
    const deal = await d.createRestaurantDeal(owner, restaurant("Strict"));
    await expect(d.moveDeal(owner, deal.id, "pitched")).rejects.toThrow(d.DealError);
    await expect(d.moveDeal(owner, deal.id, "active", Number.NaN)).rejects.toThrow(d.DealError);
  });

  it("scopes deals to the owner", async () => {
    const deal = await d.createRestaurantDeal(owner, restaurant("Mine Only"));
    expect(await d.getDeal(other, deal.id)).toBeNull();
    expect(await d.moveDeal(other, deal.id, "contacted")).toBeNull();
    expect(await d.updateRestaurantDeal(other, deal.id, { ...restaurant("Hijack"), stage: "lead" })).toBeNull();
    expect(await d.deleteDeal(other, deal.id)).toBe(false);
    expect((await d.listDeals(other, "restaurants")).some((r) => r.id === deal.id)).toBe(false);
  });

  it("updates the deal and its company together and moves the card to the end of the new stage", async () => {
    const deal = await d.createRestaurantDeal(owner, restaurant("Old Name"));
    const updated = await d.updateRestaurantDeal(
      owner,
      deal.id,
      restaurant("New Name", { cuisine: "Thai", amount: 120_000, stage: "negotiating", nextStep: "Send quote" }),
    );
    expect(updated).toMatchObject({ title: "New Name", stage: "negotiating", amountCents: 120_000, nextStep: "Send quote" });
    const row = await d.getDeal(owner, deal.id);
    expect(row?.companyName).toBe("New Name");
    expect(row?.companyDetails).toEqual({ cuisine: "Thai" });
  });

  it("keeps the investor type when updating", async () => {
    const angel = await d.createInvestorDeal(owner, investor("Bea Angel", "angel"));
    await d.updateInvestorDeal(owner, angel.id, { ...investor("Bea Renamed", "angel", { background: "Founder" }), stage: "pitched" });
    const row = await d.getDeal(owner, angel.id);
    expect(row).toMatchObject({ title: "Bea Renamed", stage: "pitched", contactName: "Bea Renamed" });
    expect(row?.details.investorType).toBe("angel");
    expect(row?.contactDetails).toEqual({ background: "Founder" });
  });

  describe("delete flows with deals", () => {
    it("removes an angel's deal when the angel is deleted", async () => {
      const angel = await d.createInvestorDeal(owner, investor("Gone Angel", "angel"));
      expect((await c.getContactDeleteImpact(owner, angel.contactId!)).deals).toBe(1);
      await c.deleteContact(owner, "investors", angel.contactId!);
      expect(await d.getDeal(owner, angel.id)).toBeNull();
    });

    it("removes an institution's deals but keeps its partner contact", async () => {
      const firm = await d.createInvestorDeal(owner, investor("Gone Fund", "institution"));
      const [partner] = await db
        .insert(s.contacts)
        .values({ userId: owner, section: "investors", name: "Partner", companyId: firm.companyId })
        .returning();
      await db.update(s.deals).set({ contactId: partner.id }).where(eq(s.deals.id, firm.id));
      await co.deleteCompany(owner, firm.companyId!);
      expect(await d.getDeal(owner, firm.id)).toBeNull();
      const [kept] = await db.select().from(s.contacts).where(eq(s.contacts.id, partner.id));
      expect(kept.companyId).toBeNull();
    });

    it("deleting a deal clears activity.deal_id and keeps the activity", async () => {
      const deal = await d.createRestaurantDeal(owner, restaurant("Keeps History"));
      const [activity] = await db
        .insert(s.activities)
        .values({ userId: owner, type: "tasting", summary: "Tasting", companyId: deal.companyId, dealId: deal.id })
        .returning();
      expect(await d.deleteDeal(owner, deal.id)).toBe(true);
      const [kept] = await db.select().from(s.activities).where(eq(s.activities.id, activity.id));
      expect(kept.dealId).toBeNull();
      expect(kept.companyId).toBe(deal.companyId);
    });
  });
});
