import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activities, appSettings, companies, contacts, deals, network, outreach, radarItems, radarRuns } from "@/db/schema";
import { dedupeKey, firstFirm, slug } from "@/lib/radar/dedupe";
import { PITCH_FIELDS, type Pitch, type PitchKey } from "@/lib/radar/drafts";
import { EMAIL_RE, LINKEDIN_RE, companyKey, parseProspectCsv, type Connection } from "@/lib/radar/import";
import {
  FEEDS,
  PERSON_KINDS,
  crmTargetFor,
  defaultPurpose,
  isPurpose,
  type CrmTarget,
  type Feed,
  type RadarDetails,
} from "@/lib/radar/types";
import { checkInvestorParties, compactDetails, firstStage } from "@/lib/sections";
import { nextSortKey, type Tx } from "./deals";
import { escapeLike } from "./util";

// Every function takes the owner's userId and adds it to every query: there is no database RLS.

export class RadarError extends Error {}

export type Approval = {
  section: CrmTarget;
  contactId: string;
  companyId: string | null;
  dealId: string | null;
  href: string;
};

function approval(section: CrmTarget, contactId: string, companyId: string | null, dealId: string | null): Approval {
  const href = section === "general" || !dealId ? `/general/${contactId}` : `/${section}/${dealId}`;
  return { section, contactId, companyId, dealId, href };
}

const sameName = (column: typeof contacts.name | typeof companies.name, name: string) =>
  sql`lower(${column}) = lower(${name})`;

async function findContact(tx: Tx, userId: string, section: CrmTarget, name: string) {
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.section, section), isNull(contacts.archivedAt), sameName(contacts.name, name)))
    .limit(1);
  return row?.id ?? null;
}

