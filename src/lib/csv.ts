const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (value instanceof Date) text = value.toISOString();
  else if (Array.isArray(value)) text = value.join(";");
  else text = String(value);
  // A spreadsheet would run a cell that starts with these as a formula; mark it as text.
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export class CsvError extends Error {}

/** RFC 4180 parser: quoted fields, doubled quotes, embedded newlines, CRLF or LF, optional BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      sawAny = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      sawAny = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAny = false;
    } else {
      field += char;
      sawAny = true;
    }
  }
  if (quoted) throw new CsvError("The file has an unclosed quote.");
  if (sawAny || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type CsvTable = { headers: string[]; rows: { line: number; values: Record<string, string> }[] };

/** Header names are lowercased and trimmed; blank lines are skipped; `line` is the 1-based file line. */
export function parseCsvTable(input: string): CsvTable {
  const all = parseCsv(input);
  if (all.length === 0) throw new CsvError("The file is empty.");
  const headers = all[0].map((header) => header.trim().toLowerCase());
  const rows: CsvTable["rows"] = [];
  all.slice(1).forEach((fields, index) => {
    if (fields.every((value) => value.trim() === "")) return;
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) values[header] = (fields[column] ?? "").replace(/^'(?=[=+\-@])/, "");
    });
    rows.push({ line: index + 2, values });
  });
  return { headers, rows };
}
