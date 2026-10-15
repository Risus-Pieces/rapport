// Research feeds. "feed", not "section", so it never collides with Rapport's CRM sections.
export const FEEDS = ["sooz", "personal", "career"] as const;
export type Feed = (typeof FEEDS)[number];
export const isFeed = (f: string): f is Feed => (FEEDS as readonly string[]).includes(f);

export const RADAR_STATUSES = ["new", "seen", "saved", "dismissed", "approved"] as const;
export type RadarStatus = (typeof RADAR_STATUSES)[number];

/** Kinds that are people (one person per item): identified by name + firm, and eligible for outreach. */
export const PERSON_KINDS = ["angel", "celebrity", "nextgen", "creator", "buyer", "media"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];
export const isPersonKind = (k: string): k is PersonKind => (PERSON_KINDS as readonly string[]).includes(k);

export const SOOZ_KINDS = [...PERSON_KINDS, "event", "sampling", "funding", "resource"] as const;
export const PERSONAL_KINDS = [
  "hackathon",
  "event",
  "talk",
  "pass",
  "speaking",
  "perk",
  "grant",
  "leadership",
  "culture",
  "other",
] as const;
export const CAREER_KINDS = ["internship", "externship", "program", "fellowship", "scholarship", "job"] as const;

export const KINDS: Record<Feed, readonly string[]> = {
  sooz: SOOZ_KINDS,
  personal: PERSONAL_KINDS,
  career: CAREER_KINDS,
};

/** Why we are reaching out to a person. Drives the draft template. */
export const PURPOSES = ["invest", "ambassador", "buyer", "press", "intro"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const isPurpose = (p: string): p is Purpose => (PURPOSES as readonly string[]).includes(p);

export function defaultPurpose(kind: string): Purpose {
  switch (kind) {
    case "celebrity":
    case "creator":
      return "ambassador";
    case "buyer":
      return "buyer";
    case "media":
      return "press";
    default:
      return "invest";
  }
}

/** Where an approved person lands in Rapport. Non-people never become CRM records. */
export type CrmTarget = "investors" | "restaurants" | "general";
export function crmTargetFor(kind: string): CrmTarget | null {
  switch (kind) {
    case "angel":
    case "nextgen":
      return "investors";
    case "buyer":
      return "restaurants";
    case "celebrity":
    case "creator":
    case "media":
      return "general";
    default:
      return null;
  }
}

export interface RadarDetails {
  firm?: string | null;
  role?: string | null;
  rice_connection?: string | null;
  check_size?: string | null;
  contact_path?: string | null;
}
