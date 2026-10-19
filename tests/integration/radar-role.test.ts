import { beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// The weekly routines connect as radar_routine (created in SQL, so it is not a neon_superuser member).
// It may only EXECUTE the routine-facing rr_* functions; every table, CRM and auth data included, stays closed.
describe.skipIf(!hasDevDb)("radar_routine role (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  const one = async <T>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows[0] as T;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
  });

  const ROUTINE_FUNCTIONS = [
    "rr_owner()",
    "rr_known_titles(text, text)",
    "rr_ingest(text, text, text[], boolean, jsonb, text)",
    "rr_outreach_queue(text)",
    "rr_outreach_todo(integer, text)",
    "rr_outreach_save(uuid, jsonb, text)",
    "rr_outreach_watch(text)",
    "rr_outreach_observe(uuid, text, timestamp with time zone, text)",
    "rr_digest_email(integer, text, text)",
    "rr_mark_digested(uuid[], text)",
    "rr_shortlist_candidates(text)",
    "rr_shortlist_set(jsonb, text)",
  ];
  const APP_ONLY = ["rr_outreach_record(uuid, text, timestamp with time zone, text)", "rr_sync_crm_investors(text)"];
  const TABLES = ["contacts", "companies", "deals", "activities", "tasks", "user", "session", "account", "verification", "radar_items", "radar_runs", "outreach", "network", "app_settings"];

  it("exists, can log in, and is not a member of any other role", async () => {
    const r = await one<{ login: boolean; member_of: number }>(
      `select rolcanlogin as login, (select count(*)::int from pg_auth_members where member = r.oid) as member_of
         from pg_roles r where rolname = 'radar_routine'`,
    );
    expect(r).toEqual({ login: true, member_of: 0 });
  });

  it.each(TABLES)("cannot read or write %s", async (table) => {
    const r = await one<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('radar_routine', $1, 'select') sel, has_table_privilege('radar_routine', $1, 'insert') ins,
              has_table_privilege('radar_routine', $1, 'update') upd, has_table_privilege('radar_routine', $1, 'delete') del`,
      [`public."${table}"`],
    );
    expect(r).toEqual({ sel: false, ins: false, upd: false, del: false });
  });

  it.each(ROUTINE_FUNCTIONS)("can execute %s", async (fn) => {
    expect((await one<{ ok: boolean }>(`select has_function_privilege('radar_routine', $1, 'execute') ok`, [fn])).ok).toBe(true);
  });

  it.each(APP_ONLY)("cannot execute the app-only %s", async (fn) => {
    expect((await one<{ ok: boolean }>(`select has_function_privilege('radar_routine', $1, 'execute') ok`, [fn])).ok).toBe(false);
  });
});
