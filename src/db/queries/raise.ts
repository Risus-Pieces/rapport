import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, deals, outreach, outreachMessages as messages, radarItems, shortlist } from "@/db/schema";
import { crmHref, type RadarDetails } from "@/lib/radar/types";
import { DEFAULT_RAISE, isStale, parseRaiseForm, type RaiseSettings } from "@/lib/raise";
import { approveRadarItem } from "./radar";

export { refreshGhosted } from "./relationships";

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

// --- Raise goal, monthly facts, advice calls and progress --------------------------------------------

const RAISE_KEYS = { target: "raise.target", launchDate: "raise.launch_date", phase: "raise.phase" } as const;
const MONTH_KEYS = ["progress", "ask", "next"] as const;
export type MonthFacts = { progress: string; ask: string; next: string; updatedAt: Date | null };

async function readSettings(userId: string, keys: string[]) {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value, updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), inArray(appSettings.key, keys)));
  return new Map(rows.map((r) => [r.key, r]));
}

async function writeSetting(userId: string, key: string, value: string) {
  await db
    .insert(appSettings)
    .values({ userId, key, value })
    .onConflictDoUpdate({ target: [appSettings.userId, appSettings.key], set: { value, updatedAt: new Date() } });
}

export async function getRaise(userId: string): Promise<RaiseSettings> {
  const m = await readSettings(userId, Object.values(RAISE_KEYS));
  return parseRaiseForm(
    { target: m.get(RAISE_KEYS.target)?.value, launchDate: m.get(RAISE_KEYS.launchDate)?.value ?? "", phase: m.get(RAISE_KEYS.phase)?.value },
    DEFAULT_RAISE,
  );
}

export async function saveRaise(userId: string, r: RaiseSettings): Promise<void> {
  await writeSetting(userId, RAISE_KEYS.target, String(r.target));
  await writeSetting(userId, RAISE_KEYS.launchDate, r.launchDate ?? "");
  await writeSetting(userId, RAISE_KEYS.phase, r.phase);
}

export async function getMonthFacts(userId: string): Promise<MonthFacts> {
  const m = await readSettings(userId, MONTH_KEYS.map((k) => `month.${k}`));
  const at = [...m.values()].map((r) => r.updatedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    progress: m.get("month.progress")?.value ?? "",
    ask: m.get("month.ask")?.value ?? "",
    next: m.get("month.next")?.value ?? "",
    updatedAt: at,
  };
}

/** Only changed facts are rewritten, so "changed since the last update" stays meaningful. */
export async function saveMonthFacts(userId: string, f: { progress: string; ask: string; next: string }): Promise<void> {
  const current = await getMonthFacts(userId);
  for (const k of MONTH_KEYS) {
    const value = f[k].trim().slice(0, 600);
    if (value !== current[k]) await writeSetting(userId, `month.${k}`, value);
  }
}

/** Marks (or clears) Advice call done on an investor deal: that person may now hear about the raise. */
export async function setAdviceCall(userId: string, dealId: string, done: boolean): Promise<boolean> {
  const rows = await db
    .update(deals)
    .set({ details: done ? sql`${deals.details} || jsonb_build_object('adviceCallAt', current_date::text)` : sql`${deals.details} - 'adviceCallAt'` })
    .where(and(eq(deals.userId, userId), eq(deals.id, dealId), eq(deals.section, "investors")))
    .returning({ id: deals.id });
  return rows.length > 0;
}

export type RaiseProgress = { target: number; committed: number; softCircled: number; ready: number };

/** Committed = won investor deals; soft-circled = open ones at Follow-up or Term sheet with an amount (dollars). */
export async function raiseProgress(userId: string): Promise<RaiseProgress> {
  const [{ target }, { rows }] = await Promise.all([
    getRaise(userId),
    db.$client.query<{ committed: string | null; soft: string | null; ready: number }>(
      `select sum(amount_cents) filter (where status = 'won') as committed,
              sum(amount_cents) filter (where status = 'open' and stage in ('follow_up', 'term_sheet')) as soft,
              count(*) filter (where status = 'open' and details ? 'adviceCallAt')::int as ready
         from deals where user_id = $1 and section = 'investors'`,
      [userId],
    ),
  ]);
  const r = rows[0];
  return { target, committed: Number(r?.committed ?? 0) / 100, softCircled: Number(r?.soft ?? 0) / 100, ready: r?.ready ?? 0 };
}

// --- This week ---------------------------------------------------------------------------------------

export type WeekSummary = {
  week: string;
  shortlist: ShortlistRow[];
  inGmail: { key: string; name: string; kind: string; subject: string | null; href: string | null }[];
  queuedForGmail: number;
  followupsDue: { name: string; due: string; href: string | null; inGmailSoon: boolean }[];
  applications: { id: string; title: string; deadline: string; url: string | null; feed: string; kind: string }[];
  replies: { name: string; summary: string; at: Date; href: string | null }[];
  nudges: { tractionStale: boolean; monthFactsStale: boolean };
};

