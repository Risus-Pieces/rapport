-- Competition watchlist for the research routine. Annual competitions open for a few weeks; this lists the ones whose last
-- known cycle is over (or that have no dates) so the research can check whether the next cycle is open, plus the ones the
-- owner saved, applied to or added by hand as seeds for finding similar competitions.

-- A competition's series: its title without years ("Rice Launch Challenge 2027" -> "rice launch challenge").
create or replace function rr_series(p_title text) returns text language sql immutable as $$
  select lower(btrim(regexp_replace(
    regexp_replace(coalesce(p_title, ''), '\m(19|20)\d{2}(\s*[-–/]\s*((19|20)?\d{2}))?\M', ' ', 'g'),
    '[\s()–-]+', ' ', 'g')))
$$;

create or replace function rr_competition_watch(p_user text default rr_owner()) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with comps as (
    select i.*, rr_series(i.title) as series, coalesce(i.deadline, i.event_date) as last_date
      from radar_items i
     where i.user_id = p_user and 'pitch-competition' = any (i.tags) and i.status <> 'dismissed'
  ),
  latest as (
    select distinct on (series) * from comps order by series, last_date desc nulls last, first_seen desc
  )
  select jsonb_build_object(
    'due', coalesce((
      select jsonb_agg(jsonb_build_object(
               'series', l.series, 'title', l.title, 'url', l.url, 'status', l.status,
               'last_deadline', l.deadline, 'last_event', l.event_date,
               'usual_month', to_char(l.last_date, 'FMMonth'), 'summary', left(l.summary, 300))
             order by (l.last_date is null),
                      -- soonest anniversary of the last cycle first
                      (make_date(extract(year from current_date)::int, extract(month from l.last_date)::int, 1)
                         + case when extract(month from l.last_date) < extract(month from current_date) then interval '1 year' else interval '0' end))
        from (select * from latest where last_date is null or last_date < current_date limit 60) l), '[]'::jsonb),
    'seeds', coalesce((
      select jsonb_agg(jsonb_build_object('title', c.title, 'url', c.url, 'kind', c.kind, 'summary', left(c.summary, 300),
                                          'why_relevant', c.why_relevant, 'notes', left(c.notes, 300)) order by c.first_seen desc)
        from (select * from comps where status in ('saved', 'applied') or 'added-by-me' = any (tags)
               order by first_seen desc limit 15) c), '[]'::jsonb))
$$;
revoke all on function rr_competition_watch(text) from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'radar_routine') then
    grant execute on function rr_competition_watch(text) to radar_routine;
  end if;
end $$;
