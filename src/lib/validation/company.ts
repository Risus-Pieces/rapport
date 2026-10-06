import { z } from "zod";
import { normalizeUrl, optionalHttpUrl, optionalText, tagsField } from "./common";

export const companySchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200, "Keep the name under 200 characters."),
  website: optionalHttpUrl.transform(normalizeUrl),
  city: optionalText(120),
  notes: optionalText(10_000),
  tags: tagsField,
});

export type CompanyInput = z.infer<typeof companySchema>;
