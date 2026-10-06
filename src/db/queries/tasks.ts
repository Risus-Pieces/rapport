import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals, tasks, type Section } from "@/db/schema";
import type { TaskInput } from "@/lib/validation/task";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export class TaskTargetError extends Error {
  constructor(message = "That contact does not exist.") {
    super(message);
  }
}

const taskColumns = {
  id: tasks.id,
  title: tasks.title,
  dueDate: tasks.dueDate,
  doneAt: tasks.doneAt,
  contactId: tasks.contactId,
  contactName: contacts.name,
  contactSection: contacts.section,
};

export type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  doneAt: Date | null;
  contactId: string | null;
  contactName: string | null;
  contactSection: Section | null;
};

export async function createTask(userId: string, input: TaskInput) {
  if (input.contactId) {
    const [found] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.id, input.contactId)));
    if (!found) throw new TaskTargetError();
  }
  if (input.dealId) {
    const [found] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.userId, userId), eq(deals.id, input.dealId)));
    if (!found) throw new TaskTargetError("That deal does not exist.");
  }
  const [created] = await db
    .insert(tasks)
    .values({ userId, title: input.title, dueDate: input.dueDate, contactId: input.contactId, dealId: input.dealId })
    .returning();
  return created;
}

/** Open tasks, optionally for one contact. Order is by due date, undated last. */
export async function listOpenTasks(userId: string, options: { contactId?: string; dealId?: string } = {}): Promise<TaskRow[]> {
  return db
    .select(taskColumns)
    .from(tasks)
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.doneAt),
        options.contactId ? eq(tasks.contactId, options.contactId) : undefined,
        options.dealId ? eq(tasks.dealId, options.dealId) : undefined,
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.createdAt));
}

/** Most recently completed tasks first. */
export async function listDoneTasks(
  userId: string,
  options: { contactId?: string; dealId?: string; limit?: number } = {},
): Promise<TaskRow[]> {
  return db
    .select(taskColumns)
    .from(tasks)
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.doneAt),
        options.contactId ? eq(tasks.contactId, options.contactId) : undefined,
        options.dealId ? eq(tasks.dealId, options.dealId) : undefined,
      ),
    )
    .orderBy(desc(tasks.doneAt))
    .limit(options.limit ?? 20);
}

export async function setTaskDone(userId: string, id: string, done: boolean) {
  const [updated] = await db
    .update(tasks)
    .set({ doneAt: done ? new Date() : null })
    .where(and(eq(tasks.userId, userId), eq(tasks.id, id)))
    .returning({ id: tasks.id, contactId: tasks.contactId });
  return updated ?? null;
}

export async function deleteTask(userId: string, id: string) {
  const [deleted] = await db
    .delete(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.id, id)))
    .returning({ id: tasks.id, contactId: tasks.contactId });
  return deleted ?? null;
}
