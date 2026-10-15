-- The weekly routines connect as radar_routine. Create it in SQL (not through the Neon API, whose roles
-- join neon_superuser and can read every table), once per branch, outside this repo:
--   create role radar_routine login password '<random>';
-- It gets EXECUTE on the routine-facing rr_* functions only. They are SECURITY DEFINER, so they reach
-- the tables; the role itself cannot. rr_outreach_record stays app-only (routines use rr_outreach_observe).
-- Safe to re-run; does nothing on a branch without the role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'radar_routine') then
    revoke all on all tables in schema public from radar_routine;
    grant execute on function
      rr_owner(), rr_known_titles(text, text), rr_ingest(text, text, text[], boolean, jsonb, text),
      rr_outreach_queue(int, text), rr_outreach_todo(int, text), rr_outreach_save(uuid, jsonb, text),
      rr_outreach_watch(text), rr_outreach_observe(uuid, text, timestamptz, text),
      rr_digest_email(int, text, text), rr_mark_digested(uuid[], text)
    to radar_routine;
  end if;
end $$;
