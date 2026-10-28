"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActivityTargetError, deleteActivity, logActivity } from "@/db/queries/activities";
import { createTask, deleteTask, setTaskDone, TaskTargetError } from "@/db/queries/tasks";
import { resolveOccurredAt } from "@/lib/dates";
import { activityOwner, targetOwner, taskOwner } from "@/db/queries/access";
import { getScope } from "@/lib/scope";
import type { FormState } from "@/lib/form-state";
import { fieldErrors, formToObject, uuid } from "@/lib/validation/common";
import { activitySchema } from "@/lib/validation/activity";
import { taskSchema } from "@/lib/validation/task";

// Every page that shows activities or tasks refreshes. Records are reached through the person's scope (src/db/queries/access.ts).
function refreshAll() {
  revalidatePath("/", "layout");
}

export async function addActivityAction(prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await getScope();
  const values = formToObject(formData);
  const contactId = values.contactId ? uuid.safeParse(values.contactId) : null;
  const dealId = values.dealId ? uuid.safeParse(values.dealId) : null;
  if ((contactId && !contactId.success) || (dealId && !dealId.success) || (!contactId && !dealId)) {
    return { ...prev, errors: {}, message: "That record could not be found.", values };
  }
  const parsed = activitySchema.safeParse(values);
  if (!parsed.success) return { ...prev, errors: fieldErrors(parsed.error), message: null, values };
  try {
    const target = { contactId: contactId?.success ? contactId.data : null, dealId: dealId?.success ? dealId.data : null };
    await logActivity(await targetOwner(scope, target), {
      ...target,
      type: parsed.data.type,
      summary: parsed.data.summary,
      body: parsed.data.body,
      occurredAt: resolveOccurredAt(parsed.data.day),
    });
  } catch (error) {
    if (error instanceof ActivityTargetError) return { ...prev, errors: {}, message: error.message, values };
    console.error("addActivityAction failed:", error instanceof Error ? error.message : error);
    return { ...prev, errors: {}, message: "Could not save. Try again.", values };
  }
  refreshAll();
  return { errors: {}, message: null, saved: prev.saved + 1, values: {} };
}

const QUICK_SUMMARY = { call: "Called", email: "Emailed", meeting: "Met" } as const;
const quickSchema = z.object({ contactId: uuid, type: z.enum(["call", "email", "meeting"]) });

export type QuickState = { message: string | null };

export async function quickLogAction(_prev: QuickState, formData: FormData): Promise<QuickState> {
  const scope = await getScope();
  const parsed = quickSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { message: "Could not log that. Try again." };
  try {
    await logActivity(await targetOwner(scope, { contactId: parsed.data.contactId }), {
      contactId: parsed.data.contactId,
      type: parsed.data.type,
      summary: QUICK_SUMMARY[parsed.data.type],
    });
  } catch (error) {
    if (error instanceof ActivityTargetError) return { message: "That contact no longer exists." };
    throw error;
  }
  refreshAll();
  return { message: `Logged: ${QUICK_SUMMARY[parsed.data.type].toLowerCase()} today.` };
}

export async function deleteActivityAction(formData: FormData) {
  const scope = await getScope();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const owner = await activityOwner(scope, id.data);
  if (owner) await deleteActivity(owner, id.data);
  refreshAll();
}

export async function createTaskAction(prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await getScope();
  const values = formToObject(formData);
  const parsed = taskSchema.safeParse(values);
  if (!parsed.success) return { ...prev, errors: fieldErrors(parsed.error), message: null, values };
  try {
    await createTask(await targetOwner(scope, parsed.data), parsed.data);
  } catch (error) {
    if (error instanceof TaskTargetError) return { ...prev, errors: {}, message: error.message, values };
    console.error("createTaskAction failed:", error instanceof Error ? error.message : error);
    return { ...prev, errors: {}, message: "Could not save. Try again.", values };
  }
  refreshAll();
  return { errors: {}, message: null, saved: prev.saved + 1, values: {} };
}

export async function toggleTaskAction(formData: FormData) {
  const scope = await getScope();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const owner = await taskOwner(scope, id.data);
  if (owner) await setTaskDone(owner, id.data, formData.get("done") === "true");
  refreshAll();
}

export async function deleteTaskAction(formData: FormData) {
  const scope = await getScope();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const owner = await taskOwner(scope, id.data);
  if (owner) await deleteTask(owner, id.data);
  refreshAll();
}
