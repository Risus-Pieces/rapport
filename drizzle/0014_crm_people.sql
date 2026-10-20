-- People go straight from research into the CRM as To reach out; Ghosted is automatic; Try again starts over.
-- Relationship changes that follow from facts (a touch, a stage move) are triggers, so the app, the routines and
-- hand-run SQL all keep them current.

create or replace function rr_first_stage(p_section text) returns text language sql immutable as $$
  select case p_section when 'investors' then 'target' when 'restaurants' then 'lead' end
$$;

-- A touch (call, email, meeting, tasting) means you know them: rr_log_email's sends and replies included.
create or replace function rr_activities_touch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.type::text in ('call', 'email', 'meeting', 'tasting') then
    perform rr_mark_known(new.contact_id, new.company_id, new.deal_id, new.user_id);
  end if;
  return null;
end $$;
revoke all on function rr_activities_touch() from public;
create or replace trigger activities_touch after insert on activities for each row execute function rr_activities_touch();

-- A new pipeline card at its first stage is someone to reach out to (unless the caller set a relationship), and a
-- person added with their card follows it. Moving past the first stage, or an advice call done, means you are in touch.
create or replace function rr_deals_relationship() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.section not in ('investors', 'restaurants') then return new; end if;
  if tg_op = 'INSERT' then
    if new.relationship_at is null then
      new.relationship := case when new.status = 'open' and new.stage = rr_first_stage(new.section::text)
                               and not rr_touched(new.contact_id, new.company_id, null) then 'to_reach_out' else 'known' end;
      new.relationship_at := now();
      update contacts set relationship = new.relationship, relationship_at = now()
       where id = new.contact_id and user_id = new.user_id and relationship_at is null and archived_at is null;
    end if;
  elsif new.relationship in ('to_reach_out', 'ghosted')
        and ((new.stage is distinct from old.stage and new.stage <> rr_first_stage(new.section::text))
             or (new.details ? 'adviceCallAt' and not coalesce(old.details ? 'adviceCallAt', false))) then
    new.relationship := 'known';
    new.relationship_at := now();
    update contacts set relationship = 'known', relationship_at = now()
     where id = new.contact_id and user_id = new.user_id and relationship in ('to_reach_out', 'ghosted');
  end if;
  return new;
end $$;
revoke all on function rr_deals_relationship() from public;
create or replace trigger deals_relationship before insert or update of stage, details on deals for each row execute function rr_deals_relationship();

-- Where a Radar person stands: their pipeline card's relationship, or their contact's for General.
create or replace function rr_relationship(i radar_items) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select d.relationship from deals d where d.id = i.deal_id and d.section <> 'general'),
                  (select c.relationship from contacts c where c.id = i.contact_id))
$$;
revoke all on function rr_relationship(radar_items) from public;

-- Already contacted = anything but To reach out (Know them, Ghosted, On hold, Dismissed all count).
create or replace function rr_already_contacted(i radar_items) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select i.contact_id is not null and coalesce(rr_relationship(i), 'to_reach_out') <> 'to_reach_out'
$$;

-- A To reach out person who was emailed or met before (Try again): the note circles back instead of introducing.
create or replace function rr_retry(i radar_items) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select i.contact_id is not null and exists (
    select 1 from activities a where a.contact_id = i.contact_id and a.type::text in ('call', 'email', 'meeting', 'tasting'))
$$;
revoke all on function rr_retry(radar_items) from public;

-- Updates and launch asks only go to people you know (never On hold, Dismissed or Ghosted).
create or replace function rr_ready(i radar_items) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rr_is_approved(i) and rr_relationship(i) = 'known' and exists (
    select 1 from deals d where d.id = i.deal_id and d.section = 'investors' and d.status = 'open' and d.details ? 'adviceCallAt')
$$;

