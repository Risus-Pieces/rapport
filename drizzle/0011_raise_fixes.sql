-- Raise mode fixes from the final review: nothing unwanted may land in the owner's Gmail Drafts.

-- Already in touch, checked every time (not just when a hand-added contact is first synced): an investor deal past
-- Target, or a logged email, call or meeting with this person. (A Restaurants deal belongs to the store, so only the
-- person's own activities count there.)
create or replace function rr_already_contacted(i radar_items) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from deals d where d.id = i.deal_id and d.section = 'investors' and d.stage <> 'target')
      or (i.contact_id is not null and exists (
            select 1 from activities a where a.contact_id = i.contact_id and a.type in ('email', 'call', 'meeting')))
$$;

create or replace function rr_shortlist_eligible(i radar_items, p_week date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select i.feed = 'sooz' and i.kind in ('angel', 'nextgen', 'buyer') and i.status <> 'dismissed'
     and not rr_already_contacted(i)
     and not exists (
       select 1 from shortlist s
        where s.radar_item_id = i.id and (s.week = p_week or (s.status = 'skipped' and s.week > p_week - 56)))
     and not exists (
       select 1 from outreach o
        where o.radar_item_id = i.id and (o.gmail_ok or o.stage not in ('prospect', 'drafted')))
$$;

create or replace function rr_phase(p_user text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value from app_settings where user_id = p_user and key = 'raise.phase'), 'building')
$$;

-- Launch messages only while Raising, updates only while Building; the period is pinned so a routine can't create a
-- second launch ask by spelling 'launch' differently.
create or replace function rr_message_save(p_item uuid, p_kind text, p_period text, p_subject text, p_body text,
                                           p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare i radar_items; o outreach; m outreach_messages; v_period text;
begin
  if p_kind not in ('update', 'launch_ask', 'launch_followup') then return 'bad kind'; end if;
  if p_kind = 'update' then
    if rr_phase(p_user) <> 'building' then return 'not building'; end if;
    if coalesce(p_period, '') !~ '^\d{4}-\d{2}$' then return 'bad period'; end if;
    v_period := p_period;
  else
    if rr_phase(p_user) <> 'raising' then return 'not raising'; end if;
    v_period := 'launch';
  end if;
  select * into i from radar_items where id = p_item and user_id = p_user;
  if not found then return 'not found'; end if;
  if not rr_ready(i) then return 'not ready'; end if;
  select * into o from outreach where radar_item_id = i.id;
  if not found then return 'not found'; end if;
  select * into m from outreach_messages where outreach_id = o.id and kind = p_kind and period = v_period;
  if found and m.status <> 'ready' then return 'exists'; end if;
  insert into outreach_messages (user_id, outreach_id, kind, period, subject, body)
  values (p_user, o.id, p_kind, v_period, left(nullif(btrim(p_subject), ''), 160), left(nullif(btrim(p_body), ''), 4000))
  on conflict (outreach_id, kind, period) do update set subject = excluded.subject, body = excluded.body, updated_at = now()
    where outreach_messages.status = 'ready';
  return 'ok';
end $$;

create or replace function rr_gmail_todo(p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
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
       where o.user_id = p_user and o.gmail_ok and o.email is not null and rr_is_approved(i)
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

create or replace function rr_gmail_record(p_key text, p_draft_id text, p_thread_id text, p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare o outreach; m outreach_messages; v_kind text := split_part(p_key, ':', 2); v_period text := split_part(p_key, ':', 3);
        v_oid uuid; v_rows int; v_draft text := nullif(btrim(coalesce(p_draft_id, '')), '');
        v_thread text := nullif(btrim(coalesce(p_thread_id, '')), '');
begin
  begin
    v_oid := split_part(p_key, ':', 1)::uuid;
  exception when others then
    return 'not found';
  end;
  select * into o from outreach where id = v_oid and user_id = p_user;
  if not found then return 'not found'; end if;
  select * into m from outreach_messages where outreach_id = o.id and kind = v_kind and period = v_period for update;
  if found then
    if m.status <> 'ready' then return 'exists'; end if;
    update outreach_messages set status = 'in_gmail', gmail_draft_id = v_draft, gmail_thread_id = v_thread,
           pushed_at = now(), updated_at = now() where id = m.id;
    return 'ok';
  end if;
  if v_kind not in ('first', 'followup_1', 'followup_2') then return 'not found'; end if;
  insert into outreach_messages (user_id, outreach_id, kind, period, subject, body, status, gmail_draft_id, gmail_thread_id, pushed_at)
  values (p_user, o.id, v_kind, v_period,
          case when v_kind = 'first' then o.subject else 'Re: ' || coalesce(o.subject, '') end,
          case v_kind when 'first' then o.body when 'followup_1' then o.followup_1 else o.followup_2 end,
          'in_gmail', v_draft, v_thread, now())
  on conflict (outreach_id, kind, period) do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'ok' else 'exists' end;
end $$;

-- A crashed run that saved the update for some people must not block the rest: people who already have this
-- month's update are left out, and "facts not updated" compares against earlier months only.
create or replace function rr_update_todo(p_today date default current_date, p_user text default rr_owner())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_facts jsonb; v_facts_at timestamptz; v_first_monday date; v_period text := to_char(p_today, 'YYYY-MM');
  v_last timestamptz; v_people jsonb;
begin
  if rr_phase(p_user) = 'raising' then return jsonb_build_object('due', false, 'reason', 'raising', 'period', v_period); end if;
  select jsonb_object_agg(replace(key, 'month.', ''), value), max(updated_at) into v_facts, v_facts_at
    from app_settings where user_id = p_user and key in ('month.progress', 'month.ask', 'month.next') and btrim(value) <> '';
  if v_facts is null then return jsonb_build_object('due', false, 'reason', 'no facts', 'period', v_period); end if;
  v_first_monday := date_trunc('month', p_today)::date + ((8 - extract(isodow from date_trunc('month', p_today)))::int % 7);
  if p_today < v_first_monday then return jsonb_build_object('due', false, 'reason', 'not yet this month', 'period', v_period); end if;
  select max(created_at) into v_last from outreach_messages where user_id = p_user and kind = 'update' and period < v_period;
  if v_last is not null and v_facts_at <= v_last then
    return jsonb_build_object('due', false, 'reason', 'facts not updated', 'period', v_period);
  end if;
  v_people := rr_ready_people(p_user, 'update', v_period);
  if jsonb_array_length(v_people) = 0 then
    return jsonb_build_object('due', false, 'period', v_period, 'reason',
      case when exists (select 1 from outreach_messages where user_id = p_user and kind = 'update' and period = v_period)
           then 'already drafted' else 'no one ready' end);
  end if;
  return jsonb_build_object('due', true, 'reason', 'due', 'period', v_period, 'facts', v_facts, 'people', v_people,
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb));
end $$;

-- Threads sent outside Gmail Drafts (compose link, Mark sent) are still watched here; Gmail-pushed ones by rr_gmail_watch.
create or replace function rr_outreach_watch(p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'email', o.email,
                                               'stage', o.stage, 'subject', o.subject, 'sent_at', o.sent_at)), '[]'::jsonb)
    from outreach o join radar_items i on i.id = o.radar_item_id
   where o.user_id = p_user and rr_is_approved(i) and o.email is not null and o.stage in ('drafted', 'sent')
     and not exists (select 1 from outreach_messages x where x.outreach_id = o.id)
$$;

-- Drafting is shortlist-only: this week's shortlist, plus people the owner approved for Gmail.
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

revoke all on function rr_already_contacted(radar_items), rr_phase(text) from public;