async function openDeal(tx: Tx, userId: string, where: { contactId?: string; companyId?: string }) {
  const [row] = await tx
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        eq(deals.userId, userId),
        eq(deals.status, "open"),
        where.contactId ? eq(deals.contactId, where.contactId) : undefined,
        where.companyId ? eq(deals.companyId, where.companyId) : undefined,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Approve one finding: the person lands in the CRM section their kind belongs to (angels and
 * next-gen investors → Investors angel deal; buyers → Restaurants company, contact and Lead deal;
 * celebrities, creators and press → General contact). Idempotent under a row lock, and a same-name
 * contact (or a buyer's existing company and open deal) is reused rather than duplicated.
 */
export async function approveRadarItem(userId: string, itemId: string): Promise<Approval> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(radarItems)
      .where(and(eq(radarItems.userId, userId), eq(radarItems.id, itemId)))
      .for("update");
    if (!item) throw new RadarError("That finding no longer exists.");
    const section = item.feed === "sooz" ? crmTargetFor(item.kind) : null;
    if (!section) throw new RadarError("Only people can be added to the CRM.");
    if (item.status === "approved" && item.contactId) {
      return approval(section, item.contactId, item.companyId, item.dealId);
    }

    const d = item.details as RadarDetails;
    const firm = firstFirm(d.firm);
    const [draft] = await tx
      .select({ email: outreach.email, linkedinUrl: outreach.linkedinUrl })
      .from(outreach)
      .where(eq(outreach.radarItemId, item.id));
    const radar = compactDetails({
      radarItemId: item.id,
      kind: item.kind,
      sourceUrl: item.url,
      whyRelevant: item.whyRelevant,
      contactPath: d.contact_path,
      riceConnection: d.rice_connection,
      checkSize: d.check_size,
      firm: d.firm,
    });
    const person = {
      userId,
      section,
      name: item.title,
      email: draft?.email ?? null,
      linkedinUrl: draft?.linkedinUrl ?? null,
      tags: item.tags.slice(0, 20),
    };

    let companyId: string | null = null;
    let contactId = await findContact(tx, userId, section, item.title);
    let dealId: string | null = null;

    if (section === "restaurants") {
      const companyName = firm ?? item.title;
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            eq(companies.userId, userId),
            eq(companies.section, "restaurants"),
            isNull(companies.archivedAt),
            sameName(companies.name, companyName),
          ),
        )
        .limit(1);
      companyId =
        company?.id ??
        (await tx.insert(companies).values({ userId, section, name: companyName }).returning({ id: companies.id }))[0].id;
      contactId ??= (
        await tx
          .insert(contacts)
          .values({ ...person, companyId, title: d.role ?? null, details: { radar } })
          .returning({ id: contacts.id })
      )[0].id;
      dealId = await openDeal(tx, userId, { companyId });
      if (!dealId) {
        const stage = firstStage("restaurants").key;
        dealId = (
          await tx
            .insert(deals)
            .values({ userId, section, companyId, title: companyName, stage, sortKey: await nextSortKey(tx, userId, "restaurants", stage) })
            .returning({ id: deals.id })
        )[0].id;
      }
    } else {
      const title = [d.role, d.firm].filter(Boolean).join(" · ") || null;
      contactId ??= (
        await tx
          .insert(contacts)
          .values({
            ...person,
            title,
            priority: section === "general" ? "high" : null,
            details: section === "investors" ? { background: item.summary, radar } : { radar },
          })
          .returning({ id: contacts.id })
      )[0].id;
      if (section === "investors") {
        const problem = checkInvestorParties("angel", { companyId: null, contactId });
        if (problem) throw new RadarError(problem);
        dealId = await openDeal(tx, userId, { contactId });
        if (!dealId) {
          const stage = firstStage("investors").key;
          dealId = (
            await tx
              .insert(deals)
              .values({
                userId,
                section,
                contactId,
                title: item.title,
                stage,
                details: { investorType: "angel" },
                sortKey: await nextSortKey(tx, userId, "investors", stage),
              })
              .returning({ id: deals.id })
          )[0].id;
        }
      }
    }

    await tx.insert(activities).values({
      userId,
      type: "note",
      summary: "Added from Radar",
      body: [item.summary, item.url ? `Source: ${item.url}` : null].filter(Boolean).join("\n\n") || null,
      contactId,
      companyId,
      dealId,
    });
    await tx
      .update(radarItems)
      .set({ status: "approved", contactId, companyId, dealId })
      .where(eq(radarItems.id, item.id));
    // Every approved person gets an outreach row, so the record page shows the outreach panel at once.
    await tx
      .insert(outreach)
      .values({ userId, radarItemId: item.id, purpose: defaultPurpose(item.kind) })
      .onConflictDoNothing({ target: outreach.radarItemId });
    await tx.update(outreach).set({ contactId, dealId }).where(eq(outreach.radarItemId, item.id));
    return approval(section, contactId, companyId, dealId);
  });
}

// --- Listing ---------------------------------------------------------------------------------

export const RADAR_VIEWS = ["inbox", "saved", "approved", "dismissed"] as const;
export type RadarView = (typeof RADAR_VIEWS)[number];
const VIEW_STATUSES: Record<RadarView, string[]> = {
  inbox: ["new", "seen"],
  saved: ["saved"],
  approved: ["approved"],
  dismissed: ["dismissed"],
};

export const RADAR_SORTS = ["score", "date", "newest"] as const;
export type RadarSort = (typeof RADAR_SORTS)[number];

/** people: true = person kinds only, false = everything but people, undefined = all. */
export type RadarFilters = { feed: Feed; view: RadarView; kind?: string; q?: string; rice?: boolean; sort: RadarSort; people?: boolean };

export type RadarRow = typeof radarItems.$inferSelect & {
  outreachStage: string | null;
  hasDraft: boolean;
  draft: { subject: string | null; body: string } | null;
};

const peopleFilter = (people: boolean | undefined) =>
  people === undefined
    ? undefined
    : people
      ? inArray(radarItems.kind, [...PERSON_KINDS])
      : sql`${radarItems.kind} not in (${sql.join(PERSON_KINDS.map((k) => sql`${k}`), sql`, `)})`;

