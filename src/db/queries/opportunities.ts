import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { radarItems } from "@/db/schema";
import { statusesFor, type OpportunityStatus, type OpportunityView } from "@/lib/opportunities";
import { dedupeKey } from "@/lib/radar/dedupe";
import { FEEDS, KINDS, PERSON_KINDS, isFeed, isPersonKind, type Feed } from "@/lib/radar/types";
import { escapeLike } from "./util";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.
// Opportunities are radar_items that aren't people (people live in the CRM).

export const OPPORTUNITY_SORTS = ["date", "score", "newest"] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];

export type OpportunityFilters = { feed: Feed; view: OpportunityView; kind?: string; q?: string; rice?: boolean; sort: OpportunitySort };
export type OpportunityRow = typeof radarItems.$inferSelect;

const notPerson = sql`${radarItems.kind} not in (${sql.join(PERSON_KINDS.map((k) => sql`${k}`), sql`, `)})`;
const when = sql`coalesce(${radarItems.eventDate}, ${radarItems.deadline})`;
// Past dates are noise in To apply; they stay visible once the owner has acted on them.
const notPast = sql`(${when} is null or ${when} >= current_date)`;

function viewWhere(view: OpportunityView) {
  return and(inArray(radarItems.status, statusesFor(view)), view === "to_apply" ? notPast : undefined);
}

export async function listOpportunities(userId: string, f: OpportunityFilters): Promise<OpportunityRow[]> {
  const q = f.q?.trim().slice(0, 100);
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const where: (SQL | undefined)[] = [
    eq(radarItems.userId, userId),
    eq(radarItems.feed, f.feed),
    notPerson,
    viewWhere(f.view),
    f.kind ? eq(radarItems.kind, f.kind) : undefined,
    f.rice ? sql`'rice' = any(${radarItems.tags})` : undefined,
    pattern
      ? or(
          ilike(radarItems.title, pattern),
          ilike(radarItems.summary, pattern),
          ilike(radarItems.whyRelevant, pattern),
          sql`${radarItems.details}::text ilike ${pattern}`,
          sql`array_to_string(${radarItems.tags}, ' ') ilike ${pattern}`,
        )
      : undefined,
  ];
  const order =
    f.sort === "date"
      ? [sql`${when} asc nulls last`, desc(radarItems.score)]
      : f.sort === "newest"
        ? [desc(radarItems.firstSeen), desc(radarItems.score)]
        : [desc(radarItems.score), desc(radarItems.firstSeen)];
  return db.select().from(radarItems).where(and(...where)).orderBy(...order).limit(300);
}

export async function opportunityCounts(userId: string, feed: Feed): Promise<Record<OpportunityView, number>> {
  const rows = await db
    .select({ status: radarItems.status, n: count() })
    .from(radarItems)
    .where(and(eq(radarItems.userId, userId), eq(radarItems.feed, feed), notPerson, or(sql`${radarItems.status} not in ('new', 'seen', 'saved')`, notPast)))
    .groupBy(radarItems.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return {
    to_apply: (by.new ?? 0) + (by.seen ?? 0) + (by.saved ?? 0),
    applied: by.applied ?? 0,
    on_hold: by.on_hold ?? 0,
    dismissed: by.dismissed ?? 0,
  };
}

export async function opportunityKindCounts(userId: string, feed: Feed, view: OpportunityView): Promise<{ kind: string; n: number }[]> {
  return db
    .select({ kind: radarItems.kind, n: count() })
    .from(radarItems)
    .where(and(eq(radarItems.userId, userId), eq(radarItems.feed, feed), notPerson, viewWhere(view)))
    .groupBy(radarItems.kind)
    .orderBy(desc(count()));
}

/** New, still-upcoming opportunities per feed (the sidebar badge and Home). */
export async function newOpportunityCounts(userId: string): Promise<Record<Feed, number>> {
  const rows = await db
    .select({ feed: radarItems.feed, n: count() })
    .from(radarItems)
    .where(and(eq(radarItems.userId, userId), eq(radarItems.status, "new"), notPerson, notPast))
    .groupBy(radarItems.feed);
  const out = Object.fromEntries(FEEDS.map((f) => [f, 0])) as Record<Feed, number>;
  for (const r of rows) if (r.feed in out) out[r.feed as Feed] = r.n;
  return out;
}

/** Triage an opportunity. People are never changed here (they live in the CRM). */
export async function setOpportunityStatus(userId: string, id: string, status: OpportunityStatus): Promise<boolean> {
  const rows = await db
    .update(radarItems)
    .set({ status })
    .where(and(eq(radarItems.userId, userId), eq(radarItems.id, id), notPerson))
    .returning({ id: radarItems.id });
  return rows.length > 0;
}

export async function markOpportunitiesSeen(userId: string, feed: Feed): Promise<void> {
  await db
    .update(radarItems)
    .set({ status: "seen" })
    .where(and(eq(radarItems.userId, userId), eq(radarItems.feed, feed), eq(radarItems.status, "new"), notPerson));
}

export type NewOpportunity = {
  feed: string;
  kind: string;
  title: string;
  url: string;
  deadline?: string | null;
  eventDate?: string | null;
  pitchCompetition?: boolean;
  notes?: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Something the owner found themselves (never a person). It lands in To apply, starred, tagged "added-by-me", and the
 * weekly research uses it as a seed to look for similar competitions.
 */
export async function addOpportunity(userId: string, input: NewOpportunity): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const title = input.title.trim().slice(0, 160);
  const url = input.url.trim();
  if (!isFeed(input.feed) || !KINDS[input.feed].includes(input.kind) || isPersonKind(input.kind)) {
    return { ok: false, error: "Choose a type (people go in the CRM)." };
  }
  if (!title) return { ok: false, error: "Add a name." };
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("bad");
  } catch {
    return { ok: false, error: "Add the link (starting with https://)." };
  }
  const deadline = input.deadline && DAY.test(input.deadline) ? input.deadline : null;
  const eventDate = input.eventDate && DAY.test(input.eventDate) ? input.eventDate : null;
  const [row] = await db
    .insert(radarItems)
    .values({
      userId,
      feed: input.feed,
      kind: input.kind,
      title,
      url,
      source: "Added by you",
      score: 80,
      status: "saved",
      tags: ["added-by-me", ...(input.pitchCompetition ? ["pitch-competition"] : [])],
      deadline,
      eventDate,
      notes: (input.notes ?? "").trim().slice(0, 4000),
      dedupeKey: dedupeKey({ feed: input.feed, kind: input.kind, title, url, event_date: eventDate }),
      taskId: "owner",
    })
    .onConflictDoNothing()
    .returning({ id: radarItems.id });
  return row ? { ok: true, id: row.id } : { ok: false, error: "That's already in Opportunities." };
}
