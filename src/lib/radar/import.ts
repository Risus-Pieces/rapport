import { parseCsv } from "@/lib/csv";
import { isPurpose, type Purpose, type RadarDetails } from "./types";

/**
 * CSV parsing for the Radar (ports of Query's importers): people to add to the Radar, and the
 * owner's LinkedIn "Connections.csv" for warm-intro matching. Pure; the database side is in
 * src/db/queries/radar.ts.
 */

const rowsOf = (text: string) => parseCsv(text).filter((r) => r.some((f) => f.trim() !== ""));

/** A finding in the shape rr_ingest() accepts. */
export interface RawFinding {
  kind: string;
  title: string;
  url: string | null;
  source: string | null;
  summary: string;
  why_relevant: string;
  score: number;
  tags: string[];
  event_date: string | null;
  deadline: string | null;
  location: string | null;
  details: Required<{ [K in keyof RadarDetails]: string | null }>;
}

export interface ProspectExtra {
  linkedin_url: string | null;
  email: string | null;
  purpose: Purpose | null;
}

const ALIASES: Record<string, string> = {
  "full name": "name",
  company: "firm",
  organization: "firm",
  title: "role",
  "source url": "url",
  source: "url",
  linkedin: "linkedin_url",
  "linkedin url": "linkedin_url",
  "person linkedin url": "linkedin_url",
  "email address": "email",
  evidence: "summary",
  fit: "score",
  type: "kind",
};

/**
 * People CSV. Columns (case-insensitive, any order): name, kind (default angel), purpose, firm, role,
 * rice_connection, check_size, contact_path, summary, why_relevant, url (public source), location,
 * tags (";"-separated), score (default 70), linkedin_url, email.
 */
export function parseProspectCsv(text: string): { rows: RawFinding[]; extras: ProspectExtra[] } {
  const table = rowsOf(text);
  if (table.length < 2) return { rows: [], extras: [] };
  const head = table[0].map((h) => {
    const k = h.trim().toLowerCase().replace(/_/g, " ");
    return ALIASES[k] ?? k.replace(/ /g, "_");
  });
  const get = (r: string[], k: string) => {
    const i = head.indexOf(k);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const rows: RawFinding[] = [];
  const extras: ProspectExtra[] = [];
  for (const r of table.slice(1)) {
    const score = Number(get(r, "score"));
    const purpose = get(r, "purpose").toLowerCase();
    rows.push({
      // A blank kind means angel; anything else is kept as written so validation can reject it.
      kind: get(r, "kind").toLowerCase() || "angel",
      title: get(r, "name"),
      url: get(r, "url") || null,
      source: null,
      summary: get(r, "summary"),
      why_relevant: get(r, "why_relevant"),
      score: Number.isFinite(score) && get(r, "score") !== "" ? score : 70,
      tags: get(r, "tags").split(/[;|]/).map((t) => t.trim()).filter(Boolean),
      event_date: null,
      deadline: null,
      location: get(r, "location") || null,
      details: {
        firm: get(r, "firm") || null,
        role: get(r, "role") || null,
        rice_connection: get(r, "rice_connection") || null,
        check_size: get(r, "check_size") || null,
        contact_path: get(r, "contact_path") || null,
      },
    });
    extras.push({
      linkedin_url: get(r, "linkedin_url") || null,
      email: get(r, "email") || null,
      purpose: isPurpose(purpose) ? purpose : null,
    });
  }
  return { rows, extras };
}

export function companyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = name
    .toLowerCase()
    .replace(/\b(inc|llc|l\.l\.c|ltd|co|corp|corporation|company|the|lp|llp|plc)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return k || null;
}

export const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export const LINKEDIN_RE = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i;

export interface Connection {
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  email: string | null;
  connected_on: string | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** LinkedIn export: preamble lines, then "First Name,Last Name,URL,Email Address,Company,Position,Connected On". */
export function parseLinkedInConnections(text: string): Connection[] {
  const rows = rowsOf(text);
  const h = rows.findIndex((r) => r.map((c) => c.trim().toLowerCase()).includes("first name"));
  if (h === -1) return [];
  const head = rows[h].map((c) => c.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [fi, li, ui, ei, ci, pi, di] = ["first name", "last name", "url", "email address", "company", "position", "connected on"].map(col);
  const out: Connection[] = [];
  for (const r of rows.slice(h + 1)) {
    const full = [r[fi], r[li]].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
    if (!full) continue;
    let date: string | null = null;
    const raw = di >= 0 ? (r[di] ?? "").trim() : "";
    const m = raw.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
    if (m && MONTHS[m[2].toLowerCase()]) date = `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
    const url = ui >= 0 ? (r[ui] ?? "").trim() : "";
    out.push({
      full_name: full.slice(0, 160),
      company: (ci >= 0 ? r[ci] : "")?.trim().slice(0, 160) || null,
      position: (pi >= 0 ? r[pi] : "")?.trim().slice(0, 160) || null,
      linkedin_url: /^https?:\/\//.test(url) ? url.slice(0, 300) : null,
      email: ei >= 0 && EMAIL_RE.test((r[ei] ?? "").trim()) ? r[ei].trim().toLowerCase() : null,
      connected_on: date,
    });
  }
  return out;
}
