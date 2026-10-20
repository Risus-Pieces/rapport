import { and, asc, eq, ilike, max, or } from "drizzle-orm";
import { needsRenumber } from "@/lib/board";
import { db } from "@/db";
import { companies, contacts, deals, type DealStatus } from "@/db/schema";
import {
  checkInvestorParties,
  compactDetails,
  firstStage,
  investorTypeOf,
  stageChange,
  type InvestorType,
  type PipelineSection,
} from "@/lib/sections";
import type { Relationship } from "@/lib/relationships";
import type { InvestorInput, RestaurantInput } from "@/lib/validation/deal";
import { escapeLike } from "./util";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export class DealError extends Error {}

const dealRow = {
  id: deals.id,
  section: deals.section,
  title: deals.title,
  stage: deals.stage,
  status: deals.status,
  amountCents: deals.amountCents,
  nextStep: deals.nextStep,
  nextStepDate: deals.nextStepDate,
  closedAt: deals.closedAt,
  sortKey: deals.sortKey,
  details: deals.details,
  companyId: deals.companyId,
  contactId: deals.contactId,
  relationship: deals.relationship,
  createdAt: deals.createdAt,
  companyName: companies.name,
  companyCity: companies.city,
  companyDetails: companies.details,
  contactName: contacts.name,
  contactEmail: contacts.email,
  contactDetails: contacts.details,
};

export type DealRow = {
  id: string;
  section: "restaurants" | "investors" | "general";
  title: string;
  stage: string;
  status: DealStatus;
  amountCents: number | null;
  nextStep: string | null;
  nextStepDate: string | null;
  closedAt: Date | null;
  sortKey: number;
  details: Record<string, unknown>;
  companyId: string | null;
  contactId: string | null;
  relationship: string;
  createdAt: Date;
  companyName: string | null;
  companyCity: string | null;
  companyDetails: Record<string, unknown> | null;
  contactName: string | null;
  contactEmail: string | null;
  contactDetails: Record<string, unknown> | null;
};

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function nextSortKey(tx: Tx, userId: string, section: PipelineSection, stage: string) {
  const [row] = await tx
    .select({ top: max(deals.sortKey) })
    .from(deals)
    .where(and(eq(deals.userId, userId), eq(deals.section, section), eq(deals.stage, stage)));
  return (row?.top ?? 0) + 1;
}

// A restaurant is a company plus its first deal, created together.
export async function createRestaurantDeal(userId: string, input: RestaurantInput) {
  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        userId,
        section: "restaurants",
        name: input.name,
        city: input.city,
        details: compactDetails({
          cuisine: input.cuisine,
          neighborhood: input.neighborhood,
          currentSupplier: input.currentSupplier,
          orderFrequency: input.orderFrequency,
        }),
      })
      .returning();
    const stage = firstStage("restaurants").key;
    const [deal] = await tx
      .insert(deals)
      .values({
        userId,
        section: "restaurants",
        companyId: company.id,
        title: input.name,
        stage,
        amountCents: input.amount,
        nextStep: input.nextStep,
        nextStepDate: input.nextStepDate,
        sortKey: await nextSortKey(tx, userId, "restaurants", stage),
      })
      .returning();
    return deal;
  });
}

// Every investor gets a pipeline card. Angels are a contact only; institutions are a company.
export async function createInvestorDeal(userId: string, input: InvestorInput) {
  return db.transaction(async (tx) => {
    let companyId: string | null = null;
    let contactId: string | null = null;
    if (input.investorType === "angel") {
      const [contact] = await tx
        .insert(contacts)
        .values({
          userId,
          section: "investors",
          name: input.name,
          email: input.email,
          details: compactDetails({ background: input.background }),
        })
        .returning();
      contactId = contact.id;
    } else {
      const [company] = await tx
        .insert(companies)
        .values({
          userId,
          section: "investors",
          name: input.name,
          details: compactDetails({
            firmType: input.firmType,
            focusStage: input.focusStage,
            checkSize: input.checkSize,
            introducedBy: input.introducedBy,
          }),
        })
        .returning();
      companyId = company.id;
    }
    const problem = checkInvestorParties(input.investorType, { companyId, contactId });
    if (problem) throw new DealError(problem);
    const stage = firstStage("investors").key;
    const [deal] = await tx
      .insert(deals)
      .values({
        userId,
        section: "investors",
        companyId,
        contactId,
        title: input.name,
        stage,
        amountCents: input.amount,
        nextStep: input.nextStep,
        nextStepDate: input.nextStepDate,
        details: { investorType: input.investorType },
        sortKey: await nextSortKey(tx, userId, "investors", stage),
      })
      .returning();
    return deal;
  });
}

