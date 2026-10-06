import { describe, expect, it } from "vitest";
import { firstName, initials } from "./greeting";

describe("firstName", () => {
  it("returns the first word of a full name", () => {
    expect(firstName("Risus Zhao")).toBe("Risus");
  });

  it("trims surrounding whitespace", () => {
    expect(firstName("  Risus  ")).toBe("Risus");
  });

  it("splits on any run of whitespace", () => {
    expect(firstName("Risus   \t Zhao")).toBe("Risus");
  });

  it("keeps hyphenated first names whole", () => {
    expect(firstName("Mary-Jane Smith")).toBe("Mary-Jane");
  });

  it("returns a single-word name as is", () => {
    expect(firstName("Risus")).toBe("Risus");
  });

  it("falls back to 'there' for empty, blank or missing names", () => {
    expect(firstName("")).toBe("there");
    expect(firstName("   ")).toBe("there");
    expect(firstName(undefined)).toBe("there");
    expect(firstName(null)).toBe("there");
  });
});

describe("initials", () => {
  it("uses the first letters of the first and last words", () => {
    expect(initials("Risus Zhao", "boxuan@x.test")).toBe("RZ");
  });

  it("uses only the first and last words of a longer name", () => {
    expect(initials("Mary Jane Smith", "mj@x.test")).toBe("MS");
  });

  it("returns one initial for a single-word name", () => {
    expect(initials("Risus", "boxuan@x.test")).toBe("R");
  });

  it("uppercases lowercase names and ignores extra whitespace", () => {
    expect(initials("  risus   zhao ", "boxuan@x.test")).toBe("RZ");
  });

  it("handles accented and non-ASCII letters as one initial each", () => {
    expect(initials("émile zola", "e@x.test")).toBe("ÉZ");
    expect(initials("ßeta 𝒜lpha", "e@x.test")).toBe("S𝒜");
  });

  it("falls back to the first letter of the email when the name is empty", () => {
    expect(initials("", "boxuan@x.test")).toBe("B");
    expect(initials("   ", "boxuan@x.test")).toBe("B");
    expect(initials(undefined, "boxuan@x.test")).toBe("B");
    expect(initials(null, "boxuan@x.test")).toBe("B");
  });

  it("is never empty, even with an empty email", () => {
    expect(initials("", "").length).toBeGreaterThan(0);
    expect(initials(null, "  ").length).toBeGreaterThan(0);
  });
});
