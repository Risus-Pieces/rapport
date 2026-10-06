import { and, count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals } from "@/db/schema";
import type { PipelineSection } from "@/lib/sections";
import { buildSnapshot } from "@/lib/snapshot";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export async function pipelineSnapshot(userId: string, section: PipelineSection) {
  const rows = await db
    .select({ stage: deals.stage, count: count(), amount: sum(deals.amountCents) })
    .from(deals)
    .where(and(eq(deals.userId, userId), eq(deals.section, section)))
    .groupBy(deals.stage);
  return buildSnapshot(
    section,
    rows.map((row) => ({ stage: row.stage, count: row.count, amountCents: Number(row.amount ?? 0) })),
  );
}

export async function recentActivities(userId: string, limit = 8) {
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
    .where(eq(activities.userId, userId))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
}
