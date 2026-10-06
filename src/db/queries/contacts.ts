import { and, count, eq, ilike, inArray, isNotNull, isNull, max, or } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals, tasks, type ActivityType, type Section } from "@/db/schema";
import { getReminder, TOUCH_TYPES, compareReminders } from "@/lib/reminders";
import type { ContactInput } from "@/lib/validation/contact";
import { escapeLike } from "./util";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

const touchTypes = [...TOUCH_TYPES] as ActivityType[];

export type ContactRow = typeof contacts.$inferSelect & {
  companyName: string | null;
  lastTouchAt: Date | null;
};

function withReminder<T extends ContactRow>(row: T, now: Date) {
  // An archived contact is hidden from follow-ups, so it never shows a live reminder.
  const priority = row.archivedAt ? null : row.priority;
  return { ...row, reminder: getReminder(priority, row.lastTouchAt, row.createdAt, now) };
}

export type ContactListItem = ReturnType<typeof withReminder<ContactRow>>;

export async function listContacts(
  userId: string,
  section: Section | null,
  options: { archived?: boolean; q?: string; now?: Date } = {},
): Promise<ContactListItem[]> {
  const q = options.q?.trim();
  const rows = await db
    .select({
      contact: contacts,
      companyName: companies.name,
      lastTouchAt: max(activities.occurredAt),
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .leftJoin(
      activities,
      and(eq(activities.contactId, contacts.id), inArray(activities.type, touchTypes)),
    )
    .where(
      and(
        eq(contacts.userId, userId),
        section ? eq(contacts.section, section) : undefined,
        options.archived ? isNotNull(contacts.archivedAt) : isNull(contacts.archivedAt),
        q
          ? or(
              ilike(contacts.name, `%${escapeLike(q)}%`),
              ilike(contacts.email, `%${escapeLike(q)}%`),
              ilike(contacts.title, `%${escapeLike(q)}%`),
            )
          : undefined,
      ),
    )
    .groupBy(contacts.id, companies.name);
  const now = options.now ?? new Date();
  return rows
    .map((r) => withReminder({ ...r.contact, companyName: r.companyName, lastTouchAt: r.lastTouchAt }, now))
    .sort((a, b) => compareReminders(a.reminder, b.reminder) || a.name.localeCompare(b.name));
}

export async function getContact(userId: string, id: string, now = new Date()) {
  const [row] = await db
    .select({ contact: contacts, companyName: companies.name })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(eq(contacts.userId, userId), eq(contacts.id, id)));
  if (!row) return null;
  const [touch] = await db
    .select({ at: max(activities.occurredAt) })
    .from(activities)
    .where(
      and(eq(activities.userId, userId), eq(activities.contactId, id), inArray(activities.type, touchTypes)),
    );
  return withReminder({ ...row.contact, companyName: row.companyName, lastTouchAt: touch?.at ?? null }, now);
}

export class InvalidCompanyError extends Error {
  constructor() {
    super("That company does not exist in this section.");
  }
}

async function assertCompany(userId: string, section: Section, companyId: string | null) {
  if (!companyId) return;
  const [found] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.userId, userId), eq(companies.id, companyId), eq(companies.section, section)));
  if (!found) throw new InvalidCompanyError();
}

export async function createContact(userId: string, section: Section, input: ContactInput) {
  await assertCompany(userId, section, input.companyId ?? null);
  const [created] = await db
    .insert(contacts)
    .values({ userId, section, ...input })
    .returning();
  return created;
}

export async function updateContact(userId: string, section: Section, id: string, input: ContactInput) {
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.section, section), eq(contacts.id, id)));
  if (!existing) return null;
  await assertCompany(userId, section, input.companyId ?? null);
  const [updated] = await db
    .update(contacts)
    .set(input)
    .where(and(eq(contacts.userId, userId), eq(contacts.section, section), eq(contacts.id, id)))
    .returning();
  return updated ?? null;
}

export async function setContactArchived(userId: string, section: Section, id: string, archived: boolean) {
  const [updated] = await db
    .update(contacts)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(contacts.userId, userId), eq(contacts.section, section), eq(contacts.id, id)))
    .returning({ id: contacts.id });
  return Boolean(updated);
}

/** What a hard delete would take with it, for the confirmation dialog. */
export async function getContactDeleteImpact(userId: string, id: string) {
  const [[activityRow], [dealRow], [detachedRow], [taskRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(activities)
      .where(and(eq(activities.userId, userId), eq(activities.contactId, id))),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.contactId, id), isNull(deals.companyId))),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.contactId, id), isNotNull(deals.companyId))),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          or(
            eq(tasks.contactId, id),
            // Tasks on a deal that goes with this contact (an angel) stay but lose the link.
            inArray(
              tasks.dealId,
              db
                .select({ id: deals.id })
                .from(deals)
                .where(and(eq(deals.userId, userId), eq(deals.contactId, id), isNull(deals.companyId))),
            ),
          ),
        ),
      ),
  ]);
  return { activities: activityRow.n, deals: dealRow.n, detachedDeals: detachedRow.n, tasks: taskRow.n };
}

// Deletes the contact and its activities. Deals use NO ACTION, so they are handled first, inside
// the same transaction: a deal whose only party is this contact (an angel) is deleted; a deal that
// also has a company keeps it and just loses the contact. Tasks stay and lose the link (set null).
export async function deleteContact(userId: string, section: Section, id: string) {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.section, section), eq(contacts.id, id)));
    if (owned.length === 0) return false;
    await tx.delete(deals).where(and(eq(deals.userId, userId), eq(deals.contactId, id), isNull(deals.companyId)));
    await tx
      .update(deals)
      .set({ contactId: null })
      .where(and(eq(deals.userId, userId), eq(deals.contactId, id)));
    await tx.delete(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, id)));
    return true;
  });
}

/** Contacts that need a follow-up now (overdue or due soon) in every section, most overdue first. */
export async function listFollowUps(userId: string, now = new Date()) {
  const all = await listContacts(userId, null, { now });
  return all.filter((c) => c.reminder.status === "overdue" || c.reminder.status === "due_soon");
}