// Past events are noise in the inbox; they stay visible once the owner has acted on them.
const notPast = sql`(coalesce(${radarItems.eventDate}, ${radarItems.deadline}) is null or coalesce(${radarItems.eventDate}, ${radarItems.deadline}) >= current_date)`;

export async function listRadar(userId: string, f: RadarFilters): Promise<RadarRow[]> {
  const q = f.q?.trim().slice(0, 100);
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const where: (SQL | undefined)[] = [
    eq(radarItems.userId, userId),
    eq(radarItems.feed, f.feed),
    inArray(radarItems.status, VIEW_STATUSES[f.view]),
    f.kind ? eq(radarItems.kind, f.kind) : undefined,
    peopleFilter(f.people),
    f.rice ? sql`'rice' = any(${radarItems.tags})` : undefined,
    f.view === "inbox" ? notPast : undefined,
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
      ? [sql`coalesce(${radarItems.eventDate}, ${radarItems.deadline}) asc nulls last`, desc(radarItems.score)]
      : f.sort === "newest"
        ? [desc(radarItems.firstSeen), desc(radarItems.score)]
        : [desc(radarItems.score), desc(radarItems.firstSeen)];
  const rows = await db
    .select({ item: radarItems, outreachStage: outreach.stage, subject: outreach.subject, body: outreach.body })
    .from(radarItems)
    .leftJoin(outreach, eq(outreach.radarItemId, radarItems.id))
    .where(and(...where))
    .orderBy(...order)
    .limit(300);
  return rows.map((r) => ({
    ...r.item,
    outreachStage: r.outreachStage,
    hasDraft: r.body !== null,
    draft: r.body !== null ? { subject: r.subject, body: r.body } : null,
  }));
}

export async function radarCounts(userId: string, feed: Feed, people?: boolean): Promise<Record<RadarView, number>> {
  const rows = await db
    .select({ status: radarItems.status, n: count() })
    .from(radarItems)
    .where(
      and(
        eq(radarItems.userId, userId),
        eq(radarItems.feed, feed),
        peopleFilter(people),
        or(sql`${radarItems.status} not in ('new', 'seen')`, notPast),
      ),
    )
    .groupBy(radarItems.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return {
    inbox: (by.new ?? 0) + (by.seen ?? 0),
    saved: by.saved ?? 0,
    approved: by.approved ?? 0,
    dismissed: by.dismissed ?? 0,
  };
}

export async function radarNewCounts(userId: string): Promise<Record<Feed, number>> {
  const rows = await db
    .select({ feed: radarItems.feed, n: count() })
    .from(radarItems)
    .where(and(eq(radarItems.userId, userId), eq(radarItems.status, "new")))
    .groupBy(radarItems.feed);
  const out = Object.fromEntries(FEEDS.map((f) => [f, 0])) as Record<Feed, number>;
  for (const r of rows) if (r.feed in out) out[r.feed as Feed] = r.n;
  return out;
}

export async function radarKindCounts(userId: string, feed: Feed, view: RadarView, people?: boolean): Promise<{ kind: string; n: number }[]> {
  return db
    .select({ kind: radarItems.kind, n: count() })
    .from(radarItems)
    .where(
      and(
        eq(radarItems.userId, userId),
        eq(radarItems.feed, feed),
        inArray(radarItems.status, VIEW_STATUSES[view]),
        peopleFilter(people),
        view === "inbox" ? notPast : undefined,
      ),
    )
    .groupBy(radarItems.kind)
    .orderBy(desc(count()));
}

/** New people in the Sooz feed (the badge on the "People" tab). */
export async function radarPeopleNewCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(radarItems)
    .where(and(eq(radarItems.userId, userId), eq(radarItems.feed, "sooz"), eq(radarItems.status, "new"), peopleFilter(true)));
  return row?.n ?? 0;
}

/** Drafts ready to send (approved people) and drafts waiting for the owner's approval. */
export async function outreachDraftCounts(userId: string): Promise<{ ready: number; waiting: number }> {
  const { rows } = await db.$client.query<{ ready: number; waiting: number }>(
    `select count(*) filter (where rr_is_approved(i))::int as ready,
            count(*) filter (where not rr_is_approved(i) and i.status <> 'dismissed')::int as waiting
       from outreach o join radar_items i on i.id = o.radar_item_id
      where o.user_id = $1 and o.stage = 'drafted'`,
    [userId],
  );
  return rows[0] ?? { ready: 0, waiting: 0 };
}

export async function recentRadarRuns(userId: string, limit = 8) {
  return db.select().from(radarRuns).where(eq(radarRuns.userId, userId)).orderBy(desc(radarRuns.startedAt)).limit(limit);
}

/** Triage. Never changes an approved finding (approval is undone only by deleting the CRM record). */
export async function setRadarStatus(userId: string, id: string, status: "seen" | "saved" | "dismissed"): Promise<boolean> {
  const rows = await db
    .update(radarItems)
    .set({ status })
    .where(and(eq(radarItems.userId, userId), eq(radarItems.id, id), sql`(${radarItems.status} <> 'approved' or ${radarItems.contactId} is null)`))
    .returning({ id: radarItems.id });
  return rows.length > 0;
}

export async function setRadarNotes(userId: string, id: string, notes: string): Promise<void> {
  await db.update(radarItems).set({ notes: notes.slice(0, 4000) }).where(and(eq(radarItems.userId, userId), eq(radarItems.id, id)));
}

export async function markFeedSeen(userId: string, feed: Feed): Promise<void> {
  await db
    .update(radarItems)
    .set({ status: "seen" })
    .where(and(eq(radarItems.userId, userId), eq(radarItems.feed, feed), eq(radarItems.status, "new")));
}

// --- Pitch facts and network -----------------------------------------------------------------

export async function getPitch(userId: string): Promise<Pitch> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), sql`${appSettings.key} like 'pitch.%'`));
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Pitch;
}

