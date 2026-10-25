-- The watchlist and seeds also cover accelerators and retailer emerging-brand programs (tag 'accelerator'): they run on
-- annual cycles like competitions.
create or replace function rr_competition_watch(p_user text default rr_owner()) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with comps as (
    select i.*, rr_series(i.title) as series, coalesce(i.deadline, i.event_date) as last_date
      from radar_items i
     where i.user_id = p_user and i.tags && array['pitch-competition', 'accelerator'] and i.status <> 'dismissed'
  ),
  latest as (
    select distinct on (series) * from comps order by series, last_date desc nulls last, first_seen desc
  )
  select jsonb_build_object(
    'due', coalesce((
      select jsonb_agg(jsonb_build_object(
               'series', l.series, 'title', l.title, 'url', l.url, 'status', l.status, 'tags', l.tags,
               'last_deadline', l.deadline, 'last_event', l.event_date,
               'usual_month', to_char(l.last_date, 'FMMonth'), 'summary', left(l.summary, 300))
             order by (l.last_date is null),
                      -- soonest anniversary of the last cycle first
                      (make_date(extract(year from current_date)::int, extract(month from l.last_date)::int, 1)
                         + case when extract(month from l.last_date) < extract(month from current_date) then interval '1 year' else interval '0' end))
        from (select * from latest where last_date is null or last_date < current_date limit 60) l), '[]'::jsonb),
    'seeds', coalesce((
      select jsonb_agg(jsonb_build_object('title', c.title, 'url', c.url, 'kind', c.kind, 'tags', c.tags, 'summary', left(c.summary, 300),
                                          'why_relevant', c.why_relevant, 'notes', left(c.notes, 300)) order by c.first_seen desc)
        from (select * from comps where status in ('saved', 'applied') or 'added-by-me' = any (tags)
               order by first_seen desc limit 15) c), '[]'::jsonb))
$$;
