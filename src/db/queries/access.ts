import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts, deals, radarItems, tasks } from "@/db/schema";
import { compareReminders } from "@/lib/reminders";
import { recentActivities } from "./dashboard";
import type { Relationship } from "@/lib/relationships";
import type { Scope } from "@/lib/scope";
import { listContacts } from "./contacts";
import { exportRows, type ExportKind } from "./export";
import { newOpportunityCounts } from "./opportunities";
import { relationshipCounts } from "./relationships";
import { searchRecords } from "./search";
import { sharedActivity, sharedContact, sharedDeal, sharedRadarItem, sharedTask } from "./shared";
import { listDoneTasks, listOpenTasks } from "./tasks";

// What a logged-in person may reach: their own rows, plus the shared (Sooz) rows of their workspace.
// The *Owner helpers return the user id that owns an accessible record (to pass to the existing queries), or null.

const member = (scope: Scope) => scope.userId !== scope.workspaceId;

async function ownerOf(scope: Scope, ownerId: string | undefined, sharedInWorkspace: () => Promise<boolean>) {
  if (!ownerId) return null;
  if (ownerId === scope.userId) return scope.userId;
  if (ownerId === scope.workspaceId && (await sharedInWorkspace())) return scope.workspaceId;
  return null;
}

export async function contactOwner(scope: Scope, contactId: string): Promise<string | null> {
  const [row] = await db.select({ userId: contacts.userId }).from(contacts).where(eq(contacts.id, contactId));
  return ownerOf(scope, row?.userId, async () =>
    Boolean((await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), sharedContact)))[0]));
}

export async function dealOwner(scope: Scope, dealId: string): Promise<string | null> {
  const [row] = await db.select({ userId: deals.userId }).from(deals).where(eq(deals.id, dealId));
  return ownerOf(scope, row?.userId, async () =>
    Boolean((await db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, dealId), sharedDeal)))[0]));
}

export async function itemOwner(scope: Scope, itemId: string): Promise<string | null> {
  const [row] = await db.select({ userId: radarItems.userId }).from(radarItems).where(eq(radarItems.id, itemId));
  return ownerOf(scope, row?.userId, async () =>
    Boolean((await db.select({ id: radarItems.id }).from(radarItems).where(and(eq(radarItems.id, itemId), sharedRadarItem)))[0]));
}

export async function taskOwner(scope: Scope, taskId: string): Promise<string | null> {
  const [row] = await db.select({ userId: tasks.userId }).from(tasks).where(eq(tasks.id, taskId));
  return ownerOf(scope, row?.userId, async () =>
    Boolean((await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), sharedTask)))[0]));
}

/** General: my own people plus the workspace's shared Sooz people (each flagged `shared`). */
export async function listGeneral(scope: Scope, options: { q?: string; relationship?: Relationship; now?: Date } = {}) {
  const own = await listContacts(scope.userId, "general", options);
  if (!member(scope)) return own;
  const shared = await listContacts(scope.workspaceId, "general", { ...options, sharedOnly: true });
  return [...own, ...shared].sort((x, y) => compareReminders(x.reminder, y.reminder) || x.name.localeCompare(y.name));
}

export async function generalCounts(scope: Scope): Promise<Record<Relationship, number>> {
  const own = await relationshipCounts(scope.userId, "general");
  if (!member(scope)) return own;
  const shared = await relationshipCounts(scope.workspaceId, "general", { sharedOnly: true });
  return Object.fromEntries(Object.entries(own).map(([k, n]) => [k, n + shared[k as Relationship]])) as Record<Relationship, number>;
}

/** Open tasks: mine plus the workspace's shared ones, by due date. */
export async function openTasks(scope: Scope) {
  const own = await listOpenTasks(scope.userId);
  if (!member(scope)) return own;
  const shared = await listOpenTasks(scope.workspaceId, { sharedOnly: true });
  return [...own, ...shared].sort((x, y) => (x.dueDate ?? "9999").localeCompare(y.dueDate ?? "9999"));
}

export async function doneTasks(scope: Scope, limit = 20) {
  const own = await listDoneTasks(scope.userId, { limit });
  if (!member(scope)) return own;
  const shared = await listDoneTasks(scope.workspaceId, { limit, sharedOnly: true });
  return [...own, ...shared].sort((x, y) => (y.doneAt?.getTime() ?? 0) - (x.doneAt?.getTime() ?? 0)).slice(0, limit);
}

export async function searchScoped(scope: Scope, query: string) {
  const own = await searchRecords(scope.userId, query);
  if (!member(scope)) return own;
  return [...own, ...(await searchRecords(scope.workspaceId, query, { sharedOnly: true }))];
}

export async function exportScoped(scope: Scope, kind: ExportKind) {
  const own = await exportRows(scope.userId, kind);
  if (!member(scope)) return own;
  const shared = await exportRows(scope.workspaceId, kind, { sharedOnly: true });
  return { columns: own.columns, rows: [...own.rows, ...shared.rows] };
}

/** New opportunities: the Sooz feed is the workspace's, Personal and Career are mine. */
export async function newOpportunityCountsScoped(scope: Scope) {
  const [mine, workspace] = await Promise.all([
    newOpportunityCounts(scope.userId),
    member(scope) ? newOpportunityCounts(scope.workspaceId) : Promise.resolve(null),
  ]);
  return { sooz: (workspace ?? mine).sooz, personal: mine.personal, career: mine.career };
}

export async function activityOwner(scope: Scope, activityId: string): Promise<string | null> {
  const [row] = await db.select({ userId: activities.userId }).from(activities).where(eq(activities.id, activityId));
  return ownerOf(scope, row?.userId, async () =>
    Boolean((await db.select({ id: activities.id }).from(activities).where(and(eq(activities.id, activityId), sharedActivity)))[0]));
}

/**
 * The id that should own something attached to a record (an activity, a task): the record's owner when the person may
 * reach it, else the person themself (so the existing queries refuse an unreachable record as "not found").
 */
export async function targetOwner(scope: Scope, target: { contactId?: string | null; dealId?: string | null }): Promise<string> {
  if (target.dealId) return (await dealOwner(scope, target.dealId)) ?? scope.userId;
  if (target.contactId) return (await contactOwner(scope, target.contactId)) ?? scope.userId;
  return scope.userId;
}

/** Recent activity: mine plus what happened on shared Sooz records, newest first. */
export async function recentActivitiesScoped(scope: Scope, limit = 8) {
  const own = await recentActivities(scope.userId, limit);
  if (!member(scope)) return own;
  const shared = await recentActivities(scope.workspaceId, limit, { sharedOnly: true });
  return [...own, ...shared].sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime()).slice(0, limit);
}