export async function savePitch(userId: string, values: Pitch): Promise<void> {
  for (const f of PITCH_FIELDS) {
    const value = (values[f.key as PitchKey] ?? "").toString().trim().slice(0, 1000);
    await db
      .insert(appSettings)
      .values({ userId, key: f.key, value })
      .onConflictDoUpdate({ target: [appSettings.userId, appSettings.key], set: { value, updatedAt: new Date() } });
  }
}

export async function importConnections(userId: string, conns: Connection[]): Promise<number> {
  let n = 0;
  for (const c of conns) {
    const key = c.linkedin_url
      ? `li:${c.linkedin_url.toLowerCase().replace(/\/+$/, "")}`
      : `name:${slug(c.full_name)}:${slug(c.company ?? "")}`;
    await db
      .insert(network)
      .values({
        userId,
        fullName: c.full_name,
        company: c.company,
        position: c.position,
        linkedinUrl: c.linkedin_url,
        email: c.email,
        connectedOn: c.connected_on,
        companyKey: companyKey(c.company),
        dedupeKey: key,
      })
      .onConflictDoUpdate({
        target: [network.userId, network.dedupeKey],
        set: { company: c.company, position: c.position, email: sql`coalesce(excluded.email, ${network.email})`, companyKey: companyKey(c.company) },
      });
    n++;
  }
  return n;
}

export async function networkSize(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(network).where(eq(network.userId, userId));
  return row?.n ?? 0;
}

export type WarmMatch = {
  item_id: string;
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  kind: "same_person" | "same_company";
};

/** Who the owner already knows: the person themself (1st-degree) or someone at one of their firms. */
export async function warmMatches(userId: string, itemIds: string[]): Promise<Map<string, WarmMatch[]>> {
  const map = new Map<string, WarmMatch[]>();
  if (!itemIds.length) return map;
  const { rows } = await db.$client.query<WarmMatch>(
    `select i.id as item_id, n.full_name, n.company, n.position, n.linkedin_url,
            case when lower(n.full_name) = lower(i.title) then 'same_person' else 'same_company' end as kind
       from radar_items i
       join network n on n.user_id = i.user_id
                     and (lower(n.full_name) = lower(i.title) or n.company_key = any (rr_firm_keys(i.details->>'firm')))
      where i.user_id = $1 and i.id = any($2::uuid[])
      order by kind desc, n.full_name
      limit 500`,
    [userId, itemIds],
  );
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    if (list.length < 5) list.push(r);
    map.set(r.item_id, list);
  }
  return map;
}

