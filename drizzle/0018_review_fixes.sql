-- Fixes from the final review (run before the Radar's people move, which this migration also runs).

-- Where a Radar person stands. On hold / Dismissed on the card wins; for restaurants each buyer has their own standing
-- (a new buyer at a restaurant you already know is still someone to reach out to); otherwise the card, then the contact.
create or replace function rr_relationship(i radar_items) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when d.relationship in ('on_hold', 'dismissed') then d.relationship
    when d.section = 'restaurants' and c.relationship is not null then c.relationship
    else coalesce(d.relationship, c.relationship) end
    from (select 1) one
    left join deals d on d.id = i.deal_id and d.section <> 'general'
    left join contacts c on c.id = i.contact_id
$$;

-- Someone dismissed (or put on hold) before under this name — as another Radar find or a CRM contact in any section.
create or replace function rr_suppressed(p_item uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
           select 1 from radar_items i join radar_items x
             on x.user_id = i.user_id and x.id <> i.id and x.status = 'dismissed' and rr_is_person(x.kind)
            and rr_slug(x.title) = rr_slug(i.title)
          where i.id = p_item)
      or exists (
           select 1 from radar_items i join contacts c
             on c.user_id = i.user_id and lower(c.name) = lower(i.title) and c.relationship in ('dismissed', 'on_hold')
          where i.id = p_item)
$$;
revoke all on function rr_suppressed(uuid) from public;

-- The same person found twice is one candidate: the find that holds their outreach thread.
create or replace function rr_shortlist_eligible(i radar_items, p_week date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select i.feed = 'sooz' and i.kind in ('angel', 'nextgen', 'buyer') and i.status <> 'dismissed'
     and not rr_already_contacted(i)
     and not exists (select 1 from outreach o
                      where i.contact_id is not null and o.contact_id = i.contact_id and o.radar_item_id <> i.id)
     and not exists (
       select 1 from shortlist s
        where s.radar_item_id = i.id and (s.week = p_week or (s.status = 'skipped' and s.week > p_week - 56)))
     and not exists (
       select 1 from outreach o
        where o.radar_item_id = i.id and (o.gmail_ok or o.stage not in ('prospect', 'drafted')))
$$;

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
  -- One outreach thread per person: the same person found again (another firm, another source) shares it.
  if not exists (select 1 from outreach o where o.user_id = p_user and o.contact_id = v_contact and o.radar_item_id <> i.id) then
    insert into outreach (user_id, radar_item_id, purpose) values (p_user, i.id, rr_default_purpose(i.kind))
    on conflict (radar_item_id) do nothing;
  end if;
  update outreach set contact_id = v_contact, deal_id = v_deal, updated_at = now() where radar_item_id = i.id;

  return jsonb_build_object('section', v_section, 'contact_id', v_contact, 'company_id', v_company, 'deal_id', v_deal,
    'href', case when v_section = 'general' then '/general/' || v_contact else '/' || v_section || '/' || v_deal end);
end $$;

create or replace function rr_ingest(p_feed text, p_task text, p_kinds text[], p_upcoming boolean, p_findings jsonb,
                                     p_user text default rr_owner())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; d jsonb;
  v_kind text; v_title text; v_url text; v_score int; v_event date; v_deadline date; v_firm text;
  v_tags text[]; v_details jsonb; v_key text; v_ins boolean; v_run uuid; v_id uuid; v_status text;
  n_valid int := 0; n_ins int := 0; n_upd int := 0; n_crm int := 0; n_kept int := 0; rejected jsonb := '[]'::jsonb;
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
        if rr_suppressed(v_id) then
          -- Dismissed (or put on hold) before under this name: never suggested again.
          update radar_items set status = 'dismissed', updated_at = now() where id = v_id;
          n_kept := n_kept + 1;
        else
          perform rr_approve_item(v_id, p_user);
          n_crm := n_crm + 1;
        end if;
      end if;

      n_valid := n_valid + 1;
      if v_ins then n_ins := n_ins + 1; else n_upd := n_upd + 1; end if;
    exception when others then
      rejected := rejected || jsonb_build_array(jsonb_build_object('title', left(f->>'title', 80), 'reason', sqlerrm));
    end;
  end loop;

  update radar_runs set finished_at = now(), found = n_valid, inserted = n_ins where id = v_run;
  return jsonb_build_object('run_id', v_run, 'received', jsonb_array_length(p_findings), 'valid', n_valid,
                            'inserted', n_ins, 'updated', n_upd, 'added_to_crm', n_crm, 'kept_dismissed', n_kept,
                            'rejected', rejected);
end $$;

create or replace function rr_outreach_record(p_item uuid, p_event text, p_at timestamptz, p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o outreach; i radar_items; v_at timestamptz := coalesce(p_at, now()); v_name text; v_touches int;
begin
  select * into o from outreach where radar_item_id = p_item and user_id = p_user for update;
  if not found then return 'not found'; end if;
  select * into i from radar_items where id = p_item;
  if not rr_is_approved(i) then return 'not approved'; end if;
  -- After Try again, sends and replies dated before the reset belong to the earlier attempt.
  if p_event in ('sent', 'followup', 'replied') and o.retry_at is not null and v_at < o.retry_at then return 'ignored'; end if;
  select name into v_name from contacts where id = i.contact_id;

  if p_event = 'sent' then
    if o.stage not in ('prospect', 'drafted') then return 'ignored'; end if;
    update outreach set stage = 'sent', sent_at = v_at, last_touch_at = v_at, touches = greatest(touches, 1),
           next_followup_at = (v_at + interval '5 days')::date, contact_id = i.contact_id, deal_id = i.deal_id, updated_at = now()
     where id = o.id;
    perform rr_log_email(p_user, i, 'Sent intro email', v_at);
    insert into tasks (user_id, title, due_date, contact_id, deal_id)
    values (p_user, 'Follow up with ' || v_name, (v_at + interval '5 days')::date, i.contact_id, i.deal_id);
    -- First stage -> second stage only (src/lib/sections.ts PIPELINES); later stages are the owner's call.
    update deals set stage = case section when 'investors' then 'intro' else 'contacted' end, updated_at = now()
     where id = i.deal_id and user_id = p_user
       and ((section = 'investors' and stage = 'target') or (section = 'restaurants' and stage = 'lead'));
  elsif p_event = 'followup' then
    if o.stage <> 'sent' or o.touches >= 3 then return 'ignored'; end if;
    v_touches := o.touches + 1;
    update outreach set touches = v_touches, last_touch_at = v_at, updated_at = now(),
           next_followup_at = case when v_touches >= 3 then null else (v_at + interval '7 days')::date end
     where id = o.id;
    perform rr_log_email(p_user, i, 'Sent follow-up', v_at);
    perform rr_close_followups(p_user, i, v_at);
    if v_touches < 3 then
      insert into tasks (user_id, title, due_date, contact_id, deal_id)
      values (p_user, 'Follow up with ' || v_name, (v_at + interval '7 days')::date, i.contact_id, i.deal_id);
    end if;
  elsif p_event = 'replied' then
    if o.stage not in ('drafted', 'sent') then return 'ignored'; end if;
    update outreach set stage = 'replied', replied_at = v_at, next_followup_at = null, updated_at = now() where id = o.id;
    perform rr_log_email(p_user, i, 'Replied', v_at);
    perform rr_close_followups(p_user, i, v_at);
  elsif p_event = 'closed' then
    if o.stage = 'closed' then return 'ignored'; end if;
    update outreach set stage = 'closed', next_followup_at = null, updated_at = now() where id = o.id;
    perform rr_close_followups(p_user, i, v_at);
  else
    return 'ignored';
  end if;
  return 'ok';
end $$;

create or replace function rr_outreach_watch(p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'email', o.email,
                                               'stage', o.stage, 'subject', o.subject, 'sent_at', o.sent_at,
                                               'since', o.retry_at)), '[]'::jsonb)
    from outreach o join radar_items i on i.id = o.radar_item_id
   where o.user_id = p_user and rr_is_approved(i) and o.email is not null and o.stage in ('drafted', 'sent')
     and not exists (select 1 from outreach_messages x where x.outreach_id = o.id)
$$;

-- Ghosted: the cadence ended with no reply or other touch for 7 days. Not someone who had an advice call, and not once
-- the owner said they know them (that marks the thread replied, below).
create or replace function rr_refresh_ghosted(p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r radar_items; n int := 0;
begin
  for r in
    select i.* from outreach o join radar_items i on i.id = o.radar_item_id
     where o.user_id = p_user and o.stage = 'sent' and o.next_followup_at is null
       and o.last_touch_at < now() - interval '7 days' and rr_is_approved(i) and rr_relationship(i) = 'known'
       and not exists (select 1 from deals d where d.id = i.deal_id and d.details ? 'adviceCallAt')
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

-- Owner says Know them: a thread whose cadence ended counts as answered, so it is not ghosted again.
create or replace function rr_outreach_known(p_contact uuid, p_deal uuid, p_user text default rr_owner()) returns void
language sql security definer set search_path = public, pg_temp as $$
  update outreach set stage = 'replied', replied_at = coalesce(replied_at, now()), next_followup_at = null, updated_at = now()
   where user_id = p_user and stage = 'sent' and next_followup_at is null
     and ((p_contact is not null and contact_id = p_contact) or (p_deal is not null and deal_id = p_deal));
$$;
revoke all on function rr_outreach_known(uuid, uuid, text) from public;

-- Try again resets one person's thread: only one that actually went quiet (sent, cadence over) for a Ghosted person.
create or replace function rr_try_again(p_item uuid, p_user text default rr_owner()) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare i radar_items; v_oid uuid;
begin
  select * into i from radar_items where id = p_item and user_id = p_user for update;
  if not found or rr_relationship(i) is distinct from 'ghosted' then return false; end if;
  update outreach set stage = 'prospect', touches = 0, subject = null, body = null, linkedin_note = null, intro_request = null,
         followup_1 = null, followup_2 = null, drafted_by = null, drafted_at = null, sent_at = null, last_touch_at = null,
         next_followup_at = null, replied_at = null, gmail_ok = false, retry_at = now(), updated_at = now()
   where radar_item_id = i.id and user_id = p_user and stage = 'sent' and next_followup_at is null
  returning id into v_oid;
  if v_oid is null then return false; end if;
  delete from outreach_messages where outreach_id = v_oid;
  update deals set relationship = 'to_reach_out', relationship_at = now()
   where id = i.deal_id and user_id = p_user and section <> 'general' and relationship = 'ghosted';
  update contacts set relationship = 'to_reach_out', relationship_at = now(), archived_at = null
   where id = i.contact_id and user_id = p_user;
  return true;
end $$;

-- Try again from a CRM record: every ghosted thread on that card or contact (a restaurant can have several buyers).
create or replace function rr_try_again_record(p_deal uuid, p_contact uuid, p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; n int := 0;
begin
  for v_id in
    select i.id from radar_items i join outreach o on o.radar_item_id = i.id
     where i.user_id = p_user and ((p_deal is not null and i.deal_id = p_deal) or (p_contact is not null and i.contact_id = p_contact))
       and o.stage = 'sent' and o.next_followup_at is null
  loop
    if rr_try_again(v_id, p_user) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function rr_try_again_record(uuid, uuid, text) from public;

create or replace function rr_sync_crm_investors(p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; v_item uuid; v_deal deals; v_contacted boolean; n int := 0;
begin
  -- A synced investor who got a pipeline card later is linked to it.
  update radar_items r set deal_id = d.id, updated_at = now()
    from deals d
   where r.user_id = p_user and r.task_id = 'crm' and r.deal_id is null and d.user_id = p_user
     and d.section = 'investors' and d.status = 'open' and d.contact_id = r.contact_id;
  update outreach o set deal_id = r.deal_id
    from radar_items r where r.id = o.radar_item_id and r.user_id = p_user and r.task_id = 'crm' and o.deal_id is null and r.deal_id is not null;
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

-- The move keeps earlier dismissals by name; it stops (rather than skips) on an error, so nobody is left hidden.
create or replace function rr_move_radar_people(p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; n int := 0;
begin
  for v_id in
    select id from radar_items
     where user_id = p_user and feed = 'sooz' and rr_is_person(kind) and status in ('new', 'seen', 'saved')
     order by first_seen, id
  loop
    if rr_suppressed(v_id) then
      update radar_items set status = 'dismissed', updated_at = now() where id = v_id;
    else
      perform rr_approve_item(v_id, p_user);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Investors added by hand without a card, never contacted, are someone to reach out to (as new ones are).
update contacts c set relationship = 'to_reach_out', relationship_at = now()
 where c.section = 'investors' and c.relationship = 'known' and c.archived_at is null
   and not exists (select 1 from deals d where d.section = 'investors'
                     and (d.contact_id = c.id or (c.company_id is not null and d.company_id = c.company_id)))
   and not rr_touched(c.id, c.company_id, null);

do $$ declare u text; n int; begin
  for u in select id from "user" loop
    n := rr_move_radar_people(u);
    raise notice 'moved % Radar people into the CRM for %', n, u;
  end loop;
end $$;
