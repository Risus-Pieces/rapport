-- Raise mode: the weekly shortlist. The Monday routine reads candidates, ranks them, saves at most
-- 4 investors + 2 buyers with a reason and the specific ask, and drafts them; the owner approves the batch in the app.

create or replace function rr_week_start(d date) returns date language sql immutable as $$
  select date_trunc('week', d)::date
$$;

-- Who may be offered this week: a Sooz investor (angel, next-gen) or buyer that is not dismissed, not already on
-- this week's list, not skipped in the last 56 days, and either not in the CRM yet or in the CRM but not yet
-- contacted and not already approved for Gmail.
create or replace function rr_shortlist_eligible(i radar_items, p_week date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select i.feed = 'sooz' and i.kind in ('angel', 'nextgen', 'buyer') and i.status <> 'dismissed'
     and not exists (
       select 1 from shortlist s
        where s.radar_item_id = i.id and (s.week = p_week or (s.status = 'skipped' and s.week > p_week - 56)))
     and not exists (
       select 1 from outreach o
        where o.radar_item_id = i.id and (o.gmail_ok or o.stage not in ('prospect', 'drafted')))
$$;

create or replace function rr_warm_paths(i radar_items) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(w order by w->>'via', w->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('name', n.full_name, 'via', 'LinkedIn connection') as w
      from network n where n.user_id = i.user_id and n.company_key = any (rr_firm_keys(i.details->>'firm'))
    union all
    select jsonb_build_object('name', c.name, 'via', 'your contact')
      from contacts c join companies co on co.id = c.company_id
     where c.user_id = i.user_id and c.section = 'general' and c.archived_at is null
       and rr_company_key(co.name) = any (rr_firm_keys(i.details->>'firm'))
  ) x
$$;

create or replace function rr_shortlist_candidates(p_user text default rr_owner())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_week date := rr_week_start(current_date);
begin
  perform rr_sync_crm_investors(p_user);
  return jsonb_build_object(
    'week', v_week,
    'phase', coalesce((select value from app_settings where user_id = p_user and key = 'raise.phase'), 'building'),
    'raise', jsonb_build_object(
      'target', coalesce((select value from app_settings where user_id = p_user and key = 'raise.target'), '75000'),
      'launch_date', (select nullif(value, '') from app_settings where user_id = p_user and key = 'raise.launch_date')),
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb),
    'investors', coalesce((
      select jsonb_agg(c order by (c->>'score')::int desc) from (
        select jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'kind', i.kind, 'approved', rr_is_approved(i),
                                  'from_crm', i.task_id = 'crm', 'score', i.score, 'summary', i.summary,
                                  'why_relevant', i.why_relevant, 'details', i.details, 'tags', i.tags,
                                  'warm_paths', rr_warm_paths(i)) as c
          from radar_items i
         where i.user_id = p_user and i.kind in ('angel', 'nextgen') and rr_shortlist_eligible(i, v_week)
         order by i.score desc limit 60) x), '[]'::jsonb),
    'buyers', coalesce((
      select jsonb_agg(c order by (c->>'score')::int desc) from (
        select jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'kind', i.kind, 'approved', rr_is_approved(i),
                                  'score', i.score, 'summary', i.summary, 'why_relevant', i.why_relevant,
                                  'details', i.details, 'tags', i.tags, 'warm_paths', rr_warm_paths(i)) as c
          from radar_items i
         where i.user_id = p_user and i.kind = 'buyer' and rr_shortlist_eligible(i, v_week)
         order by i.score desc limit 20) x), '[]'::jsonb));
end $$;

-- Replace this week's proposed rows (approved and skipped rows are the owner's and stay). The bucket comes from
-- the kind, not the caller; at most 4 investors and 2 buyers; ineligible ids are ignored.
create or replace function rr_shortlist_set(p_rows jsonb, p_user text default rr_owner())
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_week date := rr_week_start(current_date); r record; i radar_items; v_bucket text;
  n_inv int := 0; n_buy int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;
  delete from shortlist where user_id = p_user and week = v_week and status = 'proposed';
  for r in select * from jsonb_to_recordset(p_rows) as x(radar_item_id uuid, rank int, reason text, ask text)
            order by coalesce(x.rank, 999) loop
    select * into i from radar_items where id = r.radar_item_id and user_id = p_user;
    continue when not found or not rr_shortlist_eligible(i, v_week);
    v_bucket := case when i.kind = 'buyer' then 'buyer' else 'investor' end;
    continue when (v_bucket = 'investor' and n_inv >= 4) or (v_bucket = 'buyer' and n_buy >= 2);
    insert into shortlist (user_id, week, radar_item_id, bucket, rank, reason, ask)
    values (p_user, v_week, i.id, v_bucket, coalesce(r.rank, 0), left(coalesce(r.reason, ''), 300), left(coalesce(r.ask, ''), 300));
    insert into outreach (user_id, radar_item_id, contact_id, deal_id, purpose)
    values (p_user, i.id, i.contact_id, i.deal_id, rr_default_purpose(i.kind))
    on conflict (radar_item_id) do nothing;
    if v_bucket = 'investor' then n_inv := n_inv + 1; else n_buy := n_buy + 1; end if;
  end loop;
  return n_inv + n_buy;
