import { sql } from "drizzle-orm";
import { activities, companies, contacts, deals, radarItems, tasks } from "@/db/schema";

// Which rows of a workspace its members see: Sooz work, never the owner's personal things
// (docs/superpowers/specs/2026-10-27-mo-login-design.md).
export const sharedContact = sql`(${contacts.section} <> 'general' or ${contacts.shared})`;
export const sharedCompany = sql`${companies.section} <> 'general'`;
export const sharedDeal = sql`${deals.section} <> 'general'`;
export const sharedRadarItem = sql`${radarItems.feed} = 'sooz'`;

const onSharedRecord = (contactId: unknown, companyId: unknown, dealId: unknown) => sql`(
  exists (select 1 from deals d where d.id = ${dealId} and d.section <> 'general')
  or exists (select 1 from contacts c where c.id = ${contactId} and (c.section <> 'general' or c.shared))
  or exists (select 1 from companies co where co.id = ${companyId} and co.section <> 'general'))`;

/** A task is shared when it is about a Sooz record (a deal, a Restaurants/Investors contact or company, a shared contact). */
export const sharedTask = onSharedRecord(tasks.contactId, tasks.companyId, tasks.dealId);
export const sharedActivity = onSharedRecord(activities.contactId, activities.companyId, activities.dealId);
