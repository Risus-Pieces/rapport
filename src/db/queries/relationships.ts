import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, type Section } from "@/db/schema";
import { RELATIONSHIPS, type Relationship } from "@/lib/relationships";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

// Facts move people to Know them by themselves (drizzle/0014 triggers): a logged call/email/meeting/tasting, a send or
// reply, or a deal moved past its first stage.

/** On hold and Dismissed archive a contact (no reminders, hidden lists); anything else brings it back. */
const archiveFor = (r: Relationship) =>
  r === "on_hold" || r === "dismissed" ? sql`coalesce(${contacts.archivedAt}, now())` : sql`null`;

export async function setContactRelationship(userId: string, contactId: string, r: Relationship) {
  const [updated] = await db
    .update(contacts)
    .set({ relationship: r, relationshipAt: new Date(), archivedAt: archiveFor(r) })
    .where(and(eq(contacts.userId, userId), eq(contacts.id, contactId)))
    .returning({ id: contacts.id });
  return Boolean(updated);
}

/** Sets a pipeline deal's relationship, and its person's with it. */
export async function setDealRelationship(userId: string, dealId: string, r: Relationship) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(deals)
      .set({ relationship: r, relationshipAt: new Date() })
      .where(and(eq(deals.userId, userId), eq(deals.id, dealId), sql`${deals.section} <> 'general'`))
      .returning({ contactId: deals.contactId });
    if (!updated) return false;
    if (updated.contactId) {
      await tx
        .update(contacts)
        .set({ relationship: r, relationshipAt: new Date(), archivedAt: archiveFor(r) })
        .where(and(eq(contacts.userId, userId), eq(contacts.id, updated.contactId)));
    }
    return true;
  });
}

/** How many records sit in each relationship: deals for the pipelines, contacts for General. */
export async function relationshipCounts(userId: string, section: Section): Promise<Record<Relationship, number>> {
  const table = section === "general" ? contacts : deals;
  const rows = await db
    .select({ r: table.relationship, n: count() })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.section, section)))
    .groupBy(table.relationship);
  const counts = Object.fromEntries(RELATIONSHIPS.map((r) => [r, 0])) as Record<Relationship, number>;
  for (const row of rows) if (row.r in counts) counts[row.r as Relationship] = row.n;
  return counts;
}