/** soozOnly: deadlines from the Sooz feed only (what a workspace member sees; Personal/Career are the owner's). */
export async function weekSummary(userId: string, now: Date = new Date(), options: { soozOnly?: boolean } = {}): Promise<WeekSummary> {
  const week = await currentWeek();
  const [list, gmail, watch, due, apps, replies, traction, update] = await Promise.all([
    listShortlist(userId, week),
    db.$client.query<{ t: { messages: unknown[] } }>(`select rr_gmail_todo($1) as t`, [userId]),
    db.$client.query<{ name: string; kind: string; subject: string | null; key: string; item_kind: string; contact_id: string | null; deal_id: string | null }>(
      `select i.title as name, x.kind, x.subject, x.outreach_id || ':' || x.kind || ':' || x.period as key,
              i.kind as item_kind, i.contact_id, i.deal_id
         from outreach_messages x join outreach o on o.id = x.outreach_id join radar_items i on i.id = o.radar_item_id
        where x.user_id = $1 and x.status = 'in_gmail' order by x.pushed_at`,
      [userId],
    ),
    db.$client.query<{ name: string; due: string; item_kind: string; contact_id: string | null; deal_id: string | null; gmail_ok: boolean }>(
      `select i.title as name, o.next_followup_at::text as due, i.kind as item_kind, i.contact_id, i.deal_id, o.gmail_ok
         from outreach o join radar_items i on i.id = o.radar_item_id
        where o.user_id = $1 and o.stage = 'sent' and o.touches < 3 and o.next_followup_at <= current_date
          and rr_relationship(i) = 'known'
        order by o.next_followup_at`,
      [userId],
    ),
    db.$client.query<{ id: string; title: string; deadline: string; url: string | null; feed: string; kind: string }>(
      `select id, title, deadline::text as deadline, url, feed, kind from radar_items
        where user_id = $1 and deadline between current_date and current_date + 30
          and status in ('new', 'seen', 'saved') and not rr_is_person(kind) and (not $2 or feed = 'sooz')
        order by deadline, score desc`,
      [userId, Boolean(options.soozOnly)],
    ),
    db.$client.query<{ name: string; summary: string; at: Date; contact_id: string | null; deal_id: string | null; section: string | null }>(
      `select c.name, a.summary, a.occurred_at as at, a.contact_id, a.deal_id, c.section::text as section
         from activities a join contacts c on c.id = a.contact_id
        where a.user_id = $1 and a.type = 'email' and a.summary like 'Replied%' and a.occurred_at > now() - interval '14 days'
        order by a.occurred_at desc limit 20`,
      [userId],
    ),
    readSettings(userId, ["pitch.traction"]),
    db.$client.query<{ t: { reason: string } }>(`select rr_update_todo(current_date, $1) as t`, [userId]),
  ]);
  const href = (kind: string, contactId: string | null, dealId: string | null) => crmHref({ kind, contactId, dealId });
  const tr = traction.get("pitch.traction");
  const { phase } = await getRaise(userId);
  return {
    week,
    shortlist: list,
    inGmail: watch.rows.map((r) => ({ key: r.key, name: r.name, kind: r.kind, subject: r.subject, href: href(r.item_kind, r.contact_id, r.deal_id) })),
    queuedForGmail: gmail.rows[0]?.t.messages.length ?? 0,
    followupsDue: due.rows.map((r) => ({ name: r.name, due: r.due, href: href(r.item_kind, r.contact_id, r.deal_id), inGmailSoon: r.gmail_ok })),
    applications: apps.rows,
    replies: replies.rows.map((r) => ({
      name: r.name,
      summary: r.summary,
      at: r.at,
      href: r.deal_id && r.section && r.section !== "general" ? `/${r.section}/${r.deal_id}` : r.contact_id ? `/general/${r.contact_id}` : null,
    })),
    nudges: {
      tractionStale: !tr?.value.trim() || isStale(tr.updatedAt, now),
      monthFactsStale: phase === "building" && ["no facts", "facts not updated"].includes(update.rows[0]?.t.reason ?? ""),
    },
  };
}

/** Allow one person's drafts into Gmail Drafts (only for people in the CRM). */
export async function setGmailOk(userId: string, itemId: string): Promise<boolean> {
  const { rows } = await db.$client.query(
    `update outreach o set gmail_ok = true, updated_at = now()
       from radar_items i
      where i.id = o.radar_item_id and o.user_id = $1 and o.radar_item_id = $2 and rr_is_approved(i)
      returning o.id`,
    [userId, itemId],
  );
  return rows.length > 0;
}

/** Try again (only from Ghosted): back to To reach out with a fresh outreach row and a circling-back note next time. */
export async function tryAgain(userId: string, itemId: string): Promise<boolean> {
  const { rows } = await db.$client.query<{ ok: boolean }>(`select rr_try_again($1, $2) as ok`, [itemId, userId]);
  return rows[0].ok;
}

export type OutreachMessage = { kind: string; period: string; status: string; subject: string | null; pushedAt: Date | null; sentAt: Date | null };

export async function outreachMessages(userId: string, outreachId: string): Promise<OutreachMessage[]> {
  return db
    .select({
      kind: messages.kind,
      period: messages.period,
      status: messages.status,
      subject: messages.subject,
      pushedAt: messages.pushedAt,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.outreachId, outreachId)))
    .orderBy(asc(messages.createdAt));
}
