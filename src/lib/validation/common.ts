import { z } from "zod";

// Form fields arrive as strings: blank means "not set".
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

export const optionalEmail = z
  .string()
  .trim()
  .max(320)
  .transform((value) => (value === "" ? null : value))
  .pipe(z.email("Enter a valid email address.").nullable())
  .default(null);

// Only http(s) links are stored, so a saved value can never be a javascript: URL.
export const optionalHttpUrl = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" ? null : value))
  .pipe(
    z
      .string()
      .refine((value) => {
        try {
          const url = new URL(value.includes("://") ? value : `https://${value}`);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, "Enter a valid web address.")
      .nullable(),
  )
  .default(null);

export function normalizeUrl(value: string | null): string | null {
  if (value === null) return null;
  return value.includes("://") ? value : `https://${value}`;
}

export const tagsField = z
  .string()
  .default("")
  .transform((value) =>
    [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
  )
  .pipe(
    z
      .array(z.string().max(40, "Tags must be under 40 characters."))
      .max(20, "Use at most 20 tags."),
  );

export const uuid = z.uuid();

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Turns FormData into a plain object of string values (files and repeated keys are ignored). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !(key in out) && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}
