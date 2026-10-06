import { z } from "zod";
import { PRIORITIES, SECTIONS } from "@/db/schema";
import { normalizeUrl, optionalEmail, optionalHttpUrl, optionalText, tagsField, uuid } from "./common";

const priorityField = z
  .string()
  .default("")
  .transform((value) => (value === "" ? null : value))
  .pipe(z.enum(PRIORITIES).nullable());

const companyIdField = z
  .string()
  .default("")
  .transform((value) => (value === "" ? null : value))
  .pipe(uuid.nullable());

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
