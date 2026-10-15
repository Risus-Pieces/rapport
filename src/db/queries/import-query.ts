import { db } from "@/db";

/**
 * One-time move from Query's database (the retired opportunity radar) into Rapport's Radar tables.
 * Idempotent: findings, network rows and settings are keyed; runs are matched on task and start time.
 * Nothing is approved: triage (new/seen/saved/dismissed, notes) carries over and the owner approves
 * people one at a time. Outreach rows come over only when they hold enrichment or drafts.
 */

export type QuerySource = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type ImportCounts = { items: number; runs: number; settings: number; network: number; outreach: number };

export async function importFromQuery(src: QuerySource, userId: string): Promise<ImportCounts> {
  const [blocked] = (
    await src.query(
      `select (select count(*) from items where status = 'contacted')::int as contacted,
              (select count(*) from outreach where stage not in ('prospect', 'drafted'))::int as sent`,
    )
  ).rows as { contacted: number; sent: number }[];
  if (blocked.contacted > 0 || blocked.sent > 0) {
    throw new Error(`Query has people already contacted (${blocked.contacted} items, ${blocked.sent} outreach threads); move them by hand.`);
  }

  const items = (await src.query(`select * from items order by id`)).rows;
  const runs = (await src.query(`select * from runs order by id`)).rows;
  const settings = (await src.query(`select key, value from settings where key like 'pitch.%'`)).rows;
  const network = (await src.query(`select * from network order by id`)).rows;
  const outreach = (
    await src.query(
      `select o.*, i.dedupe_key from outreach o join items i on i.id = o.item_id
        where coalesce(o.email, o.linkedin_url, o.warm_path, o.subject, o.body) is not null`,
    )
  ).rows;

  const client = await db.$client.connect();
  const counts: ImportCounts = { items: 0, runs: 0, settings: 0, network: 0, outreach: 0 };
  try {
    await client.query("begin");
    for (const i of items) {
      const status = ["new", "seen", "saved", "dismissed"].includes(String(i.status)) ? i.status : "seen";
      const r = await client.query(
        `insert into radar_items (user_id, feed, kind, title, url, source, summary, why_relevant, score, tags, details, event_date,
                                  deadline, location, dedupe_key, status, notes, task_id, first_seen, last_seen, digested_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (user_id, dedupe_key) do nothing`,
        [userId, i.section, i.kind, i.title, i.url, i.source, i.summary ?? "", i.why_relevant ?? "", i.score, i.tags ?? [],
         JSON.stringify(i.details ?? {}), i.event_date, i.deadline, i.location, i.dedupe_key, status, i.notes ?? "", i.task_id,
         i.first_seen, i.last_seen, i.digested_at],
      );
      counts.items += r.rowCount ?? 0;
    }
    for (const run of runs) {
      const r = await client.query(
        `insert into radar_runs (user_id, task_id, feed, started_at, finished_at, found, inserted, error)
         select $1,$2,$3,$4,$5,$6,$7,$8
          where not exists (select 1 from radar_runs where user_id = $1 and task_id = $2 and started_at = $4)`,
        [userId, run.task_id, run.section, run.started_at, run.finished_at, run.found, run.inserted, run.error],
      );
      counts.runs += r.rowCount ?? 0;
    }
    for (const st of settings) {
      const r = await client.query(
        `insert into app_settings (user_id, key, value) values ($1,$2,$3) on conflict (user_id, key) do nothing`,
        [userId, st.key, st.value ?? ""],
      );
      counts.settings += r.rowCount ?? 0;
    }
    for (const n of network) {
      const r = await client.query(
        `insert into network (user_id, full_name, company, position, linkedin_url, email, connected_on, source, company_key, dedupe_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (user_id, dedupe_key) do nothing`,
        [userId, n.full_name, n.company, n.position, n.linkedin_url, n.email, n.connected_on, n.source ?? "linkedin", n.company_key, n.dedupe_key],
      );
      counts.network += r.rowCount ?? 0;
    }
    for (const o of outreach) {
      const r = await client.query(
        `insert into outreach (user_id, radar_item_id, purpose, stage, email, email_source, linkedin_url, warm_path, subject, body,
                               linkedin_note, intro_request, followup_1, followup_2, drafted_by, drafted_at)
         select $1, i.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
           from radar_items i where i.user_id = $1 and i.dedupe_key = $2
         on conflict (radar_item_id) do nothing`,
        [userId, o.dedupe_key, o.purpose ?? "invest", o.stage, o.email, o.email_source, o.linkedin_url, o.warm_path, o.subject, o.body,
         o.linkedin_note, o.intro_request, o.followup_1, o.followup_2, o.drafted_by, o.drafted_at],
      );
      counts.outreach += r.rowCount ?? 0;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return counts;
}
