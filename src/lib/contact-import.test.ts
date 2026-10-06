import { describe, expect, it } from "vitest";
import { parseCsvTable } from "./csv";
import { importKey, MAX_IMPORT_ROWS, planContactImport } from "./contact-import";

const plan = (csv: string, existing: string[] = []) => planContactImport(parseCsvTable(csv).rows, new Set(existing));

describe("planContactImport", () => {
  it("defaults to General and accepts friendly priorities and semicolon tags", () => {
    const result = plan("name,priority,tags\nAda,Very High,friend;family\n");
    expect(result.errors).toEqual([]);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0].section).toBe("general");
    expect(result.toCreate[0].input).toMatchObject({ name: "Ada", priority: "very_high", tags: ["friend", "family"] });
  });

  it("reports bad rows with their file line and keeps the good ones", () => {
    const result = plan("name,email,section\nGood,g@x.test,general\n,nobody@x.test,general\nBad,not-an-email,general\nOdd,,mars\n");
    expect(result.toCreate.map((c) => c.input.name)).toEqual(["Good"]);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(result.errors[0].message).toMatch(/name/);
    expect(result.errors[2].message).toMatch(/Unknown section/);
  });

  it("skips contacts that already exist, by email or by name, and repeats inside the file", () => {
    const result = plan(
      "name,email\nAda,ADA@x.test\nBo,\nBo,\nCy,cy@x.test\n",
      [importKey("general", "x", "ada@x.test"), importKey("general", "cy", "cy@x.test")],
    );
    expect(result.toCreate.map((c) => c.input.name)).toEqual(["Bo"]);
    expect(result.duplicates).toBe(3);
  });

  it("treats the same name in different sections as different contacts", () => {
    const result = plan("name,section\nAda,general\nAda,investors\n");
    expect(result.toCreate).toHaveLength(2);
  });

  it("refuses an oversized file without importing anything", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i}`).join("\n");
    const result = plan(`name\n${rows}`);
    expect(result.toCreate).toEqual([]);
    expect(result.errors[0].message).toMatch(/at most/);
  });

  it("rejects links that are not http(s)", () => {
    const result = plan("name,linkedin_url\nA,javascript:alert(1)\n");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/^linkedin_url:/);
  });
});
