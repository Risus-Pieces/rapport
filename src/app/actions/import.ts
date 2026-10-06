"use server";

import { revalidatePath } from "next/cache";
import { importContacts, listContactKeys } from "@/db/queries/contacts";
import { MAX_IMPORT_BYTES, planContactImport } from "@/lib/contact-import";
import { CsvError, parseCsvTable } from "@/lib/csv";
import { requireSession } from "@/lib/session";

export type ImportState = {
  message: string | null;
  created: number;
  duplicates: number;
  errors: { line: number; message: string }[];
  ran: number;
};

const fail = (message: string, ran: number): ImportState => ({ message, created: 0, duplicates: 0, errors: [], ran });

// Valid rows are imported and bad rows are reported by line; duplicates are skipped.
export async function importContactsAction(prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await requireSession();
  const ran = prev.ran + 1;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.", ran);
  if (file.size > MAX_IMPORT_BYTES) return fail("That file is over 1 MB. Split it and import the parts.", ran);
  let plan;
  try {
    const table = parseCsvTable(await file.text());
    if (!table.headers.includes("name")) return fail('The file needs a "name" column.', ran);
    plan = planContactImport(table.rows, await listContactKeys(session.user.id));
  } catch (error) {
    if (error instanceof CsvError) return fail(error.message, ran);
    throw error;
  }
  let created = 0;
  try {
    created = await importContacts(session.user.id, plan.toCreate);
  } catch (error) {
    console.error("importContactsAction failed:", error instanceof Error ? error.message : error);
    return fail("Could not save the contacts. Nothing was imported. Try again.", ran);
  }
  revalidatePath("/", "layout");
  return { message: null, created, duplicates: plan.duplicates, errors: plan.errors, ran };
}
