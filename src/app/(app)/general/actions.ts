"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createContact,
  deleteContact,
  InvalidCompanyError,
  setContactArchived,
  updateContact,
} from "@/db/queries/contacts";
import { requireSession } from "@/lib/session";
import { fieldErrors, formToObject, uuid, type FieldErrors } from "@/lib/validation/common";
import { contactSchema } from "@/lib/validation/contact";

export type ContactFormState = {
  errors: FieldErrors;
  message: string | null;
  values: Record<string, string>;
};

const SECTION = "general" as const;

function refresh(id?: string) {
  revalidatePath("/general");
  if (id) revalidatePath(`/general/${id}`);
}

export async function saveContactAction(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const session = await requireSession();
  const values = formToObject(formData);
  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: null, values };

  const id = values.id ? uuid.safeParse(values.id) : null;
  if (id && !id.success) return { errors: {}, message: "That contact could not be found.", values };

  let savedId: string;
  try {
    if (id) {
      const updated = await updateContact(session.user.id, SECTION, id.data, parsed.data);
      if (!updated) return { errors: {}, message: "That contact no longer exists.", values };
      savedId = updated.id;
    } else {
      savedId = (await createContact(session.user.id, SECTION, parsed.data)).id;
    }
  } catch (error) {
    if (error instanceof InvalidCompanyError) return { errors: { companyId: error.message }, message: null, values };
    console.error("saveContactAction failed:", error instanceof Error ? error.message : error);
    return { errors: {}, message: "Could not save. Try again.", values };
  }
  refresh(savedId);
  redirect(`/general/${savedId}`);
}

export async function archiveContactAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const archived = formData.get("archived") === "true";
  await setContactArchived(session.user.id, SECTION, id.data, archived);
  refresh(id.data);
  redirect(archived ? "/general" : `/general/${id.data}`);
}

export async function deleteContactAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await deleteContact(session.user.id, SECTION, id.data);
  refresh();
  redirect("/general");
}