// --- People CSV import -----------------------------------------------------------------------

export type RadarImportResult = { received: number; valid: number; inserted: number; updated: number; rejected: { title: string; reason: string }[] };

/** Adds people from a CSV to the Sooz feed through the same validation as research (rr_ingest). */
export async function importPeopleToRadar(userId: string, text: string): Promise<RadarImportResult> {
  const { rows, extras } = parseProspectCsv(text);
  const { rows: res } = await db.$client.query<{ r: RadarImportResult }>(
    `select rr_ingest('sooz', 'import', $1::text[], false, $2::jsonb, $3) as r`,
    [[...PERSON_KINDS], JSON.stringify(rows), userId],
  );
  const result = res[0].r;
  for (let k = 0; k < rows.length; k++) {
    const extra = extras[k];
    const email = extra.email && EMAIL_RE.test(extra.email) ? extra.email.toLowerCase() : null;
    const li = extra.linkedin_url && LINKEDIN_RE.test(extra.linkedin_url) ? extra.linkedin_url : null;
    if (!email && !li && !extra.purpose) continue;
    const row = rows[k];
    const key = dedupeKey({ feed: "sooz", kind: row.kind.trim().toLowerCase(), title: row.title.trim().slice(0, 160), url: row.url, firm: row.details.firm?.trim().slice(0, 200) ?? null });
    const [item] = await db
      .select({ id: radarItems.id, kind: radarItems.kind })
      .from(radarItems)
      .where(and(eq(radarItems.userId, userId), eq(radarItems.dedupeKey, key)));
    if (!item) continue;
    await db
      .insert(outreach)
      .values({ userId, radarItemId: item.id, purpose: extra.purpose ?? defaultPurpose(item.kind) })
      .onConflictDoNothing({ target: outreach.radarItemId });
    await db
      .update(outreach)
      .set({
        purpose: extra.purpose ?? sql`${outreach.purpose}`,
        email: sql`coalesce(${outreach.email}, ${email})`,
        emailSource: sql`case when ${outreach.email} is null and ${email}::text is not null then 'import' else ${outreach.emailSource} end`,
        linkedinUrl: sql`coalesce(${outreach.linkedinUrl}, ${li})`,
      })
      .where(eq(outreach.radarItemId, item.id));
  }
  return result;
}

// --- Outreach on a CRM record ------------------------------------------------------------------

export type OutreachRow = typeof outreach.$inferSelect & {
  name: string;
  kind: string;
  url: string | null;
  details: RadarDetails;
  whyRelevant: string;
};

const outreachSelect = {
  o: outreach,
  name: radarItems.title,
  kind: radarItems.kind,
  url: radarItems.url,
  details: radarItems.details,
  whyRelevant: radarItems.whyRelevant,
};
const toOutreachRow = (r: { o: typeof outreach.$inferSelect; name: string; kind: string; url: string | null; details: Record<string, unknown>; whyRelevant: string }): OutreachRow => ({
  ...r.o,
  name: r.name,
  kind: r.kind,
  url: r.url,
  details: r.details as RadarDetails,
  whyRelevant: r.whyRelevant,
});

export async function getOutreachForItem(userId: string, itemId: string): Promise<OutreachRow | null> {
  const [row] = await db
    .select(outreachSelect)
    .from(outreach)
    .innerJoin(radarItems, eq(radarItems.id, outreach.radarItemId))
    .where(and(eq(outreach.userId, userId), eq(outreach.radarItemId, itemId)));
  return row ? toOutreachRow(row) : null;
}