export async function listDeals(
  userId: string,
  section: PipelineSection,
  options: { type?: InvestorType; q?: string; relationship?: Relationship } = {},
): Promise<DealRow[]> {
  const q = options.q?.trim();
  const rows = await db
    .select(dealRow)
    .from(deals)
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(
      and(
        eq(deals.userId, userId),
        eq(deals.section, section),
        options.relationship ? eq(deals.relationship, options.relationship) : undefined,
        q
          ? or(
              ilike(deals.title, `%${escapeLike(q)}%`),
              ilike(companies.name, `%${escapeLike(q)}%`),
              ilike(contacts.name, `%${escapeLike(q)}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(deals.sortKey), asc(deals.createdAt));
  const typed = options.type ? rows.filter((r) => investorTypeOf(r.details) === options.type) : rows;
  return typed as DealRow[];
}

export async function getDeal(userId: string, id: string): Promise<DealRow | null> {
  const [row] = await db
    .select(dealRow)
    .from(deals)
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(deals.userId, userId), eq(deals.id, id)));
  return (row as DealRow | undefined) ?? null;
}

function closedAtFor(existing: { status: DealStatus; closedAt: Date | null }, change: { status: DealStatus; closedAt: Date | null }) {
  // Re-dropping into the same terminal stage must not reset when it closed.
  if (change.status === "open") return null;
  return existing.status === change.status && existing.closedAt ? existing.closedAt : change.closedAt;
}

/** Moves a deal to a stage (and position) on the board; terminal stages set status and closedAt. */
export async function moveDeal(userId: string, id: string, stageKey: string, sortKey?: number) {
  const [existing] = await db
    .select({ section: deals.section, status: deals.status, closedAt: deals.closedAt })
    .from(deals)
    .where(and(eq(deals.userId, userId), eq(deals.id, id)));
  if (!existing || existing.section === "general") return null;
  const change = stageChange(existing.section as PipelineSection, stageKey);
  if (!change) throw new DealError("That stage does not exist for this pipeline.");
  if (sortKey !== undefined && !Number.isFinite(sortKey)) throw new DealError("Invalid position.");
  const [updated] = await db
    .update(deals)
    .set({
      stage: change.stage,
      status: change.status,
      closedAt: closedAtFor(existing, change),
      ...(sortKey !== undefined ? { sortKey } : {}),
    })
    .where(and(eq(deals.userId, userId), eq(deals.id, id)))
    .returning();
  if (updated && sortKey !== undefined) await renumberIfCrowded(userId, updated.section as PipelineSection, updated.stage);
  return updated ?? null;
}

// Repeated drops into one gap halve it until two keys collide; when that is close, renumber the
// column 1..n in its current order so later drops keep working.
async function renumberIfCrowded(userId: string, section: PipelineSection, stage: string) {
  const column = await db
    .select({ id: deals.id, sortKey: deals.sortKey })
    .from(deals)
    .where(and(eq(deals.userId, userId), eq(deals.section, section), eq(deals.stage, stage)))
    .orderBy(asc(deals.sortKey), asc(deals.createdAt));
  if (!needsRenumber(column.map((row) => row.sortKey))) return;
  await db.transaction(async (tx) => {
    for (const [index, row] of column.entries()) {
      await tx.update(deals).set({ sortKey: index + 1 }).where(and(eq(deals.userId, userId), eq(deals.id, row.id)));
    }
  });
}

type Facts = { amount: number | null; nextStep: string | null; nextStepDate: string | null; stage: string };

async function applyDealFacts(tx: Tx, userId: string, deal: typeof deals.$inferSelect, title: string, input: Facts) {
  const change = stageChange(deal.section as PipelineSection, input.stage);
  if (!change) throw new DealError("That stage does not exist for this pipeline.");
  const [updated] = await tx
    .update(deals)
    .set({
      title,
      amountCents: input.amount,
      nextStep: input.nextStep,
      nextStepDate: input.nextStepDate,
      stage: change.stage,
      status: change.status,
      closedAt: closedAtFor(deal, change),
      ...(change.stage !== deal.stage
        ? { sortKey: await nextSortKey(tx, userId, deal.section as PipelineSection, change.stage) }
        : {}),
    })
    .where(and(eq(deals.userId, userId), eq(deals.id, deal.id)))
    .returning();
  return updated;
}

export async function updateRestaurantDeal(userId: string, id: string, input: RestaurantInput & { stage: string }) {
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.id, id), eq(deals.section, "restaurants")));
    if (!deal) return null;
    if (!stageChange("restaurants", input.stage)) throw new DealError("That stage does not exist for this pipeline.");
    if (deal.companyId) {
      await tx
        .update(companies)
        .set({
          name: input.name,
          city: input.city,
          details: compactDetails({
            cuisine: input.cuisine,
            neighborhood: input.neighborhood,
            currentSupplier: input.currentSupplier,
            orderFrequency: input.orderFrequency,
          }),
        })
        .where(and(eq(companies.userId, userId), eq(companies.id, deal.companyId)));
    }
    return applyDealFacts(tx, userId, deal, input.name, input);
  });
}

export async function updateInvestorDeal(
  userId: string,
  id: string,
  input: Omit<InvestorInput, "investorType"> & { stage: string },
) {
  return db.transaction(async (tx) => {
    const [deal] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.id, id), eq(deals.section, "investors")));
    if (!deal) return null;
    const type = investorTypeOf(deal.details);
    if (!type) throw new DealError("This investor has no type.");
    if (!stageChange("investors", input.stage)) throw new DealError("That stage does not exist for this pipeline.");
    if (type === "angel" && deal.contactId) {
      await tx
        .update(contacts)
        .set({ name: input.name, email: input.email, details: compactDetails({ background: input.background }) })
        .where(and(eq(contacts.userId, userId), eq(contacts.id, deal.contactId)));
    }
    if (type === "institution" && deal.companyId) {
      await tx
        .update(companies)
        .set({
          name: input.name,
          details: compactDetails({
            firmType: input.firmType,
            focusStage: input.focusStage,
            checkSize: input.checkSize,
            introducedBy: input.introducedBy,
          }),
        })
        .where(and(eq(companies.userId, userId), eq(companies.id, deal.companyId)));
    }
    return applyDealFacts(tx, userId, deal, input.name, input);
  });
}

export async function deleteDeal(userId: string, id: string) {
  const [deleted] = await db
    .delete(deals)
    .where(and(eq(deals.userId, userId), eq(deals.id, id)))
    .returning({ id: deals.id });
  return Boolean(deleted);
}
