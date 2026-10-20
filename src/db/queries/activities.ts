import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals, type ActivityType } from "@/db/schema";
import { TOUCH_TYPES } from "@/lib/reminders";
import { markKnown } from "./relationships";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export class ActivityTargetError extends Error {
  constructor(message = "That record does not exist.") {
    super(message);
  }
}

export type ActivityTarget = { contactId?: string | null; companyId?: string | null; dealId?: string | null };

// Logs an activity against a contact, a company or a deal. A deal activity inherits the deal's
// contact and company, and at least one of contact or company must end up set.
export async function logActivity(
  userId: string,
  input: ActivityTarget & { type: ActivityType; summary: string; body?: string | null; occurredAt?: Date },
) {
  let contactId = input.contactId ?? null;
  let companyId = input.companyId ?? null;
  const dealId = input.dealId ?? null;

  if (dealId) {
    const [deal] = await db
      .select({ contactId: deals.contactId, companyId: deals.companyId })
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.id, dealId)));
    if (!deal) throw new ActivityTargetError("That deal does not exist.");
    contactId ??= deal.contactId;
    companyId ??= deal.companyId;
  }
  if (!contactId && !companyId) throw new ActivityTargetError("Choose a contact or company.");
  if (contactId) {
    const [found] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.id, contactId)));
    if (!found) throw new ActivityTargetError("That contact does not exist.");
  }
  if (companyId) {
    const [found] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.userId, userId), eq(companies.id, companyId)));
    if (!found) throw new ActivityTargetError("That company does not exist.");
  }

  const [created] = await db
    .insert(activities)
    .values({
      userId,
      type: input.type,
      summary: input.summary,
      body: input.body ?? null,
      occurredAt: input.occurredAt,
      contactId,
      companyId,
      dealId,
    })
    .returning();
  // A real touch means you know them now, so no cold first note follows.
  if ((TOUCH_TYPES as readonly string[]).includes(input.type)) await markKnown(db, userId, { contactId, companyId, dealId });
  return created;
}

export async function listContactActivities(userId: string, contactId: string, limit = 50) {
  return db
    .select()
    .from(activities)
    .where(and(eq(activities.userId, userId), eq(activities.contactId, contactId)))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
}

export async function deleteActivity(userId: string, id: string) {
  const [deleted] = await db
    .delete(activities)
    .where(and(eq(activities.userId, userId), eq(activities.id, id)))
    .returning({ id: activities.id, contactId: activities.contactId });
  return deleted ?? null;
}

export async function listDealActivities(userId: string, dealId: string, limit = 50) {
  return db
    .select()
    .from(activities)
    .where(and(eq(activities.userId, userId), eq(activities.dealId, dealId)))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
}
