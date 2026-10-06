import { z } from "zod";
import { ACTIVITY_TYPES } from "@/db/schema";
import { isValidDateString, todayString } from "@/lib/dates";
import { optionalText } from "./common";

const dayField = z
  .string()
  .trim()
  .default("")
  .transform((value) => (value === "" ? null : value))
  .pipe(
    z
      .string()
      .refine(isValidDateString, "Enter a valid date.")
      .refine((value) => value <= todayString(), "That date is in the future.")
      .nullable(),
  );

export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  summary: z.string().trim().min(1, "Describe what happened.").max(200, "Keep the summary under 200 characters."),
  body: optionalText(10_000),
  day: dayField,
});

export type ActivityInput = z.infer<typeof activitySchema>;
