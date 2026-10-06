import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, parseCsvTable, toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header and rows with CRLF line endings", () => {
    expect(toCsv(["a", "b"], [{ a: 1, b: "x" }])).toBe("a,b\r\n1,x\r\n");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(["a"], [{ a: 'say "hi", ok\nnow' }])).toBe('a\r\n"say ""hi"", ok\nnow"\r\n');
  });

  it("formats null, dates and arrays", () => {
    const csv = toCsv(["n", "d", "t"], [{ n: null, d: new Date("2026-10-06T12:00:00Z"), t: ["a", "b"] }]);
    expect(csv).toBe("n,d,t\r\n,2026-10-06T12:00:00.000Z,a;b\r\n");
  });

  it("marks cells that would run as spreadsheet formulas", () => {
    for (const bad of ["=SUM(A1)", "+1", "-2", "@cmd", "\tx"]) {
      expect(toCsv(["a"], [{ a: bad }]).split("\r\n")[1]).toBe(`'${bad}`);
    }
  });
});

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded newlines, CRLF and a BOM", () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z';
    expect(parseCsv(text)).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "z"]]);
  });

  it("keeps empty fields and a trailing empty field", () => {
    expect(parseCsv("a,b,c\n1,,\n")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(CsvError);
  });

  it("round-trips what toCsv writes", () => {
    const rows = [{ a: 'q"uote', b: "multi\nline", c: "plain" }];
    expect(parseCsv(toCsv(["a", "b", "c"], rows))[1]).toEqual(['q"uote', "multi\nline", "plain"]);
  });
});

describe("parseCsvTable", () => {
  it("lowercases headers, skips blank lines and numbers rows by file line", () => {
    const table = parseCsvTable("Name, Email \n\nAda,ada@x.test\n  ,  \nBo,\n");
    expect(table.headers).toEqual(["name", "email"]);
    expect(table.rows).toEqual([
      { line: 3, values: { name: "Ada", email: "ada@x.test" } },
      { line: 5, values: { name: "Bo", email: "" } },
    ]);
  });

  it("undoes the formula marker it wrote on export", () => {
    expect(parseCsvTable("name\n'=HYPERLINK()\n'normal").rows.map((r) => r.values.name)).toEqual(["=HYPERLINK()", "'normal"]);
  });

  it("reports the file line a record starts on, even after multi-line fields", () => {
    const table = parseCsvTable('name,email,notes\nAda,a@x.test,"line1\nline2\nline3"\nBo,not-an-email,\r\nCy,c@x.test,"a\rb"\nDi,d@x.test,');
    expect(table.rows.map((r) => [r.values.name, r.line])).toEqual([["Ada", 2], ["Bo", 5], ["Cy", 6], ["Di", 8]]);
  });

  it("round-trips values that start with a tab, a carriage return or a formula character", () => {
    const values = ["\tfoo", "\r=1", "=SUM(A1)", "+1", "-2", "@x"];
    const csv = toCsv(["name"], values.map((name) => ({ name })));
    expect(parseCsvTable(csv).rows.map((r) => r.values.name)).toEqual(values);
  });

  it("rejects an empty file", () => {
    expect(() => parseCsvTable("")).toThrow(CsvError);
  });
});
