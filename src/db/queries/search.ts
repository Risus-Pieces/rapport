import { and, asc, eq, ilike, inArray, isNull, notInArray, or } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, radarItems } from "@/db/schema";
import { INVESTOR_TYPE_LABELS, investorTypeOf, PIPELINES, type PipelineSection } from "@/lib/sections";
import { opportunityHref } from "@/lib/opportunities";
import { FEED_LABELS, PERSON_KINDS, kindLabel, type Feed } from "@/lib/radar/types";
import { sharedContact, sharedDeal, sharedRadarItem } from "./shared";
import { escapeLike } from "./util";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export type SearchHit = { id: string; label: string; detail: string; href: string };

const LIMIT = 6;

/** Finds deals and contacts by name, email or role. Each hit links to the page that shows it. */
/** sharedOnly: only what a workspace member may see (Sooz records), for searching the owner's workspace as a member. */
export async function searchRecords(userId: string, query: string, options: { sharedOnly?: boolean } = {}): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const pattern = `%${escapeLike(q)}%`;

  const dealRows = await db
    .select({ id: deals.id, title: deals.title, section: deals.section, stage: deals.stage, details: deals.details })
    .from(deals)
    .where(and(eq(deals.userId, userId), ilike(deals.title, pattern), options.sharedOnly ? sharedDeal : undefined))
    .limit(LIMIT);

  const contactRows = await db
    .select({ id: contacts.id, name: contacts.name, title: contacts.title, section: contacts.section, companyId: contacts.companyId })
    .from(contacts)
    .where(
      and(
        eq(contacts.userId, userId),
        isNull(contacts.archivedAt),
        options.sharedOnly ? sharedContact : undefined,
        or(ilike(contacts.name, pattern), ilike(contacts.email, pattern), ilike(contacts.title, pattern)),
      ),
    )
    .limit(LIMIT);

  // A restaurant or investor contact opens the deal it belongs to (through its own deal or its company's).
  const companyIds = contactRows.flatMap((c) => (c.companyId ? [c.companyId] : []));
  const related = contactRows.length
    ? await db
        .select({ id: deals.id, section: deals.section, contactId: deals.contactId, companyId: deals.companyId })
        .from(deals)
        .where(
          and(
            eq(deals.userId, userId),
            or(
              inArray(deals.contactId, contactRows.map((c) => c.id)),
              companyIds.length ? inArray(deals.companyId, companyIds) : undefined,
            ),
          ),
        )
    : [];

  const hits: SearchHit[] = dealRows.map((deal) => {
    const section = deal.section as PipelineSection;
    const stage = PIPELINES[section].stages.find((s) => s.key === deal.stage)?.label ?? deal.stage;
    const type = investorTypeOf(deal.details);
    return {
      id: `deal:${deal.id}`,
      label: deal.title,
      detail: [PIPELINES[section].label, type ? INVESTOR_TYPE_LABELS[type] : null, stage].filter(Boolean).join(" · "),
      href: `/${section}/${deal.id}`,
    };
  });
  const seenDeals = new Set(dealRows.map((d) => d.id));
  for (const contact of contactRows) {
    let href: string;
    if (contact.section === "general") href = `/general/${contact.id}`;
    else {
      const deal = related.find((d) => d.contactId === contact.id || (contact.companyId && d.companyId === contact.companyId));
      if (deal && seenDeals.has(deal.id)) continue; // already listed as a deal
      href = deal ? `/${contact.section}/${deal.id}` : `/${contact.section}?view=people&q=${encodeURIComponent(contact.name)}`;
    }
    hits.push({
      id: `contact:${contact.id}`,
      label: contact.name,
      detail: [contact.section === "general" ? "General" : PIPELINES[contact.section as PipelineSection].label, contact.title].filter(Boolean).join(" · "),
      href,
    });
  }
  const radarRows = await db
    .select({ id: radarItems.id, title: radarItems.title, feed: radarItems.feed, kind: radarItems.kind, status: radarItems.status })
    .from(radarItems)
    .where(and(eq(radarItems.userId, userId), ilike(radarItems.title, pattern), notInArray(radarItems.kind, [...PERSON_KINDS]), options.sharedOnly ? sharedRadarItem : undefined))
    .orderBy(asc(radarItems.title))
    .limit(LIMIT);
  for (const item of radarRows) {
    hits.push({
      id: `radar:${item.id}`,
      label: item.title,
      detail: ["Opportunities", FEED_LABELS[item.feed as Feed] ?? item.feed, kindLabel(item.kind)].join(" · "),
      href: opportunityHref(item),
    });
  }
  return hits;
}
