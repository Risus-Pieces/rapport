import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, contacts, deals, outreach, radarItems } from "@/db/schema";
import { firstFirm } from "@/lib/radar/dedupe";
import { crmTargetFor, type CrmTarget, type RadarDetails } from "@/lib/radar/types";
import { checkInvestorParties, compactDetails, firstStage } from "@/lib/sections";
import { nextSortKey, type Tx } from "./deals";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export class RadarError extends Error {}

export type Approval = {
  section: CrmTarget;
  contactId: string;
  companyId: string | null;
  dealId: string | null;
  href: string;
};

function approval(section: CrmTarget, contactId: string, companyId: string | null, dealId: string | null): Approval {
  const href = section === "general" || !dealId ? `/general/${contactId}` : `/${section}/${dealId}`;
  return { section, contactId, companyId, dealId, href };
}

const sameName = (column: typeof contacts.name | typeof companies.name, name: string) =>
  sql`lower(${column}) = lower(${name})`;

async function findContact(tx: Tx, userId: string, section: CrmTarget, name: string) {
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.section, section), isNull(contacts.archivedAt), sameName(contacts.name, name)))
    .limit(1);
  return row?.id ?? null;
}

async function openDeal(tx: Tx, userId: string, where: { contactId?: string; companyId?: string }) {
  const [row] = await tx
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        eq(deals.userId, userId),
        eq(deals.status, "open"),
        where.contactId ? eq(deals.contactId, where.contactId) : undefined,
        where.companyId ? eq(deals.companyId, where.companyId) : undefined,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Approve one finding: the person lands in the CRM section their kind belongs to (angels and
 * next-gen investors → Investors angel deal; buyers → Restaurants company, contact and Lead deal;
 * celebrities, creators and press → General contact). Idempotent under a row lock, and a same-name
 * contact (or a buyer's existing company and open deal) is reused rather than duplicated.
 */
export async function approveRadarItem(userId: string, itemId: string): Promise<Approval> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(radarItems)
      .where(and(eq(radarItems.userId, userId), eq(radarItems.id, itemId)))
      .for("update");
    if (!item) throw new RadarError("That finding no longer exists.");
    const section = item.feed === "sooz" ? crmTargetFor(item.kind) : null;
    if (!section) throw new RadarError("Only people can be added to the CRM.");
    if (item.status === "approved" && item.contactId) {
      return approval(section, item.contactId, item.companyId, item.dealId);
    }

    const d = item.details as RadarDetails;
    const firm = firstFirm(d.firm);
    const [draft] = await tx
      .select({ email: outreach.email, linkedinUrl: outreach.linkedinUrl })
      .from(outreach)
      .where(eq(outreach.radarItemId, item.id));
    const radar = compactDetails({
      radarItemId: item.id,
      kind: item.kind,
      sourceUrl: item.url,
      whyRelevant: item.whyRelevant,
      contactPath: d.contact_path,
      riceConnection: d.rice_connection,
      checkSize: d.check_size,
      firm: d.firm,
    });
    const person = {
      userId,
      section,
      name: item.title,
      email: draft?.email ?? null,
      linkedinUrl: draft?.linkedinUrl ?? null,
      tags: item.tags.slice(0, 20),
    };

    let companyId: string | null = null;
    let contactId = await findContact(tx, userId, section, item.title);
    let dealId: string | null = null;

    if (section === "restaurants") {
      const companyName = firm ?? item.title;
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            eq(companies.userId, userId),
            eq(companies.section, "restaurants"),
            isNull(companies.archivedAt),
            sameName(companies.name, companyName),
          ),
        )
        .limit(1);
      companyId =
        company?.id ??
        (await tx.insert(companies).values({ userId, section, name: companyName }).returning({ id: companies.id }))[0].id;
      contactId ??= (
        await tx
          .insert(contacts)
          .values({ ...person, companyId, title: d.role ?? null, details: { radar } })
          .returning({ id: contacts.id })
      )[0].id;
      dealId = await openDeal(tx, userId, { companyId });
      if (!dealId) {
        const stage = firstStage("restaurants").key;
        dealId = (
          await tx
            .insert(deals)
            .values({ userId, section, companyId, title: companyName, stage, sortKey: await nextSortKey(tx, userId, "restaurants", stage) })
            .returning({ id: deals.id })
        )[0].id;
      }
    } else {
      const title = [d.role, d.firm].filter(Boolean).join(" · ") || null;
      contactId ??= (
        await tx
          .insert(contacts)
          .values({
            ...person,
            title,
            priority: section === "general" ? "high" : null,
            details: section === "investors" ? { background: item.summary, radar } : { radar },
          })
          .returning({ id: contacts.id })
      )[0].id;
      if (section === "investors") {
        const problem = checkInvestorParties("angel", { companyId: null, contactId });
        if (problem) throw new RadarError(problem);
        dealId = await openDeal(tx, userId, { contactId });
        if (!dealId) {
          const stage = firstStage("investors").key;
          dealId = (
            await tx
              .insert(deals)
              .values({
                userId,
                section,
                contactId,
                title: item.title,
                stage,
                details: { investorType: "angel" },
                sortKey: await nextSortKey(tx, userId, "investors", stage),
              })
              .returning({ id: deals.id })
          )[0].id;
        }
      }
    }

    await tx.insert(activities).values({
      userId,
      type: "note",
      summary: "Added from Radar",
      body: [item.summary, item.url ? `Source: ${item.url}` : null].filter(Boolean).join("\n\n") || null,
      contactId,
      companyId,
      dealId,
    });
    await tx
      .update(radarItems)
      .set({ status: "approved", contactId, companyId, dealId })
      .where(eq(radarItems.id, item.id));
    await tx.update(outreach).set({ contactId, dealId }).where(eq(outreach.radarItemId, item.id));
    return approval(section, contactId, companyId, dealId);
  });
}
