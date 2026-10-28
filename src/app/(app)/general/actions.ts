"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createContact,
  deleteContact,
  InvalidCompanyError,
  updateContact,
} from "@/db/queries/contacts";
import { contactOwner } from "@/db/queries/access";
import { getScope } from "@/lib/scope";
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
  const scope = await getScope();
  const values = formToObject(formData);
  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: null, values };

  const id = values.id ? uuid.safeParse(values.id) : null;
  if (id && !id.success) return { errors: {}, message: "That contact could not be found.", values };

  let savedId: string;
  try {
    if (id) {
      const owner = await contactOwner(scope, id.data);
      const updated = owner ? await updateContact(owner, SECTION, id.data, parsed.data) : null;
      if (!updated) return { errors: {}, message: "That contact no longer exists.", values };
      savedId = updated.id;
    } else {
      // A new General contact is personal (only shared Sooz people are seen by the team).
      savedId = (await createContact(scope.userId, SECTION, parsed.data)).id;
    }
  } catch (error) {
    if (error instanceof InvalidCompanyError) return { errors: { companyId: error.message }, message: null, values };
    console.error("saveContactAction failed:", error instanceof Error ? error.message : error);
    return { errors: {}, message: "Could not save. Try again.", values };
  }
  refresh(savedId);
  redirect(`/general/${savedId}`);
}

export async function deleteContactAction(formData: FormData) {
  const scope = await getScope();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const owner = await contactOwner(scope, id.data);
  if (owner) await deleteContact(owner, SECTION, id.data);
  refresh();
  redirect("/general");
}
