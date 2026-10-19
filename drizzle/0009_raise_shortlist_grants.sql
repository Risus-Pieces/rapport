-- Routine access to the shortlist functions (re-runnable; does nothing on a branch without radar_routine).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'radar_routine') then
    grant execute on function rr_outreach_queue(text), rr_shortlist_candidates(text), rr_shortlist_set(jsonb, text)
    to radar_routine;
  end if;
end $$;
