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
  if (updated && r === "known") await outreachKnown(userId, contactId, null);
  return Boolean(updated);
}

// Know them means a thread whose cadence ended was answered somehow, so it is never ghosted again.
async function outreachKnown(userId: string, contactId: string | null, dealId: string | null) {
  await db.$client.query(`select rr_outreach_known($1, $2, $3)`, [contactId, dealId, userId]);
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
    return { contactId: updated.contactId };
  }).then(async (done) => {
    if (done && r === "known") await outreachKnown(userId, done.contactId, dealId);
    return Boolean(done);
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

/** Restore from On hold / Dismissed: To reach out if nobody has been in touch, Know them otherwise. */
export async function restoreRelationship(userId: string, target: { dealId?: string; contactId?: string }) {
  if (target.dealId) {
    const { rows } = await db.$client.query<{ touched: boolean }>(
      `select rr_touched(contact_id, company_id, id) as touched from deals where user_id = $1 and id = $2`,
      [userId, target.dealId],
    );
    if (!rows.length) return false;
    return setDealRelationship(userId, target.dealId, rows[0].touched ? "known" : "to_reach_out");
  }
  if (!target.contactId) return false;
  const { rows } = await db.$client.query<{ touched: boolean }>(
    `select rr_touched(id, company_id, null) as touched from contacts where user_id = $1 and id = $2`,
    [userId, target.contactId],
  );
  if (!rows.length) return false;
  return setContactRelationship(userId, target.contactId, rows[0].touched ? "known" : "to_reach_out");
}

/** Try again from a CRM record (only from Ghosted): resets the threads that went quiet for a circling-back note. */
export async function tryAgainFor(userId: string, target: { dealId?: string; contactId?: string }) {
  const { rows } = await db.$client.query<{ n: number }>(`select rr_try_again_record($1, $2, $3) as n`, [
    target.dealId ?? null,
    target.contactId ?? null,
    userId,
  ]);
  return rows[0].n > 0;
}

/** Ghosted is computed when CRM pages load (and by the daily routine). */
export async function refreshGhosted(userId: string): Promise<number> {
  const { rows } = await db.$client.query<{ n: number }>(`select rr_refresh_ghosted($1) as n`, [userId]);
  return rows[0].n;
}