create or replace function rr_compact(j jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(j)
   where value <> 'null'::jsonb and value <> '""'::jsonb
$$;

-- Approve one finding (was approveRadarItem in TypeScript): the person lands in the CRM section their kind belongs to
-- (angels and next-gen → Investors angel deal at Target; buyers → Restaurants company, contact and Lead deal;
-- celebrities, creators and press → General contact), as To reach out. Idempotent under a row lock; a same-name contact
-- (archived ones included, so a Dismissed person stays Dismissed) and a buyer's existing company and open deal are reused.
-- Errors the app shows the owner use SQLSTATE RR001.
create or replace function rr_approve_item(p_item uuid, p_user text default rr_owner()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i radar_items; d jsonb; v_section text; v_firm text; v_email text; v_linkedin text; v_radar jsonb;
  v_contact uuid; v_company uuid; v_deal uuid; v_rel text; v_unset boolean; v_new_contact boolean := false; v_stage text;
begin
  select * into i from radar_items where id = p_item and user_id = p_user for update;
  if not found then raise exception 'That finding no longer exists.' using errcode = 'RR001'; end if;
  v_section := case when i.feed = 'sooz' then
                 case when i.kind in ('angel', 'nextgen') then 'investors' when i.kind = 'buyer' then 'restaurants'
                      when i.kind in ('celebrity', 'creator', 'media') then 'general' end end;
  if v_section is null then raise exception 'Only people can be added to the CRM.' using errcode = 'RR001'; end if;

  -- Still in the CRM: nothing to do. If its contact or pipeline card was deleted since, approve again.
  if i.status = 'approved' and i.contact_id is not null and (v_section = 'general' or i.deal_id is not null) then
    return jsonb_build_object('section', v_section, 'contact_id', i.contact_id, 'company_id', i.company_id, 'deal_id', i.deal_id,
      'href', case when v_section = 'general' then '/general/' || i.contact_id else '/' || v_section || '/' || i.deal_id end);
  end if;

  d := coalesce(i.details, '{}'::jsonb);
  v_firm := nullif(btrim(split_part(regexp_replace(coalesce(d->>'firm', ''), '\|', ';', 'g'), ';', 1)), '');
  select o.email, o.linkedin_url into v_email, v_linkedin from outreach o where o.radar_item_id = i.id;
  v_radar := rr_compact(jsonb_build_object(
    'radarItemId', i.id, 'kind', i.kind, 'sourceUrl', i.url, 'whyRelevant', i.why_relevant,
    'contactPath', d->>'contact_path', 'riceConnection', d->>'rice_connection', 'checkSize', d->>'check_size', 'firm', d->>'firm'));

  select c.id, c.relationship, c.relationship_at is null into v_contact, v_rel, v_unset from contacts c
   where c.user_id = p_user and c.section::text = v_section and lower(c.name) = lower(i.title)
   order by (c.archived_at is null) desc, c.created_at limit 1;
  -- A reused contact nobody has placed yet: To reach out unless someone has been in touch.
  if v_contact is not null and v_unset then
    v_rel := case when rr_touched(v_contact, null, null) then 'known' else 'to_reach_out' end;
    update contacts set relationship = v_rel, relationship_at = now() where id = v_contact;
  end if;

  if v_section = 'restaurants' then
    select co.id into v_company from companies co
     where co.user_id = p_user and co.section = 'restaurants' and co.archived_at is null and lower(co.name) = lower(coalesce(v_firm, i.title))
     limit 1;
    if v_company is null then
      insert into companies (user_id, section, name) values (p_user, 'restaurants', coalesce(v_firm, i.title)) returning id into v_company;
    end if;
    if v_contact is not null then
      -- A buyer whose restaurant was deleted keeps the contact without a company: re-attach it.
      update contacts set company_id = v_company where id = v_contact and company_id is null;
    else
      insert into contacts (user_id, section, name, email, linkedin_url, tags, company_id, title, details, relationship, relationship_at)
      values (p_user, 'restaurants', i.title, v_email, v_linkedin, coalesce(i.tags[1:20], '{}'), v_company, d->>'role',
              jsonb_build_object('radar', v_radar), 'to_reach_out', now())
      returning id into v_contact;
      v_new_contact := true;
    end if;
    select dl.id into v_deal from deals dl where dl.user_id = p_user and dl.status = 'open' and dl.company_id = v_company limit 1;
  else
    if v_contact is null then
      insert into contacts (user_id, section, name, email, linkedin_url, tags, title, priority, details, relationship, relationship_at)
      values (p_user, v_section::section, i.title, v_email, v_linkedin, coalesce(i.tags[1:20], '{}'),
              nullif(concat_ws(' · ', nullif(d->>'role', ''), nullif(d->>'firm', '')), ''), null,
              case when v_section = 'investors' then rr_compact(jsonb_build_object('background', i.summary)) || jsonb_build_object('radar', v_radar)
                   else jsonb_build_object('radar', v_radar) end,
              'to_reach_out', now())
      returning id into v_contact;
      v_new_contact := true;
    end if;
    if v_section = 'investors' then
      select dl.id into v_deal from deals dl where dl.user_id = p_user and dl.status = 'open' and dl.contact_id = v_contact limit 1;
    end if;
  end if;
  if v_new_contact then v_rel := 'to_reach_out'; end if;

  if v_section <> 'general' and v_deal is null then
    v_stage := rr_first_stage(v_section);
    insert into deals (user_id, section, contact_id, company_id, title, stage, details, sort_key, relationship, relationship_at)
    values (p_user, v_section::section,
            case when v_section = 'investors' then v_contact end,
            case when v_section = 'restaurants' then v_company end,
            case when v_section = 'restaurants' then coalesce(v_firm, i.title) else i.title end,
            v_stage,
            case when v_section = 'investors' then '{"investorType":"angel"}'::jsonb else '{}'::jsonb end,
            coalesce((select max(sort_key) from deals where user_id = p_user and section::text = v_section and stage = v_stage), 0) + 1,
            v_rel, now())
    returning id into v_deal;
  end if;

  insert into activities (user_id, type, summary, body, contact_id, company_id, deal_id)
  values (p_user, 'note', 'Added from Radar',
          nullif(concat_ws(E'\n\n', nullif(i.summary, ''), case when i.url is not null then 'Source: ' || i.url end), ''),
          v_contact, v_company, v_deal);
  update radar_items set status = 'approved', contact_id = v_contact, company_id = v_company, deal_id = v_deal, updated_at = now()
   where id = i.id;
  -- Every approved person gets an outreach row, so the record page shows the outreach panel at once.
  insert into outreach (user_id, radar_item_id, purpose) values (p_user, i.id, rr_default_purpose(i.kind))
  on conflict (radar_item_id) do nothing;
  update outreach set contact_id = v_contact, deal_id = v_deal, updated_at = now() where radar_item_id = i.id;

  return jsonb_build_object('section', v_section, 'contact_id', v_contact, 'company_id', v_company, 'deal_id', v_deal,
    'href', case when v_section = 'general' then '/general/' || v_contact else '/' || v_section || '/' || v_deal end);
end $$;
revoke all on function rr_approve_item(uuid, text) from public;

-- Research ingest: people found for Sooz go straight into the CRM as To reach out.
create or replace function rr_ingest(p_feed text, p_task text, p_kinds text[], p_upcoming boolean, p_findings jsonb,
                                     p_user text default rr_owner())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; d jsonb;
  v_kind text; v_title text; v_url text; v_score int; v_event date; v_deadline date; v_firm text;
  v_tags text[]; v_details jsonb; v_key text; v_ins boolean; v_run uuid; v_id uuid; v_status text;
  n_valid int := 0; n_ins int := 0; n_upd int := 0; n_crm int := 0; rejected jsonb := '[]'::jsonb;
begin
  if p_feed is null or p_feed not in ('sooz', 'personal', 'career') then
    raise exception 'feed must be sooz, personal or career';
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then raise exception 'findings must be a JSON array'; end if;
  insert into radar_runs (user_id, task_id, feed) values (p_user, left(coalesce(p_task, ''), 80), p_feed) returning id into v_run;

  for f in select * from jsonb_array_elements(p_findings) loop
    begin
      v_kind  := lower(btrim(coalesce(f->>'kind', '')));
      v_title := left(nullif(btrim(coalesce(f->>'title', '')), ''), 160);
      if v_title is null then raise exception 'missing title'; end if;
      if not (v_kind = any (p_kinds)) then raise exception 'kind % not allowed for this task', v_kind; end if;
      v_url := nullif(btrim(coalesce(f->>'url', '')), '');
      if rr_norm_url(v_url) is null then raise exception 'missing or invalid url'; end if;
      v_score := round(least(100, greatest(0, (f->>'score')::numeric)));
      if v_score < 45 then raise exception 'score below 45'; end if;

      v_event := rr_date(f->>'event_date');
      v_deadline := rr_date(f->>'deadline');
      if p_upcoming and coalesce(v_event, v_deadline) < current_date then raise exception 'already past'; end if;

      d := case when jsonb_typeof(f->'details') = 'object' then f->'details' else '{}'::jsonb end;
      v_firm := left(nullif(btrim(coalesce(d->>'firm', '')), ''), 200);
      v_details := jsonb_strip_nulls(jsonb_build_object(
        'firm', v_firm,
        'role', left(nullif(btrim(coalesce(d->>'role', '')), ''), 200),
        'rice_connection', left(nullif(btrim(coalesce(d->>'rice_connection', '')), ''), 200),
        'check_size', left(nullif(btrim(coalesce(d->>'check_size', '')), ''), 200),
        'contact_path', left(nullif(btrim(coalesce(d->>'contact_path', '')), ''), 300)));

      select coalesce(array_agg(t order by ord), '{}') into v_tags from (
        select t, min(ord) as ord from (
          select left(lower(btrim(x.value)), 30) as t, x.ord
            from jsonb_array_elements_text(coalesce(f->'tags', '[]'::jsonb)) with ordinality as x(value, ord)
        ) s where t <> '' group by t order by min(ord) limit 8
      ) q;
      if v_details ? 'rice_connection' and not ('rice' = any (v_tags)) then v_tags := array_append(v_tags, 'rice'); end if;

      v_key := rr_dedupe_key(p_feed, v_kind, v_title, v_url, v_event, v_firm);

      insert into radar_items (user_id, feed, kind, title, url, source, summary, why_relevant, score, tags, details,
                               event_date, deadline, location, dedupe_key, task_id)
      values (p_user, p_feed, v_kind, v_title, v_url,
              left(nullif(btrim(coalesce(f->>'source', '')), ''), 120),
              left(btrim(coalesce(f->>'summary', '')), 600),
              left(btrim(coalesce(f->>'why_relevant', '')), 300),
              v_score, v_tags, v_details, v_event, v_deadline,
              left(nullif(btrim(coalesce(f->>'location', '')), ''), 120), v_key, left(coalesce(p_task, ''), 80))
      on conflict (user_id, dedupe_key) do update set
        last_seen = now(), updated_at = now(), summary = excluded.summary, why_relevant = excluded.why_relevant,
        score = excluded.score, tags = excluded.tags, details = radar_items.details || excluded.details,
        event_date = coalesce(excluded.event_date, radar_items.event_date),
        deadline = coalesce(excluded.deadline, radar_items.deadline),
        location = coalesce(excluded.location, radar_items.location)
      returning id, (xmax = 0), status into v_id, v_ins, v_status;

      if p_feed = 'sooz' and rr_is_person(v_kind) and v_status in ('new', 'seen', 'saved') then
        perform rr_approve_item(v_id, p_user);
        n_crm := n_crm + 1;
      end if;

      n_valid := n_valid + 1;
      if v_ins then n_ins := n_ins + 1; else n_upd := n_upd + 1; end if;
    exception when others then
      rejected := rejected || jsonb_build_array(jsonb_build_object('title', left(f->>'title', 80), 'reason', sqlerrm));
    end;
  end loop;

  update radar_runs set finished_at = now(), found = n_valid, inserted = n_ins where id = v_run;
  return jsonb_build_object('run_id', v_run, 'received', jsonb_array_length(p_findings), 'valid', n_valid,
                            'inserted', n_ins, 'updated', n_upd, 'added_to_crm', n_crm, 'rejected', rejected);
end $$;

-- Ghosted: an intro whose cadence ended (no follow-up scheduled) with no reply or other touch for 7 days.
-- Rows without a touch date (old hand-marked sends) are left alone. Being Ghosted closes pending follow-up tasks.
create or replace function rr_refresh_ghosted(p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r radar_items; n int := 0;
begin
  for r in
    select i.* from outreach o join radar_items i on i.id = o.radar_item_id
     where o.user_id = p_user and o.stage = 'sent' and o.next_followup_at is null
       and o.last_touch_at < now() - interval '7 days' and rr_is_approved(i) and rr_relationship(i) = 'known'
       and not exists (
         select 1 from activities a
          where a.user_id = p_user and a.type::text in ('call', 'email', 'meeting', 'tasting') and a.occurred_at > o.last_touch_at
            and (a.contact_id = i.contact_id or (i.deal_id is not null and a.deal_id = i.deal_id)))
  loop
    update deals set relationship = 'ghosted', relationship_at = now()
     where id = r.deal_id and user_id = p_user and section <> 'general' and relationship = 'known';
    update contacts set relationship = 'ghosted', relationship_at = now()
     where id = r.contact_id and user_id = p_user and relationship = 'known';
    perform rr_close_followups(p_user, r, now());
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function rr_refresh_ghosted(text) from public;

-- Try again (only from Ghosted): back to To reach out with a clean outreach row. Earlier Gmail message records go so
-- they can't block a new first note; the CRM timeline keeps the history (and makes the todo say retry).
create or replace function rr_try_again(p_item uuid, p_user text default rr_owner()) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare i radar_items; v_oid uuid;
begin
  select * into i from radar_items where id = p_item and user_id = p_user for update;
  if not found or rr_relationship(i) is distinct from 'ghosted' then return false; end if;
  update outreach set stage = 'prospect', touches = 0, subject = null, body = null, linkedin_note = null, intro_request = null,
         followup_1 = null, followup_2 = null, drafted_by = null, drafted_at = null, sent_at = null, last_touch_at = null,
         next_followup_at = null, replied_at = null, gmail_ok = false, updated_at = now()
   where radar_item_id = i.id and user_id = p_user
  returning id into v_oid;
  delete from outreach_messages where outreach_id = v_oid;
  update deals set relationship = 'to_reach_out', relationship_at = now()
   where id = i.deal_id and user_id = p_user and section <> 'general';
  update contacts set relationship = 'to_reach_out', relationship_at = now(), archived_at = null
   where id = i.contact_id and user_id = p_user;
  return true;
end $$;
revoke all on function rr_try_again(uuid, text) from public;

-- Partners at an institution with an Investors deal are reached through that deal, not as separate angels.
create or replace function rr_sync_crm_investors(p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; v_item uuid; v_deal deals; v_contacted boolean; n int := 0;
begin
  for c in
    select ct.*, co.name as company_name from contacts ct left join companies co on co.id = ct.company_id
     where ct.user_id = p_user and ct.section = 'investors' and ct.archived_at is null
       and not exists (select 1 from radar_items r where r.user_id = p_user and r.contact_id = ct.id)
       and not (ct.company_id is not null and exists (
             select 1 from deals d where d.user_id = p_user and d.section = 'investors' and d.company_id = ct.company_id))
  loop
    v_deal := null;
    select * into v_deal from deals d
     where d.user_id = p_user and d.section = 'investors' and d.contact_id = c.id
     order by (d.status = 'open') desc, d.created_at desc limit 1;
    v_item := null;
    insert into radar_items (user_id, feed, kind, title, url, score, status, task_id, dedupe_key, contact_id, deal_id, details)
    values (p_user, 'sooz', 'angel', left(c.name, 160), null, 70, 'approved', 'crm', 'crm:' || c.id, c.id, v_deal.id,
            jsonb_strip_nulls(jsonb_build_object('role', c.title, 'firm', c.company_name)))
    on conflict (user_id, dedupe_key) do nothing
    returning id into v_item;
    continue when v_item is null;
    v_contacted := case when v_deal.id is not null then v_deal.relationship <> 'to_reach_out'
                        when c.relationship_at is null then rr_touched(c.id, null, null)
                        else c.relationship <> 'to_reach_out' end;
    -- An investor added by hand without a card: where they stand follows whether anyone has been in touch.
    if v_deal.id is null and c.relationship_at is null then
      update contacts set relationship = case when v_contacted then 'known' else 'to_reach_out' end, relationship_at = now()
       where id = c.id;
    end if;
    insert into outreach (user_id, radar_item_id, contact_id, deal_id, purpose, email, linkedin_url, stage, touches)
    values (p_user, v_item, c.id, v_deal.id, 'invest', c.email, c.linkedin_url,
            case when v_contacted then 'sent' else 'prospect' end, case when v_contacted then 1 else 0 end)
    on conflict (radar_item_id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Removes synced partner records that never got going (prospect/drafted, not approved for Gmail, nothing in Gmail).
create or replace function rr_cleanup_partner_items(p_user text default rr_owner()) returns integer
language sql security definer set search_path = public, pg_temp as $$
  with gone as (
    delete from radar_items i using contacts c
     where i.user_id = p_user and i.task_id = 'crm' and c.id = i.contact_id and c.company_id is not null
       and exists (select 1 from deals d where d.user_id = p_user and d.section = 'investors' and d.company_id = c.company_id)
       and not exists (
         select 1 from outreach o
          where o.radar_item_id = i.id
            and (o.gmail_ok or o.stage not in ('prospect', 'drafted')
                 or exists (select 1 from outreach_messages x where x.outreach_id = o.id)))
    returning 1)
  select count(*)::int from gone
$$;
revoke all on function rr_cleanup_partner_items(text) from public;

-- Shortlist candidates say whether this is a second try.
create or replace function rr_shortlist_candidates(p_user text default rr_owner()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
                                  'from_crm', i.task_id = 'crm', 'retry', rr_retry(i), 'score', i.score, 'summary', i.summary,
                                  'why_relevant', i.why_relevant, 'details', i.details, 'tags', i.tags,
                                  'warm_paths', rr_warm_paths(i)) as c
          from radar_items i
         where i.user_id = p_user and i.kind in ('angel', 'nextgen') and rr_shortlist_eligible(i, v_week)
         order by i.score desc limit 60) x), '[]'::jsonb),
    'buyers', coalesce((
      select jsonb_agg(c order by (c->>'score')::int desc) from (
        select jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'kind', i.kind, 'approved', rr_is_approved(i),
                                  'retry', rr_retry(i), 'score', i.score, 'summary', i.summary, 'why_relevant', i.why_relevant,
                                  'details', i.details, 'tags', i.tags, 'warm_paths', rr_warm_paths(i)) as c
          from radar_items i
         where i.user_id = p_user and i.kind = 'buyer' and rr_shortlist_eligible(i, v_week)
         order by i.score desc limit 20) x), '[]'::jsonb));
