import { isPersonKind } from "./types";

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|source$)/i;

/** Canonical form of a URL for dedupe: lowercase host, no www, no tracking params, no trailing slash, no hash. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return null;
  }
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Stable identity for a finding.
 * - People (angels, celebrities, next-gen investors, creators, buyers, press) are identified by kind + name
 *   (+ firm when known), regardless of which page we found them on. Angels key on the whole firm field (so
 *   existing rows keep their keys); the other person kinds key on the first firm listed.
 * - Everything else is identified by its canonical URL, falling back to title + date.
 */
export function dedupeKey(c: {
  feed: string;
  kind: string;
  title: string;
  url?: string | null;
  event_date?: string | null;
  firm?: string | null;
}): string {
  if (c.feed === "sooz" && isPersonKind(c.kind)) {
    if (c.kind === "angel") return `angel:${slug(c.title)}${c.firm ? `:${slug(c.firm)}` : ""}`;
    const firm = slug(firstFirm(c.firm) ?? "");
    return `${c.kind}:${slug(c.title)}${firm ? `:${firm}` : ""}`;
  }
  const norm = c.url ? normalizeUrl(c.url) : null;
  if (norm) return `${c.feed}:url:${norm}`;
  return `${c.feed}:${c.kind}:${slug(c.title)}:${c.event_date ?? ""}`;
}

/** "The Angel Group; Supernatural Ventures" → "The Angel Group". */
export function firstFirm(firm: string | null | undefined): string | null {
  const f = (firm ?? "").split(/[;|]/)[0]?.trim();
  return f || null;
}
