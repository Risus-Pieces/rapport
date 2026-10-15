import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals, radarItems, tasks } from "@/db/schema";

// Every export is scoped to one owner. Column names for contacts match the importer.

export const EXPORT_KINDS = ["contacts", "companies", "deals", "activities", "tasks", "radar"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

type Rows = Record<string, unknown>[];

export async function exportRows(userId: string, kind: ExportKind): Promise<{ columns: string[]; rows: Rows }> {
  switch (kind) {
    case "contacts": {
      const data = await db
        .select({ c: contacts, companyName: companies.name })
        .from(contacts)
        .leftJoin(companies, eq(companies.id, contacts.companyId))
        .where(eq(contacts.userId, userId))
        .orderBy(contacts.section, contacts.name);
      return {
        columns: ["id", "section", "name", "title", "email", "phone", "linkedin_url", "company", "priority", "tags", "notes", "archived_at", "created_at"],
        rows: data.map(({ c, companyName }) => ({
          id: c.id, section: c.section, name: c.name, title: c.title, email: c.email, phone: c.phone,
          linkedin_url: c.linkedinUrl, company: companyName, priority: c.priority, tags: c.tags, notes: c.notes,
          archived_at: c.archivedAt, created_at: c.createdAt,
        })),
      };
    }
    case "companies": {
      const data = await db.select().from(companies).where(eq(companies.userId, userId)).orderBy(companies.section, companies.name);
      return {
        columns: ["id", "section", "name", "website", "city", "details", "tags", "notes", "archived_at", "created_at"],
        rows: data.map((c) => ({
          id: c.id, section: c.section, name: c.name, website: c.website, city: c.city, details: JSON.stringify(c.details),
          tags: c.tags, notes: c.notes, archived_at: c.archivedAt, created_at: c.createdAt,
        })),
      };
    }
    case "deals": {
      const data = await db
        .select({ d: deals, companyName: companies.name, contactName: contacts.name })
        .from(deals)
        .leftJoin(companies, eq(companies.id, deals.companyId))
        .leftJoin(contacts, eq(contacts.id, deals.contactId))
        .where(eq(deals.userId, userId))
        .orderBy(deals.section, deals.stage, deals.sortKey);
      return {
        columns: ["id", "section", "title", "stage", "status", "amount_usd", "next_step", "next_step_date", "closed_at", "company", "contact", "details", "created_at"],
        rows: data.map(({ d, companyName, contactName }) => ({
          id: d.id, section: d.section, title: d.title, stage: d.stage, status: d.status,
          amount_usd: d.amountCents === null ? null : d.amountCents / 100, next_step: d.nextStep,
          next_step_date: d.nextStepDate, closed_at: d.closedAt, company: companyName, contact: contactName,
          details: JSON.stringify(d.details), created_at: d.createdAt,
        })),
      };
    }
    case "activities": {
      const data = await db
        .select({ a: activities, contactName: contacts.name, companyName: companies.name, dealTitle: deals.title })
        .from(activities)
        .leftJoin(contacts, eq(contacts.id, activities.contactId))
        .leftJoin(companies, eq(companies.id, activities.companyId))
        .leftJoin(deals, eq(deals.id, activities.dealId))
        .where(eq(activities.userId, userId))
        .orderBy(activities.occurredAt);
      return {
        columns: ["id", "type", "occurred_at", "summary", "body", "contact", "company", "deal"],
        rows: data.map(({ a, contactName, companyName, dealTitle }) => ({
          id: a.id, type: a.type, occurred_at: a.occurredAt, summary: a.summary, body: a.body,
          contact: contactName, company: companyName, deal: dealTitle,
        })),
      };
    }
    case "tasks": {
      const data = await db
        .select({ t: tasks, contactName: contacts.name, dealTitle: deals.title })
        .from(tasks)
        .leftJoin(contacts, eq(contacts.id, tasks.contactId))
        .leftJoin(deals, eq(deals.id, tasks.dealId))
        .where(eq(tasks.userId, userId))
        .orderBy(tasks.dueDate);
      return {
        columns: ["id", "title", "due_date", "done_at", "contact", "deal", "created_at"],
        rows: data.map(({ t, contactName, dealTitle }) => ({
          id: t.id, title: t.title, due_date: t.dueDate, done_at: t.doneAt, contact: contactName, deal: dealTitle, created_at: t.createdAt,
        })),
      };
    }
    case "radar": {
      const data = await db.select().from(radarItems).where(eq(radarItems.userId, userId)).orderBy(radarItems.feed, radarItems.firstSeen);
      return {
        columns: ["id", "feed", "kind", "title", "url", "status", "score", "summary", "why_relevant", "tags", "details", "event_date", "deadline", "location", "notes", "first_seen"],
        rows: data.map((r) => ({
          id: r.id, feed: r.feed, kind: r.kind, title: r.title, url: r.url, status: r.status, score: r.score, summary: r.summary,
          why_relevant: r.whyRelevant, tags: r.tags, details: JSON.stringify(r.details), event_date: r.eventDate, deadline: r.deadline,
          location: r.location, notes: r.notes, first_seen: r.firstSeen,
        })),
      };
    }
  }
}