end $$;

-- First notes only for people still To reach out; retry = write a short circling-back note.
create or replace function rr_outreach_todo(p_limit integer default 8, p_user text default rr_owner()) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'radar_item_id', i.id, 'kind', i.kind, 'purpose', o.purpose, 'approved', rr_is_approved(i),
               'shortlisted', pick.shortlisted, 'shortlist_ask', rr_shortlist_ask(i.id), 'retry', rr_retry(i),
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
                   and not rr_already_contacted(i2)
                   and ((rr_is_approved(i2) and o2.gmail_ok) or rr_shortlist_ask(i2.id) is not null)
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

-- Follow-ups only to people you know (not Ghosted, On hold or Dismissed).
create or replace function rr_gmail_todo(p_user text default rr_owner()) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sender_email', (select nullif(value, '') from app_settings where user_id = p_user and key = 'pitch.sender_email'),
    'messages', coalesce((select jsonb_agg(m order by m->>'kind', m->>'to') from (
      select jsonb_build_object('key', o.id || ':first:', 'radar_item_id', i.id, 'kind', 'first', 'period', '',
                                'to', o.email, 'subject', o.subject, 'body', o.body, 'thread_id', null) as m
        from outreach o join radar_items i on i.id = o.radar_item_id
       where o.user_id = p_user and o.gmail_ok and o.email is not null and rr_is_approved(i)
         and o.stage = 'drafted' and o.body is not null and not rr_already_contacted(i)
         and not exists (select 1 from outreach_messages x where x.outreach_id = o.id and x.kind = 'first')
      union all
      select jsonb_build_object('key', o.id || ':followup_' || o.touches || ':', 'radar_item_id', i.id,
                                'kind', 'followup_' || o.touches, 'period', '', 'to', o.email,
                                'subject', 'Re: ' || coalesce(o.subject, ''),
                                'body', case o.touches when 1 then o.followup_1 else o.followup_2 end,
                                'thread_id', (select f.gmail_thread_id from outreach_messages f where f.outreach_id = o.id and f.kind = 'first'))
        from outreach o join radar_items i on i.id = o.radar_item_id
       where o.user_id = p_user and o.gmail_ok and o.email is not null and rr_is_approved(i) and rr_relationship(i) = 'known'
         and o.stage = 'sent' and o.touches in (1, 2) and o.next_followup_at <= current_date
         and (case o.touches when 1 then o.followup_1 else o.followup_2 end) is not null
         and not exists (select 1 from outreach_messages x where x.outreach_id = o.id and x.kind = 'followup_' || o.touches)
      union all
      select jsonb_build_object('key', o.id || ':' || x.kind || ':' || x.period, 'radar_item_id', i.id, 'kind', x.kind,
                                'period', x.period, 'to', o.email, 'subject', x.subject, 'body', x.body,
                                'thread_id', case when x.kind = 'launch_followup' then
                                  (select l.gmail_thread_id from outreach_messages l where l.outreach_id = o.id and l.kind = 'launch_ask' limit 1) end)
        from outreach_messages x join outreach o on o.id = x.outreach_id join radar_items i on i.id = o.radar_item_id
       where x.user_id = p_user and x.status = 'ready' and o.email is not null and o.stage <> 'closed' and rr_ready(i)
         and ((x.kind = 'update' and rr_phase(p_user) = 'building')
              or (x.kind in ('launch_ask', 'launch_followup') and rr_phase(p_user) = 'raising'))
         and not (x.kind = 'launch_followup' and exists (
               select 1 from outreach_messages l where l.outreach_id = o.id and l.kind = 'launch_ask' and l.status = 'replied'))
    ) all_msgs), '[]'::jsonb))
