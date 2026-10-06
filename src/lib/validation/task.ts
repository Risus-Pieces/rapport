import { z } from "zod";
import { isValidDateString } from "@/lib/dates";
import { uuid } from "./common";

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value ? value : null))
  .pipe(uuid.nullable());

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Enter a task.").max(200, "Keep the task under 200 characters."),
  dueDate: z
    .string()
    .trim()
    .default("")
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().refine(isValidDateString, "Enter a valid date.").nullable()),
  contactId: optionalId,
  dealId: optionalId,
});

export type TaskInput = z.infer<typeof taskSchema>;
