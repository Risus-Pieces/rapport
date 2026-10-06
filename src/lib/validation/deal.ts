import { z } from "zod";
import { isValidDateString } from "@/lib/dates";
import { parseDollars } from "@/lib/money";
import { FIRM_TYPES, INVESTOR_TYPES } from "@/lib/sections";
import { optionalEmail, optionalText } from "./common";

const amountField = z
  .string()
  .trim()
  .default("")
  .transform((value, ctx) => {
    const cents = parseDollars(value);
    if (cents === "invalid") {
      ctx.addIssue({ code: "custom", message: "Enter an amount in dollars, like 25000 or 1500.50." });
      return z.NEVER;
    }
    return cents;
  });

const nextStepDateField = z
  .string()
  .trim()
  .default("")
  .transform((value) => (value === "" ? null : value))
  .pipe(z.string().refine(isValidDateString, "Enter a valid date.").nullable());

const name = z.string().trim().min(1, "Enter a name.").max(200, "Keep the name under 200 characters.");
const detail = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`).default("");

const dealFacts = {
  amount: amountField,
  nextStep: optionalText(300),
  nextStepDate: nextStepDateField,
};

export const restaurantSchema = z.object({
  name,
  city: optionalText(120),
  cuisine: detail(100),
  neighborhood: detail(100),
  currentSupplier: detail(200),
  orderFrequency: detail(100),
  ...dealFacts,
});
export type RestaurantInput = z.infer<typeof restaurantSchema>;

export const investorSchema = z.object({
  investorType: z.enum(INVESTOR_TYPES, "Choose angel or institution."),
  name,
  email: optionalEmail,
  background: detail(2000),
  firmType: z.enum(FIRM_TYPES).default("vc"),
  focusStage: detail(100),
  checkSize: detail(100),
  introducedBy: detail(200),
  ...dealFacts,
});
export type InvestorInput = z.infer<typeof investorSchema>;

// The investor type is fixed at creation, so edits never include it.
export const investorUpdateSchema = investorSchema.omit({ investorType: true });