$$;

create or replace function rr_launch_todo(p_user text default rr_owner()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_phase text := coalesce((select value from app_settings where user_id = p_user and key = 'raise.phase'), 'building');
begin
  return jsonb_build_object(
    'phase', v_phase,
    'raise', jsonb_build_object(
      'target', coalesce((select value from app_settings where user_id = p_user and key = 'raise.target'), '75000'),
      'instrument', (select nullif(value, '') from app_settings where user_id = p_user and key = 'pitch.raise')),
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb),
    'launch_asks', case when v_phase = 'raising' then rr_ready_people(p_user, 'launch_ask', 'launch') else '[]'::jsonb end,
    'launch_followups', case when v_phase = 'raising' then coalesce((
      select jsonb_agg(jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'email', o.email, 'launch_subject', x.subject))
        from outreach_messages x join outreach o on o.id = x.outreach_id join radar_items i on i.id = o.radar_item_id
       where x.user_id = p_user and x.kind = 'launch_ask' and x.status = 'sent' and x.sent_at <= now() - interval '7 days'
         and rr_ready(i)
         and not exists (select 1 from outreach_messages f where f.outreach_id = o.id and f.kind = 'launch_followup')), '[]'::jsonb)
    else '[]'::jsonb end);
end $$;

-- Where a person lives in the CRM (for digest links).
create or replace function rr_crm_path(i radar_items) returns text language sql immutable as $$
  select case
    when i.contact_id is null then null
    when i.kind in ('celebrity', 'creator', 'media') then '/general/' || i.contact_id
    when i.deal_id is null then null
    when i.kind = 'buyer' then '/restaurants/' || i.deal_id
    else '/investors/' || i.deal_id end
