import { and, count, eq, ilike, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals, tasks, type Section } from "@/db/schema";
import type { CompanyInput } from "@/lib/validation/company";
import { escapeLike } from "./util";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export async function listCompanies(
  userId: string,
  section: Section,
  options: { archived?: boolean; q?: string } = {},
) {
  const q = options.q?.trim();
  return db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.userId, userId),
        eq(companies.section, section),
        options.archived ? isNotNull(companies.archivedAt) : isNull(companies.archivedAt),
        q ? or(ilike(companies.name, `%${escapeLike(q)}%`), ilike(companies.city, `%${escapeLike(q)}%`)) : undefined,
      ),
    )
    .orderBy(companies.name);
}

export async function getCompany(userId: string, id: string) {
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.userId, userId), eq(companies.id, id)));
  return company ?? null;
}

export async function createCompany(userId: string, section: Section, input: CompanyInput) {
  const [created] = await db
    .insert(companies)
    .values({ userId, section, ...input })
    .returning();
  return created;
}

export async function updateCompany(userId: string, id: string, input: CompanyInput) {
  const [updated] = await db
    .update(companies)
    .set(input)
    .where(and(eq(companies.userId, userId), eq(companies.id, id)))
    .returning();
  return updated ?? null;
}

export async function setCompanyArchived(userId: string, id: string, archived: boolean) {
  const [updated] = await db
    .update(companies)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(companies.userId, userId), eq(companies.id, id)))
    .returning({ id: companies.id });
  return Boolean(updated);
}

/** What a hard delete would take with it, for the confirmation dialog. */
export async function getCompanyDeleteImpact(userId: string, id: string) {
  const [[activityRow], [dealRow], [contactRow], [taskRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(activities)
      .where(and(eq(activities.userId, userId), eq(activities.companyId, id))),
    db
      .select({ n: count() })
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.companyId, id))),
    db
      .select({ n: count() })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.companyId, id))),
    // Tasks on the company or on any of its deals stay but lose the link.
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          or(
            eq(tasks.companyId, id),
            inArray(tasks.dealId, db.select({ id: deals.id }).from(deals).where(and(eq(deals.userId, userId), eq(deals.companyId, id)))),
          ),
        ),
      ),
  ]);
  return { activities: activityRow.n, deals: dealRow.n, contacts: contactRow.n, tasks: taskRow.n };
}

// Deletes the company, all of its deals (an investor deal needs its institution) and its
// activities. Its contacts stay and lose the link (contacts.company_id is set null); tasks stay and
// lose the link (set null). Deals use NO ACTION, so they are removed first, in the same transaction.
// A contact-only deal that merely names a contact of this company is untouched.
export async function deleteCompany(userId: string, id: string) {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.userId, userId), eq(companies.id, id)));
    if (owned.length === 0) return false;
    // Deleting a deal only clears activities.deal_id; the activity stays on its contact.
    await tx.delete(deals).where(and(eq(deals.userId, userId), eq(deals.companyId, id)));
    await tx.delete(companies).where(and(eq(companies.userId, userId), eq(companies.id, id)));
    return true;
  });
}

export async function listCompanyOptions(userId: string, section: Section) {
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.userId, userId), eq(companies.section, section), isNull(companies.archivedAt)))
    .orderBy(companies.name);
}

export async function listCompanyContacts(userId: string, companyId: string) {
  return db
    .select({ id: contacts.id, name: contacts.name, title: contacts.title, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.companyId, companyId), isNull(contacts.archivedAt)))
    .orderBy(contacts.name);
}
