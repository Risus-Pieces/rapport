"use server";

import { revalidatePath } from "next/cache";
import { importKeysScoped } from "@/db/queries/access";
import { importContacts } from "@/db/queries/contacts";
import { MAX_IMPORT_BYTES, planContactImport } from "@/lib/contact-import";
import { CsvError, parseCsvTable } from "@/lib/csv";
import { getScope } from "@/lib/scope";

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
  const scope = await getScope();
  const ran = prev.ran + 1;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.", ran);
  if (file.size > MAX_IMPORT_BYTES) return fail("That file is over 1 MB. Split it and import the parts.", ran);
  let plan;
  try {
    const table = parseCsvTable(await file.text());
    if (!table.headers.includes("name")) return fail('The file needs a "name" column.', ran);
    // General rows are personal; Restaurants and Investors rows go to the shared workspace.
    plan = planContactImport(table.rows, await importKeysScoped(scope));
  } catch (error) {
    if (error instanceof CsvError) return fail(error.message, ran);
    throw error;
  }
  let created = 0;
  try {
    const personal = plan.toCreate.filter((c) => c.section === "general");
    const shared = plan.toCreate.filter((c) => c.section !== "general");
    created = (personal.length ? await importContacts(scope.userId, personal) : 0) + (shared.length ? await importContacts(scope.workspaceId, shared) : 0);
  } catch (error) {
    console.error("importContactsAction failed:", error instanceof Error ? error.message : error);
    return fail("Could not save the contacts. Nothing was imported. Try again.", ran);
  }
  revalidatePath("/", "layout");
  return { message: null, created, duplicates: plan.duplicates, errors: plan.errors, ran };
}