$$;

-- Digest: people now arrive in the CRM, so "new people" are the ones added to To reach out; links go to the CRM and
-- the Opportunities tab.
create or replace function rr_digest_email(p_min_score integer default 55, p_base_url text default null, p_user text default rr_owner())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := current_date;
  fresh radar_items[]; upcoming radar_items[]; i radar_items;
  shown uuid[]; ids uuid[] := '{}';
  h_up text := ''; h_ppl text := ''; h_oth text := ''; h_per text := ''; h_car text := '';
  t_up text := ''; t_ppl text := ''; t_oth text := ''; t_per text := ''; t_car text := '';
  n_up int := 0; n_ppl int := 0; n_oth int := 0; n_per int := 0; n_car int := 0; n_fresh int := 0;
  li text; tx text; subj text; html text; txt text; base text; opp_url text; link text;
  o_ready int := 0; o_wait int := 0; o_due int := 0; o_replies int := 0; o_html text := ''; o_txt text := '';
begin
  base := case when p_base_url is not null then rtrim(p_base_url, '/') end;
  opp_url := base || '/opportunities';
  select coalesce(array_agg(x order by x.feed, x.score desc, x.first_seen desc), '{}') into fresh
    from radar_items x
   where x.user_id = p_user and x.digested_at is null and x.score >= p_min_score
     and (x.status = 'new'
          or (x.feed = 'sooz' and rr_is_person(x.kind) and x.status = 'approved' and coalesce(x.task_id, '') <> 'crm'
              and rr_relationship(x) = 'to_reach_out'));
  select coalesce(array_agg(x order by coalesce(x.event_date, x.deadline), x.score desc), '{}') into upcoming
    from radar_items x where x.user_id = p_user and x.status in ('new', 'seen', 'saved') and not rr_is_person(x.kind)
     and ((x.event_date between today and today + 14) or (x.deadline between today and today + 14));
  select coalesce(array_agg(u.id), '{}') into shown from unnest(upcoming) u;

  foreach i in array upcoming loop
    li := format('<li style="margin:0 0 14px"><a href="%s" style="color:#1a56db;text-decoration:none"><b>%s</b></a> <span style="color:#888;font-size:12px">· %s · fit %s</span><div style="color:#555">%s</div><div>%s</div><div style="color:#555"><i>%s</i></div></li>',
      rr_esc(i.url), rr_esc(i.title), rr_esc(i.kind), i.score, rr_esc(rr_item_meta(i)), rr_esc(i.summary), rr_esc(i.why_relevant));
    tx := format('- %s [%s, fit %s] — %s%s%s', i.title, i.kind, i.score, rr_item_meta(i), E'\n  ' || i.summary, E'\n  ' || i.url);
    h_up := h_up || li; t_up := t_up || tx || E'\n'; n_up := n_up + 1;
  end loop;

  foreach i in array fresh loop
    n_fresh := n_fresh + 1; ids := ids || i.id;
    continue when i.id = any (shown);
    link := case when rr_is_person(i.kind) and base is not null and rr_crm_path(i) is not null then base || rr_crm_path(i) else i.url end;
    li := format('<li style="margin:0 0 14px"><a href="%s" style="color:#1a56db;text-decoration:none"><b>%s</b></a> <span style="color:#888;font-size:12px">· %s · fit %s</span><div style="color:#555">%s</div><div>%s</div><div style="color:#555"><i>%s</i></div>%s</li>',
      rr_esc(link), rr_esc(i.title), rr_esc(i.kind), i.score, rr_esc(rr_item_meta(i)), rr_esc(i.summary), rr_esc(i.why_relevant),
      case when rr_is_person(i.kind) and coalesce(i.details->>'contact_path', '') <> '' then '<div style="color:#555">Path: ' || rr_esc(i.details->>'contact_path') || '</div>' else '' end);
    tx := format('- %s [%s, fit %s] — %s%s%s', i.title, i.kind, i.score, rr_item_meta(i), E'\n  ' || i.summary, E'\n  ' || link);
    if i.feed = 'personal' then h_per := h_per || li; t_per := t_per || tx || E'\n'; n_per := n_per + 1;
    elsif i.feed = 'career' then h_car := h_car || li; t_car := t_car || tx || E'\n'; n_car := n_car + 1;
    elsif rr_is_person(i.kind) then h_ppl := h_ppl || li; t_ppl := t_ppl || tx || E'\n'; n_ppl := n_ppl + 1;
    else h_oth := h_oth || li; t_oth := t_oth || tx || E'\n'; n_oth := n_oth + 1; end if;
  end loop;

  select count(*) filter (where o.stage = 'drafted' and rr_is_approved(r) and not rr_already_contacted(r)),
         count(*) filter (where o.stage = 'drafted' and not rr_is_approved(r) and r.status <> 'dismissed'),
         count(*) filter (where o.stage = 'sent' and o.next_followup_at <= today and o.touches < 3 and rr_relationship(r) = 'known'),
         count(*) filter (where o.stage = 'replied' and o.replied_at > now() - interval '8 days')
    into o_ready, o_wait, o_due, o_replies
    from outreach o join radar_items r on r.id = o.radar_item_id
   where o.user_id = p_user;
  if o_ready + o_wait + o_due + o_replies > 0 then
    o_txt := concat_ws(' · ',
      case when o_ready > 0 then o_ready || ' draft' || case when o_ready = 1 then '' else 's' end || ' ready to send' end,
      case when o_wait > 0 then o_wait || ' draft' || case when o_wait = 1 then '' else 's' end || ' waiting for your approval' end,
      case when o_due > 0 then o_due || ' follow-up' || case when o_due = 1 then '' else 's' end || ' due' end,
      case when o_replies > 0 then o_replies || ' new repl' || case when o_replies = 1 then 'y' else 'ies' end end);
    o_html := '<h2 style="font-size:16px;margin:24px 0 8px">Outreach</h2><p style="margin:0">' || rr_esc(o_txt)
      || case when base is not null then ' · <a href="' || rr_esc(base || '/week') || '">Open This week</a>' else '' end || '</p>';
    o_txt := E'\nOUTREACH\n' || o_txt || E'\n';
  end if;

  subj := format('Rapport radar: %s new find%s%s (%s)', n_fresh, case when n_fresh = 1 then '' else 's' end,
                 case when n_up > 0 then ', ' || n_up || ' coming up' else '' end, today);
  html := '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111;line-height:1.45">'
    || '<h1 style="font-size:20px;margin:0 0 4px">Rapport radar</h1><div style="color:#666">' || today
    || case when base is not null then ' · <a href="' || rr_esc(opp_url) || '">Open Opportunities</a>' else '' end || '</div>'
    || case when n_up > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Coming up in the next 14 days (' || n_up || ')</h2><ul style="padding-left:18px;margin:0">' || h_up || '</ul>' else '' end
    || case when n_ppl > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — added to To reach out (' || n_ppl || ')</h2><ul style="padding-left:18px;margin:0">' || h_ppl || '</ul>' else '' end
    || case when n_oth > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — events, funding &amp; resources (' || n_oth || ')</h2><ul style="padding-left:18px;margin:0">' || h_oth || '</ul>' else '' end
    || case when n_per > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Personal (' || n_per || ')</h2><ul style="padding-left:18px;margin:0">' || h_per || '</ul>' else '' end
    || case when n_car > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Career (' || n_car || ')</h2><ul style="padding-left:18px;margin:0">' || h_car || '</ul>' else '' end
    || o_html
    || '</body></html>';
  txt := 'RAPPORT RADAR — ' || today || E'\n'
    || case when base is not null then 'Opportunities: ' || opp_url || E'\n' else '' end
    || case when n_up > 0 then E'\nCOMING UP IN THE NEXT 14 DAYS (' || n_up || E')\n' || t_up else '' end
    || case when n_ppl > 0 then E'\nSOOZ — ADDED TO TO REACH OUT (' || n_ppl || E')\n' || t_ppl else '' end
    || case when n_oth > 0 then E'\nSOOZ — EVENTS, FUNDING & RESOURCES (' || n_oth || E')\n' || t_oth else '' end
    || case when n_per > 0 then E'\nPERSONAL (' || n_per || E')\n' || t_per else '' end
    || case when n_car > 0 then E'\nCAREER (' || n_car || E')\n' || t_car else '' end
    || o_txt;

  return jsonb_build_object('count', n_fresh, 'upcoming', n_up, 'subject', subj, 'html', html, 'text', txt, 'ids', to_jsonb(ids),
                            'outreach', jsonb_build_object('drafts_ready', o_ready, 'drafts_waiting', o_wait, 'followups_due', o_due,
                                                           'new_replies', o_replies, 'actions', o_ready + o_wait + o_due + o_replies));
end $$;

-- People the owner already approved by hand were never "new" for the digest.
update radar_items set digested_at = now() where status = 'approved' and digested_at is null;

do $$ declare u text; begin
  for u in select id from "user" loop perform rr_cleanup_partner_items(u); end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'radar_routine') then
    grant execute on function rr_refresh_ghosted(text) to radar_routine;
  end if;
end $$;
