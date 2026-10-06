import type { FieldErrors } from "@/lib/validation/common";

// Lives outside the "use server" action files, which may only export async functions.
export type FormState = { errors: FieldErrors; message: string | null; saved: number; values: Record<string, string> };
export const emptyFormState: FormState = { errors: {}, message: null, saved: 0, values: {} };
