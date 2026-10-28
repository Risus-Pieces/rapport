import { and, count, desc, eq, inArray, sum } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals } from "@/db/schema";
import type { PipelineSection } from "@/lib/sections";
import { buildSnapshot } from "@/lib/snapshot";
import { sharedActivity } from "./shared";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export async function pipelineSnapshot(userId: string, section: PipelineSection) {
  const rows = await db
    .select({ stage: deals.stage, count: count(), amount: sum(deals.amountCents) })
    .from(deals)
    // The pipeline is people you are in touch with; To reach out, On hold and Dismissed have their own lists.
    .where(and(eq(deals.userId, userId), eq(deals.section, section), inArray(deals.relationship, ["known", "ghosted"])))
    .groupBy(deals.stage);
  return buildSnapshot(
    section,
    rows.map((row) => ({ stage: row.stage, count: row.count, amountCents: Number(row.amount ?? 0) })),
  );
}

/** sharedOnly: only activity on Sooz records (a workspace member's view of the owner's workspace). */
export async function recentActivities(userId: string, limit = 8, options: { sharedOnly?: boolean } = {}) {
  return db
    .select({
      id: activities.id,
      type: activities.type,
      summary: activities.summary,
      occurredAt: activities.occurredAt,
      contactId: activities.contactId,
      contactName: contacts.name,
      contactSection: contacts.section,
      companyName: companies.name,
      dealId: activities.dealId,
      dealSection: deals.section,
    })
    .from(activities)
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .leftJoin(companies, eq(companies.id, activities.companyId))
    .leftJoin(deals, eq(deals.id, activities.dealId))
    .where(and(eq(activities.userId, userId), options.sharedOnly ? sharedActivity : undefined))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
}
