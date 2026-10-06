import { describe, expect, it } from "vitest";
import { fieldErrors } from "./common";
import { investorSchema, restaurantSchema } from "./deal";

describe("restaurantSchema", () => {
  it("accepts a name alone and converts the amount to cents", () => {
    const r = restaurantSchema.parse({ name: " Trattoria ", amount: "$2,500" });
    expect(r.name).toBe("Trattoria");
    expect(r.amount).toBe(250_000);
    expect(r.nextStep).toBeNull();
    expect(r.nextStepDate).toBeNull();
  });

  it("explains a bad amount and a bad date", () => {
    const result = restaurantSchema.safeParse({ name: "A", amount: "lots", nextStepDate: "2026-02-31" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.amount).toMatch(/dollars/);
      expect(errors.nextStepDate).toBe("Enter a valid date.");
    }
  });

  it("treats a blank amount as unknown", () => {
    expect(restaurantSchema.parse({ name: "A", amount: "" }).amount).toBeNull();
  });
});

describe("investorSchema", () => {
  it("requires a type, never inferring one", () => {
    const result = investorSchema.safeParse({ name: "Ada" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).investorType).toBeTruthy();
    expect(investorSchema.safeParse({ name: "Ada", investorType: "whale" }).success).toBe(false);
  });

  it("accepts both types and defaults the firm type", () => {
    expect(investorSchema.parse({ name: "Ada", investorType: "angel" }).investorType).toBe("angel");
    const firm = investorSchema.parse({ name: "Fund I", investorType: "institution" });
    expect(firm.firmType).toBe("vc");
  });

  it("validates the angel email", () => {
    expect(investorSchema.safeParse({ name: "A", investorType: "angel", email: "x" }).success).toBe(false);
  });
});