end $$;

-- Drafting now follows the shortlist: the old "pre-draft every unapproved 75+ find" queue is retired.
drop function if exists rr_outreach_queue(int, text);
create or replace function rr_outreach_queue(p_user text default rr_owner())
returns int language sql security definer set search_path = public, pg_temp as $$
  with ins as (
    insert into outreach (user_id, radar_item_id, contact_id, deal_id, purpose)
    select i.user_id, i.id, i.contact_id, i.deal_id, rr_default_purpose(i.kind) from radar_items i
     where i.user_id = p_user and i.feed = 'sooz' and rr_is_person(i.kind) and i.status <> 'dismissed'
       and (rr_is_approved(i) or exists (
             select 1 from shortlist s where s.radar_item_id = i.id and s.week = rr_week_start(current_date)
                and s.status in ('proposed', 'approved')))
       and not exists (select 1 from outreach o where o.radar_item_id = i.id)
    on conflict do nothing
    returning 1
  )
  select count(*)::int from ins
$$;

create or replace function rr_shortlist_ask(p_item uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select s.ask from shortlist s
   where s.radar_item_id = p_item and s.week = rr_week_start(current_date) and s.status in ('proposed', 'approved')
   limit 1
$$;

-- People that still need enrichment or drafts: this week's shortlist first, then people already in the CRM.
-- One person per firm, as before.
create or replace function rr_outreach_todo(p_limit int default 8, p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'radar_item_id', i.id, 'kind', i.kind, 'purpose', o.purpose, 'approved', rr_is_approved(i),
               'shortlisted', pick.shortlisted, 'shortlist_ask', rr_shortlist_ask(i.id),
               'contact_id', i.contact_id, 'name', i.title, 'url', i.url, 'summary', i.summary,
               'why_relevant', i.why_relevant, 'score', i.score, 'tags', i.tags, 'details', i.details,
               'location', i.location, 'email', o.email, 'linkedin_url', o.linkedin_url, 'warm_path', o.warm_path,
               'network_matches', rr_warm_paths(i)
             ) order by pick.shortlisted desc, pick.approved desc, pick.score desc, i.id)
        from (select * from (
                select distinct on (coalesce((rr_firm_keys(i2.details->>'firm'))[1], 'item:' || i2.id::text))
                       o2.radar_item_id, i2.score, rr_is_approved(i2) as approved,
                       rr_shortlist_ask(i2.id) is not null as shortlisted
                  from outreach o2 join radar_items i2 on i2.id = o2.radar_item_id
                 where o2.user_id = p_user and o2.stage = 'prospect' and i2.status <> 'dismissed'
                   and (rr_is_approved(i2) or rr_shortlist_ask(i2.id) is not null)
                   and not exists (
                     select 1 from outreach o3 join radar_items i3 on i3.id = o3.radar_item_id
                      where o3.user_id = p_user and o3.stage in ('drafted', 'sent', 'replied', 'closed')
                        and rr_firm_keys(i3.details->>'firm') && rr_firm_keys(i2.details->>'firm'))
                 order by coalesce((rr_firm_keys(i2.details->>'firm'))[1], 'item:' || i2.id::text),
                          (rr_shortlist_ask(i2.id) is not null) desc, rr_is_approved(i2) desc, i2.score desc, i2.id
              ) best order by best.shortlisted desc, best.approved desc, best.score desc limit p_limit) pick
        join radar_items i on i.id = pick.radar_item_id
        join outreach o on o.radar_item_id = pick.radar_item_id
    ), '[]'::jsonb)
  )
$$;

revoke all on function rr_shortlist_eligible(radar_items, date), rr_warm_paths(radar_items), rr_shortlist_candidates(text),
  rr_shortlist_set(jsonb, text), rr_outreach_queue(text), rr_shortlist_ask(uuid) from public;
