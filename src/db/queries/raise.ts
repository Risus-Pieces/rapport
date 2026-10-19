import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { outreach, radarItems, shortlist } from "@/db/schema";
import type { RadarDetails } from "@/lib/radar/types";
import { approveRadarItem } from "./radar";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export type ShortlistRow = {
  id: string;
  week: string;
  radarItemId: string;
  bucket: "investor" | "buyer";
  rank: number;
  reason: string;
  ask: string;
  status: "proposed" | "approved" | "skipped";
  name: string;
  kind: string;
  summary: string;
  details: RadarDetails;
  url: string | null;
  subject: string | null;
  body: string | null;
  email: string | null;
};

/** The Monday shortlist (this week's by default), investors first, in the routine's rank order. */
export async function currentWeek(): Promise<string> {
  const { rows } = await db.$client.query<{ w: string }>(`select rr_week_start(current_date)::text as w`);
  return rows[0].w;
}

export async function listShortlist(userId: string, week?: string): Promise<ShortlistRow[]> {
  const w = week ?? (await currentWeek());
  const rows = await db
    .select({ s: shortlist, item: radarItems, o: outreach })
    .from(shortlist)
    .innerJoin(radarItems, eq(radarItems.id, shortlist.radarItemId))
    .leftJoin(outreach, eq(outreach.radarItemId, shortlist.radarItemId))
    .where(and(eq(shortlist.userId, userId), eq(shortlist.week, w)))
    .orderBy(asc(shortlist.bucket), asc(shortlist.rank), asc(shortlist.createdAt));
  const order = { investor: 0, buyer: 1 } as const;
  return rows
    .map(({ s, item, o }) => ({
      id: s.id,
      week: s.week,
      radarItemId: s.radarItemId,
      bucket: s.bucket as ShortlistRow["bucket"],
      rank: s.rank,
      reason: s.reason,
      ask: s.ask,
      status: s.status as ShortlistRow["status"],
      name: item.title,
      kind: item.kind,
      summary: item.summary,
      details: item.details as RadarDetails,
      url: item.url,
      subject: o?.subject ?? null,
      body: o?.body ?? null,
      email: o?.email ?? null,
    }))
    .sort((a, b) => order[a.bucket] - order[b.bucket] || a.rank - b.rank);
}

/**
 * Approve the checked people of a week's shortlist: each goes into the CRM (if not there yet) and their drafts are
 * cleared for Gmail. Every other proposed row of that week is skipped. Rows already approved or skipped stay as
 * they are, so submitting twice changes nothing.
 */
export async function approveShortlist(userId: string, week: string, approveIds: string[]): Promise<{ approved: number; skipped: number }> {
  const proposed = await db
    .select({ id: shortlist.id, radarItemId: shortlist.radarItemId })
    .from(shortlist)
    .where(and(eq(shortlist.userId, userId), eq(shortlist.week, week), eq(shortlist.status, "proposed")));
  const wanted = new Set(approveIds);
  let approved = 0;
  for (const row of proposed.filter((r) => wanted.has(r.radarItemId))) {
    await approveRadarItem(userId, row.radarItemId);
    const updated = await db
      .update(shortlist)
      .set({ status: "approved" })
      .where(and(eq(shortlist.id, row.id), eq(shortlist.status, "proposed")))
      .returning({ id: shortlist.id });
    if (!updated.length) continue;
    await db.update(outreach).set({ gmailOk: true }).where(and(eq(outreach.userId, userId), eq(outreach.radarItemId, row.radarItemId)));
    approved++;
  }
  const skipIds = proposed.filter((r) => !wanted.has(r.radarItemId)).map((r) => r.id);
  const skipped = skipIds.length
    ? (await db
        .update(shortlist)
        .set({ status: "skipped" })
        .where(and(inArray(shortlist.id, skipIds), eq(shortlist.status, "proposed")))
        .returning({ id: shortlist.id })).length
    : 0;
  return { approved, skipped };
}
