import { describe, expect, it } from "vitest";
import { companyKey, parseLinkedInConnections, parseProspectCsv } from "@/lib/radar/import";

describe("radar CSV parsing", () => {
  it("parses a LinkedIn Connections.csv with its preamble", () => {
    const csv = [
      "Notes:",
      '"When exporting your connection data, you may notice that some of the email addresses are missing."',
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Sam,Lee,https://www.linkedin.com/in/samlee,,Acme Ventures LLC,Principal,05 Mar 2024",
      'Ana,"Diaz, PhD",https://www.linkedin.com/in/ana,ana@x.co,"Rice Alliance",Director,17 Oct 2022',
      ",,,,,,",
    ].join("\n");
    const c = parseLinkedInConnections(csv);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ full_name: "Sam Lee", company: "Acme Ventures LLC", connected_on: "2024-03-05", email: null });
    expect(c[1]).toMatchObject({ full_name: "Ana Diaz, PhD", email: "ana@x.co", connected_on: "2022-10-17" });
    expect(parseLinkedInConnections("name,company\nx,y")).toEqual([]);
  });
  it("normalizes company names for matching", () => {
    expect(companyKey("Acme Ventures, LLC")).toBe("acme ventures");
    expect(companyKey("The Acme Co.")).toBe("acme");
    expect(companyKey("")).toBeNull();
  });
  it("reads optional kind and purpose columns", () => {
    const { rows, extras } = parseProspectCsv("name,kind,purpose,url\nA,Celebrity,ambassador,https://a.com\nB,,,https://b.com\nC,buyer,bogus,https://c.com\n");
    expect(rows.map((r) => r.kind)).toEqual(["celebrity", "angel", "buyer"]);
    expect(extras.map((e) => e.purpose)).toEqual(["ambassador", null, null]);
  });
  it("maps prospect CSV columns and aliases", () => {
    const { rows, extras } = parseProspectCsv("Full Name,Company,Title,Source URL,Fit,LinkedIn\nJane Doe,Acme,Partner,https://a.com/j,82,https://www.linkedin.com/in/jane\n");
    expect(rows[0]).toMatchObject({ kind: "angel", title: "Jane Doe", url: "https://a.com/j", score: 82, details: { firm: "Acme", role: "Partner" } });
    expect(extras[0].linkedin_url).toBe("https://www.linkedin.com/in/jane");
  });
  it("skips blank rows and tolerates a byte-order mark", () => {
    const { rows } = parseProspectCsv("﻿name,url\nA,https://a.com\n,\n\n");
    expect(rows.map((r) => r.title)).toEqual(["A"]);
  });
});
