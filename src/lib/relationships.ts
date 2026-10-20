/** Where a person (or an investor/restaurant deal) stands. See docs/superpowers/specs/2026-10-20-relationships-and-opportunities-design.md. */
export const RELATIONSHIPS = ["to_reach_out", "known", "ghosted", "on_hold", "dismissed"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  to_reach_out: "To reach out",
  known: "Know them",
  ghosted: "Ghosted",
  on_hold: "On hold",
  dismissed: "Dismissed",
};

export const isRelationship = (value: string): value is Relationship => (RELATIONSHIPS as readonly string[]).includes(value);
