import { z } from "zod";
import { PRIORITIES, SECTIONS } from "@/db/schema";
import { normalizeUrl, optionalEmail, optionalHttpUrl, optionalText, tagsField, uuid } from "./common";

const priorityField = z
  .string()
  .default("")
  .transform((value) => (value === "" ? null : value))
  .pipe(z.enum(PRIORITIES).nullable());

// A form without a company field leaves the link alone (undefined); a blank field clears it.
const companyIdField = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" ? null : value))
  .pipe(uuid.nullable().optional());

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200, "Keep the name under 200 characters."),
  title: optionalText(200),
  email: optionalEmail,
  phone: optionalText(60),
  linkedinUrl: optionalHttpUrl.transform(normalizeUrl),
  notes: optionalText(10_000),
  priority: priorityField,
  companyId: companyIdField,
  tags: tagsField,
});

export type ContactInput = z.infer<typeof contactSchema>;

export const sectionSchema = z.enum(SECTIONS);
