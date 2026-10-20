import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, contacts, network, outreach, radarItems, radarRuns } from "@/db/schema";
import { dedupeKey, slug } from "@/lib/radar/dedupe";
import { PITCH_FIELDS, type Pitch, type PitchKey } from "@/lib/radar/drafts";
import { EMAIL_RE, LINKEDIN_RE, companyKey, parseProspectCsv, type Connection } from "@/lib/radar/import";
import {
  PERSON_KINDS,
  defaultPurpose,
  isPurpose,
  type CrmTarget,
  type RadarDetails,
} from "@/lib/radar/types";

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
  if (section !== "general" && !dealId) throw new RadarError("That record has no pipeline card.");
  const href = section === "general" ? `/general/${contactId}` : `/${section}/${dealId}`;
  return { section, contactId, companyId, dealId, href };
}

/**
 * Approve one finding: the person lands in the CRM section their kind belongs to, as To reach out (angels and
 * next-gen investors → Investors angel deal; buyers → Restaurants company, contact and Lead deal; celebrities,
 * creators and press → General contact). The work is rr_approve_item (drizzle/0014), which research ingest uses too.
 */
export async function approveRadarItem(userId: string, itemId: string): Promise<Approval> {
  let r: { section: CrmTarget; contact_id: string; company_id: string | null; deal_id: string | null };
  try {
    const { rows } = await db.$client.query<{ r: typeof r }>(`select rr_approve_item($1, $2) as r`, [itemId, userId]);
    r = rows[0].r;
  } catch (error) {
    const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const pg = e.code ? e : e.cause;
    if (pg?.code === "RR001") throw new RadarError(pg.message ?? "Could not add to the CRM.");
    if (pg?.code === "22P02") throw new RadarError("That finding no longer exists.");
    throw error;
  }
  return approval(r.section, r.contact_id, r.company_id, r.deal_id);
}

// --- Drafts and research runs ---------------------------------------------------------------

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

export async function setRadarNotes(userId: string, id: string, notes: string): Promise<void> {
  await db.update(radarItems).set({ notes: notes.slice(0, 4000) }).where(and(eq(radarItems.userId, userId), eq(radarItems.id, id)));
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

/**
 * Every outreach thread on a deal (several buyers can share one restaurant) or a contact, for people
 * still in the CRM, in the order they were added.
 */
export async function listOutreachFor(userId: string, where: { contactId?: string; dealId?: string }): Promise<OutreachRow[]> {
  if (!where.contactId && !where.dealId) return [];
  const rows = await db
    .select(outreachSelect)
    .from(outreach)
    .innerJoin(radarItems, eq(radarItems.id, outreach.radarItemId))
    .where(
      and(
        eq(outreach.userId, userId),
        where.dealId ? eq(outreach.dealId, where.dealId) : eq(outreach.contactId, where.contactId!),
        eq(radarItems.status, "approved"),
        sql`${radarItems.contactId} is not null`,
      ),
    )
    .orderBy(asc(outreach.createdAt), asc(outreach.id));
  return rows.map(toOutreachRow);
}

export async function getOutreachFor(userId: string, where: { contactId?: string; dealId?: string }): Promise<OutreachRow | null> {
  return (await listOutreachFor(userId, where))[0] ?? null;
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
  const stage = body
    ? current.stage === "prospect" ? "drafted" : current.stage
    : current.stage === "drafted" ? "prospect" : current.stage;
  const updated = await db
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
      stage,
      draftedBy: current.draftedBy ?? (body ? draftedBy : null),
      draftedAt: current.draftedAt ?? (body ? new Date() : null),
    })
    // Guarded again on write: a send detected in Gmail meanwhile must not be undone by this save.
    .where(and(eq(outreach.id, current.id), inArray(outreach.stage, ["prospect", "drafted"])))
    .returning({ id: outreach.id });
  if (updated.length === 0) return { ok: false, error: "Drafts are frozen once sent." };
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
