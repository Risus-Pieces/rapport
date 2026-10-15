import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// The one-time move from Query's database, run against a temp schema shaped like Query's tables.
describe.skipIf(!hasDevDb)("import from Query (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let m: typeof import("@/db/queries/import-query");
  let client: PoolClient;
  const owner = randomUUID();
  const schema = `qfix_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.$client.query(text, params)).rows as T[];
  // DATABASE_URL goes through Neon's transaction-mode pooler, so session settings would leak onto shared
  // server connections: every fixture statement runs in its own transaction with SET LOCAL instead.
  const inFixture = async (text: string, params?: unknown[]) => {
    await client.query("begin");
    try {
      await client.query(`set local search_path to ${schema}`);
      const result = await client.query(text, params);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  };
  const source = () => ({ query: inFixture });

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    m = await import("@/db/queries/import-query");
    await db.insert(s.user).values({ id: owner, name: "T", email: `import-${owner}@example.test`, emailVerified: true });
    client = await db.$client.connect();
    await client.query(`create schema ${schema}`);
    await inFixture(`
      create table items (id bigserial primary key, section text, kind text, title text, url text, source text, summary text,
        why_relevant text, score int, tags text[], details jsonb, event_date date, deadline date, location text, dedupe_key text unique,
        status text, notes text, task_id text, first_seen timestamptz, last_seen timestamptz, digested_at timestamptz);
      create table runs (id bigserial primary key, task_id text, section text, started_at timestamptz, finished_at timestamptz,
        found int, inserted int, error text);
      create table settings (key text primary key, value text, updated_at timestamptz default now());
      create table network (id bigserial primary key, full_name text, company text, position text, linkedin_url text, email text,
        connected_on date, source text, company_key text, dedupe_key text unique);
      create table outreach (item_id bigint primary key, purpose text, stage text, email text, email_source text, linkedin_url text,
        warm_path text, subject text, body text, linkedin_note text, intro_request text, followup_1 text, followup_2 text,
        drafted_by text, drafted_at timestamptz);
      insert into items (section, kind, title, url, summary, why_relevant, score, tags, details, dedupe_key, status, notes, task_id, first_seen, last_seen, digested_at)
      values ('sooz','angel','Kyle Q','https://a.com/k','s','w',80,'{rice}','{"firm":"Rice Angels"}','angel:kyle-q:rice-angels','dismissed','not now','sooz-angels-rice', '2026-10-08', '2026-10-12', '2026-10-12'),
             ('sooz','angel','Ada Q','https://a.com/a','s','w',85,'{}','{"firm":"Acme"}','angel:ada-q:acme','new','','import', '2026-10-14', '2026-10-14', null),
             ('sooz','resource','TiE Q','https://tie.example','s','w',70,'{}','{}','sooz:url:tie.example','saved','','sooz-resources', '2026-10-08', '2026-10-08', null),
             ('personal','event','Hack Q','https://hack.example','s','w',75,'{}','{}','personal:url:hack.example','new','','personal-ai-startup', '2026-10-14', '2026-10-14', null);
      insert into runs (task_id, section, started_at, finished_at, found, inserted) values ('sooz-angels-rice','sooz','2026-10-12T13:00:00Z','2026-10-12T13:05:00Z',6,6);
      insert into settings (key, value) values ('pitch.company', 'Sooz'), ('other.key', 'x');
      insert into network (full_name, company, company_key, dedupe_key) values ('Sam Lee', 'Acme', 'acme', 'name:sam-lee:acme');
      insert into outreach (item_id, purpose, stage, linkedin_url) select id, 'invest', 'prospect', 'https://www.linkedin.com/in/ada' from items where title = 'Ada Q';
      insert into outreach (item_id, purpose, stage) select id, 'invest', 'prospect' from items where title = 'Kyle Q';
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`drop schema if exists ${schema} cascade`);
      client.release();
    }
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner]));
  });

  it("moves findings with their triage, runs, pitch facts, network and enriched outreach; nothing is approved", async () => {
    const counts = await m.importFromQuery(source(), owner);
    expect(counts).toEqual({ items: 4, runs: 1, settings: 1, network: 1, outreach: 1 });
    const items = await q(`select title, feed, status, notes, dedupe_key, digested_at is not null as digested, contact_id from radar_items where user_id = $1 order by title`, [owner]);
    expect(items).toEqual([
      { title: "Ada Q", feed: "sooz", status: "new", notes: "", dedupe_key: "angel:ada-q:acme", digested: false, contact_id: null },
      { title: "Hack Q", feed: "personal", status: "new", notes: "", dedupe_key: "personal:url:hack.example", digested: false, contact_id: null },
      { title: "Kyle Q", feed: "sooz", status: "dismissed", notes: "not now", dedupe_key: "angel:kyle-q:rice-angels", digested: true, contact_id: null },
      { title: "TiE Q", feed: "sooz", status: "saved", notes: "", dedupe_key: "sooz:url:tie.example", digested: false, contact_id: null },
    ]);
    expect(await q(`select key, value from app_settings where user_id = $1`, [owner])).toEqual([{ key: "pitch.company", value: "Sooz" }]);
    expect(await q(`select i.title, o.linkedin_url, o.stage from outreach o join radar_items i on i.id = o.radar_item_id where o.user_id = $1`, [owner])).toEqual([
      { title: "Ada Q", linkedin_url: "https://www.linkedin.com/in/ada", stage: "prospect" },
    ]);
    expect(await q(`select count(*)::int n from contacts where user_id = $1`, [owner])).toEqual([{ n: 0 }]);
  });

  it("is idempotent", async () => {
    expect(await m.importFromQuery(source(), owner)).toEqual({ items: 0, runs: 0, settings: 0, network: 0, outreach: 0 });
    expect(await q(`select count(*)::int n from radar_items where user_id = $1`, [owner])).toEqual([{ n: 4 }]);
  });

  it("refuses when Query holds outreach that was already sent", async () => {
    await inFixture(`update outreach set stage = 'sent' where linkedin_url is not null`);
    await expect(m.importFromQuery(source(), owner)).rejects.toThrow(/already contacted/);
    await inFixture(`update outreach set stage = 'prospect' where linkedin_url is not null`);
  });
});
