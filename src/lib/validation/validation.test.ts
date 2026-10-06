import { describe, expect, it } from "vitest";
import { companySchema } from "./company";
import { fieldErrors, formToObject } from "./common";
import { contactSchema } from "./contact";

describe("contactSchema", () => {
  it("accepts a minimal contact and nulls the blanks", () => {
    const result = contactSchema.parse({ name: "  Ada Lovelace " });
    expect(result).toEqual({
      name: "Ada Lovelace",
      title: null,
      email: null,
      phone: null,
      linkedinUrl: null,
      notes: null,
      priority: null,
      tags: [],
    });
    expect(result.companyId).toBeUndefined();
  });

  it("distinguishes a missing company field (unchanged) from a blank one (cleared)", () => {
    expect(contactSchema.parse({ name: "A" }).companyId).toBeUndefined();
    expect(contactSchema.parse({ name: "A", companyId: "" }).companyId).toBeNull();
  });

  it("turns blank form strings into null", () => {
    const result = contactSchema.parse({ name: "A", email: "", priority: "", companyId: "", title: " " });
    expect(result).toMatchObject({ email: null, priority: null, companyId: null, title: null });
  });

  it("requires a name", () => {
    const result = contactSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).name).toBe("Enter a name.");
  });

  it("rejects a bad email, priority and company id", () => {
    const result = contactSchema.safeParse({ name: "A", email: "nope", priority: "urgent", companyId: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrors(result.error)).sort()).toEqual(["companyId", "email", "priority"]);
  });

  it("accepts every priority including gone", () => {
    for (const priority of ["very_high", "high", "medium", "low", "gone"]) {
      expect(contactSchema.parse({ name: "A", priority }).priority).toBe(priority);
    }
  });

  it("only stores http(s) links and adds a scheme when missing", () => {
    expect(contactSchema.parse({ name: "A", linkedinUrl: "linkedin.com/in/ada" }).linkedinUrl).toBe(
      "https://linkedin.com/in/ada",
    );
    expect(contactSchema.safeParse({ name: "A", linkedinUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "A", linkedinUrl: "ftp://x.test/a" }).success).toBe(false);
  });

  it("normalizes tags: trims, lowercases, dedupes, drops blanks", () => {
    expect(contactSchema.parse({ name: "A", tags: " Friend, family ,friend,, " }).tags).toEqual(["friend", "family"]);
  });

  it("limits tag count", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`).join(",");
    expect(contactSchema.safeParse({ name: "A", tags }).success).toBe(false);
  });
});

describe("companySchema", () => {
  it("requires a name and normalizes the website", () => {
    expect(companySchema.safeParse({ name: "" }).success).toBe(false);
    expect(companySchema.parse({ name: "Trattoria", website: "trattoria.test" }).website).toBe("https://trattoria.test");
  });
});

describe("formToObject", () => {
  it("keeps the first string value per key and ignores files and action ids", () => {
    const form = new FormData();
    form.append("name", "A");
    form.append("name", "B");
    form.append("$ACTION_ID_abc", "");
    form.append("file", new Blob(["x"]), "x.txt");
    expect(formToObject(form)).toEqual({ name: "A" });
  });
});