/** The outreach thread attached to a deal (or a General contact), most recently touched first. */
export async function getOutreachFor(userId: string, where: { contactId?: string; dealId?: string }): Promise<OutreachRow | null> {
  if (!where.contactId && !where.dealId) return null;
  const [row] = await db
    .select(outreachSelect)
    .from(outreach)
    .innerJoin(radarItems, eq(radarItems.id, outreach.radarItemId))
    .where(
      and(
        eq(outreach.userId, userId),
        where.dealId ? eq(outreach.dealId, where.dealId) : eq(outreach.contactId, where.contactId!),
      ),
    )
    .orderBy(desc(outreach.updatedAt), asc(outreach.id))
    .limit(1);
  return row ? toOutreachRow(row) : null;
}

export type DraftEdit = {
  email?: string;
  linkedin_url?: string;
  warm_path?: string;
  subject?: string;
  body?: string;
  linkedin_note?: string;
  intro_request?: string;
  followup_1?: string;
  followup_2?: string;
};

/** Save a person's edits. Invalid email/LinkedIn values are rejected; drafts freeze once sent. */
export async function saveOutreachEdits(userId: string, itemId: string, e: DraftEdit, draftedBy = "you"): Promise<{ ok: boolean; error?: string }> {
  const current = await getOutreachForItem(userId, itemId);
  if (!current) return { ok: false, error: "That outreach no longer exists." };
  if (current.stage !== "prospect" && current.stage !== "drafted") return { ok: false, error: "Drafts are frozen once sent." };
  const email = e.email?.trim() || null;
  const li = e.linkedin_url?.trim() || null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look valid." };
  if (li && !LINKEDIN_RE.test(li)) return { ok: false, error: "LinkedIn link must look like https://www.linkedin.com/in/name" };
  const clip = (v: string | undefined, n: number) => (v === undefined ? undefined : v.trim().slice(0, n) || null);
  const body = clip(e.body, 3000) ?? null;
  const lowered = email?.toLowerCase() ?? null;
  await db
    .update(outreach)
    .set({
      email: lowered,
      emailSource: lowered !== current.email ? (lowered ? "manual" : null) : current.emailSource,
      linkedinUrl: li,
      warmPath: clip(e.warm_path, 500) ?? null,
      subject: clip(e.subject, 160) ?? null,
      body,
      linkedinNote: clip(e.linkedin_note, 300) ?? null,
      introRequest: clip(e.intro_request, 2000) ?? null,
      followup1: clip(e.followup_1, 1500) ?? null,
      followup2: clip(e.followup_2, 1500) ?? null,
      stage: current.stage === "prospect" && body ? "drafted" : current.stage,
      draftedBy: current.draftedBy ?? (body ? draftedBy : null),
      draftedAt: current.draftedAt ?? (body ? new Date() : null),
    })
    .where(eq(outreach.id, current.id));
  if (current.contactId && (lowered || li)) {
    await db
      .update(contacts)
      .set({ email: sql`coalesce(${contacts.email}, ${lowered})`, linkedinUrl: sql`coalesce(${contacts.linkedinUrl}, ${li})` })
      .where(and(eq(contacts.userId, userId), eq(contacts.id, current.contactId)));
  }
  return { ok: true };
}

export async function setOutreachPurpose(userId: string, itemId: string, purpose: string): Promise<boolean> {
  if (!isPurpose(purpose)) return false;
  const rows = await db
    .update(outreach)
    .set({ purpose })
    .where(and(eq(outreach.userId, userId), eq(outreach.radarItemId, itemId)))
    .returning({ id: outreach.id });
  return rows.length > 0;
}

export type OutreachEvent = "sent" | "followup" | "replied" | "closed";

/** Runs the shared outreach effect (activity, follow-up task, first stage move) in SQL. */
export async function recordOutreach(userId: string, itemId: string, event: OutreachEvent): Promise<string> {
  const { rows } = await db.$client.query<{ r: string }>(`select rr_outreach_record($1, $2, now(), $3) as r`, [itemId, event, userId]);
  return rows[0].r;
}
