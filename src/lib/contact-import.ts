import { SECTIONS, type Section } from "@/db/schema";
import type { CsvTable } from "@/lib/csv";
import { fieldErrors } from "@/lib/validation/common";
import { contactSchema, type ContactInput } from "@/lib/validation/contact";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 1_000_000;
export const IMPORT_ERRORS_SHOWN = 10;

export type ImportItem = { section: Section; input: ContactInput };
export type ImportPlan = {
  toCreate: ImportItem[];
  duplicates: number;
  errors: { line: number; message: string }[];
};

export const importKey = (section: string, name: string, email: string | null) =>
  `${section}|${(email?.trim() || name.trim()).toLowerCase()}`;

function normalizePriority(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Validates every row with the same schema as the contact form and drops contacts that already
 * exist (same section and email, or same name when there is no email), including repeats in the
 * file itself. Nothing is written here.
 */
export function planContactImport(rows: CsvTable["rows"], existing: Set<string>): ImportPlan {
  const plan: ImportPlan = { toCreate: [], duplicates: 0, errors: [] };
  if (rows.length > MAX_IMPORT_ROWS) {
    plan.errors.push({ line: 0, message: `Import at most ${MAX_IMPORT_ROWS} rows at a time.` });
    return plan;
  }
  const seen = new Set(existing);
  for (const { line, values } of rows) {
    const section = (values.section?.trim().toLowerCase() || "general") as Section;
    if (!SECTIONS.includes(section)) {
      plan.errors.push({ line, message: `Unknown section "${values.section}". Use restaurants, investors or general.` });
      continue;
    }
    const parsed = contactSchema.safeParse({
      name: values.name ?? "",
      title: values.title ?? "",
      email: values.email ?? "",
      phone: values.phone ?? "",
      linkedinUrl: values.linkedin_url ?? values.linkedin ?? "",
      notes: values.notes ?? "",
      priority: normalizePriority(values.priority ?? ""),
      tags: (values.tags ?? "").replace(/;/g, ","),
    });
    if (!parsed.success) {
      const [field, message] = Object.entries(fieldErrors(parsed.error))[0];
      plan.errors.push({ line, message: `${field}: ${message}` });
      continue;
    }
    const key = importKey(section, parsed.data.name, parsed.data.email);
    if (seen.has(key)) {
      plan.duplicates++;
      continue;
    }
    seen.add(key);
    plan.toCreate.push({ section, input: parsed.data });
  }
  return plan;
}
