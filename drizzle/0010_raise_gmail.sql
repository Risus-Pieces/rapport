-- Raise mode: messages pushed to the owner's Gmail Drafts by the daily routine (never sent by it), monthly
-- updates and the launch ask. A message key is '<outreach id>:<kind>:<period>'.

-- "Ready to hear the raise": in the CRM, with an open investors deal marked Advice call done.
create or replace function rr_ready(i radar_items) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select rr_is_approved(i) and exists (
    select 1 from deals d where d.id = i.deal_id and d.section = 'investors' and d.status = 'open' and d.details ? 'adviceCallAt')
$$;

-- Save a routine-written update, launch ask or launch follow-up for one ready person (only while not yet in Gmail).
create or replace function rr_message_save(p_item uuid, p_kind text, p_period text, p_subject text, p_body text,
                                           p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare i radar_items; o outreach; m outreach_messages;
begin
  if p_kind not in ('update', 'launch_ask', 'launch_followup') then return 'bad kind'; end if;
  select * into i from radar_items where id = p_item and user_id = p_user;
  if not found then return 'not found'; end if;
  if not rr_ready(i) then return 'not ready'; end if;
  select * into o from outreach where radar_item_id = i.id;
  if not found then return 'not found'; end if;
  select * into m from outreach_messages where outreach_id = o.id and kind = p_kind and period = coalesce(p_period, '');
  if found and m.status <> 'ready' then return 'exists'; end if;
  insert into outreach_messages (user_id, outreach_id, kind, period, subject, body)
  values (p_user, o.id, p_kind, coalesce(p_period, ''), left(nullif(btrim(p_subject), ''), 160), left(nullif(btrim(p_body), ''), 4000))
  on conflict (outreach_id, kind, period) do update set subject = excluded.subject, body = excluded.body, updated_at = now()
    where outreach_messages.status = 'ready';
  return 'ok';
end $$;

-- What the daily routine should put in Gmail Drafts now: first notes and due follow-ups for people the owner approved
-- for Gmail, plus saved updates and launch asks. Nothing for anyone without an email or already closed.
create or replace function rr_gmail_todo(p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sender_email', (select nullif(value, '') from app_settings where user_id = p_user and key = 'pitch.sender_email'),
    'messages', coalesce((select jsonb_agg(m order by m->>'kind', m->>'to') from (
      select jsonb_build_object('key', o.id || ':first:', 'radar_item_id', i.id, 'kind', 'first', 'period', '',
                                'to', o.email, 'subject', o.subject, 'body', o.body, 'thread_id', null) as m
        from outreach o join radar_items i on i.id = o.radar_item_id
       where o.user_id = p_user and o.gmail_ok and o.email is not null and rr_is_approved(i)
         and o.stage = 'drafted' and o.body is not null
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
    ) all_msgs), '[]'::jsonb))
$$;

-- The routine created a Gmail draft for a message. A second call for the same key changes nothing.
create or replace function rr_gmail_record(p_key text, p_draft_id text, p_thread_id text, p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare o outreach; m outreach_messages; v_kind text := split_part(p_key, ':', 2); v_period text := split_part(p_key, ':', 3);
        v_oid uuid; v_rows int;
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
    update outreach_messages set status = 'in_gmail', gmail_draft_id = p_draft_id, gmail_thread_id = p_thread_id,
           pushed_at = now(), updated_at = now() where id = m.id;
    return 'ok';
  end if;
  if v_kind not in ('first', 'followup_1', 'followup_2') then return 'not found'; end if;
  insert into outreach_messages (user_id, outreach_id, kind, period, subject, body, status, gmail_draft_id, gmail_thread_id, pushed_at)
  values (p_user, o.id, v_kind, v_period,
          case when v_kind = 'first' then o.subject else 'Re: ' || coalesce(o.subject, '') end,
          case v_kind when 'first' then o.body when 'followup_1' then o.followup_1 else o.followup_2 end,
          'in_gmail', p_draft_id, p_thread_id, now())
  on conflict (outreach_id, kind, period) do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'ok' else 'exists' end;
end $$;

-- Messages to check in Gmail: drafts not yet sent, and sent ones still waiting for a reply.
create or replace function rr_gmail_watch(p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', x.outreach_id || ':' || x.kind || ':' || x.period, 'status', x.status, 'kind', x.kind,
           'name', i.title, 'to', o.email, 'subject', x.subject, 'thread_id', x.gmail_thread_id,
           'draft_id', x.gmail_draft_id, 'pushed_at', x.pushed_at, 'sent_at', x.sent_at) order by x.pushed_at), '[]'::jsonb)
    from outreach_messages x join outreach o on o.id = x.outreach_id join radar_items i on i.id = o.radar_item_id
   where x.user_id = p_user and x.status in ('in_gmail', 'sent') and o.email is not null
$$;

-- What the routine saw in Gmail for one message: 'sent' (the owner sent the draft) or 'replied'. Sends and replies
-- do what the app's buttons do: activity, follow-up task, stage move.
create or replace function rr_gmail_observe(p_key text, p_event text, p_at timestamptz, p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare m outreach_messages; i radar_items; v_at timestamptz := coalesce(p_at, now()); v_oid uuid;
begin
  begin
    v_oid := split_part(p_key, ':', 1)::uuid;
  exception when others then
    return 'not found';
  end;
  select * into m from outreach_messages
   where outreach_id = v_oid and kind = split_part(p_key, ':', 2) and period = split_part(p_key, ':', 3) and user_id = p_user
   for update;
  if not found then return 'not found'; end if;
  select r.* into i from radar_items r join outreach o on o.radar_item_id = r.id where o.id = m.outreach_id;

  if p_event = 'sent' then
    if m.status <> 'in_gmail' then return 'ignored'; end if;
    update outreach_messages set status = 'sent', sent_at = v_at, updated_at = now() where id = m.id;
    if m.kind = 'first' then perform rr_outreach_record(i.id, 'sent', v_at, p_user);
    elsif m.kind in ('followup_1', 'followup_2') then perform rr_outreach_record(i.id, 'followup', v_at, p_user);
    elsif m.kind = 'launch_ask' then perform rr_log_email(p_user, i, 'Sent launch ask', v_at);
    elsif m.kind = 'launch_followup' then perform rr_log_email(p_user, i, 'Sent launch follow-up', v_at);
    else perform rr_log_email(p_user, i, 'Sent monthly update', v_at);
    end if;
  elsif p_event = 'replied' then
    if m.status not in ('in_gmail', 'sent') then return 'ignored'; end if;
    update outreach_messages set status = 'replied', replied_at = v_at, updated_at = now() where id = m.id;
    if m.kind in ('first', 'followup_1', 'followup_2') then perform rr_outreach_record(i.id, 'replied', v_at, p_user);
    elsif m.kind in ('launch_ask', 'launch_followup') then
      perform rr_log_email(p_user, i, 'Replied to launch ask', v_at);
      update deals set stage = 'pitched', updated_at = now()
       where id = i.deal_id and user_id = p_user and section = 'investors' and stage in ('target', 'intro');
    else perform rr_log_email(p_user, i, 'Replied to update', v_at);
    end if;
  else
    return 'ignored';
  end if;
  return 'ok';
end $$;

create or replace function rr_ready_people(p_user text, p_without_kind text, p_period text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'email', o.email, 'details', i.details,
                                               'summary', i.summary, 'deal_stage', d.stage) order by i.title), '[]'::jsonb)
    from radar_items i join outreach o on o.radar_item_id = i.id join deals d on d.id = i.deal_id
   where i.user_id = p_user and rr_ready(i) and o.email is not null and o.stage <> 'closed'
     and not exists (select 1 from outreach_messages x where x.outreach_id = o.id and x.kind = p_without_kind and x.period = p_period)
$$;

-- Monthly update: due in the Building phase from the first Monday of the month, once the owner's "This month" facts
-- changed since the last update was drafted. Never twice in a month; never from stale facts.
create or replace function rr_update_todo(p_today date default current_date, p_user text default rr_owner())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_phase text := coalesce((select value from app_settings where user_id = p_user and key = 'raise.phase'), 'building');
  v_facts jsonb; v_facts_at timestamptz; v_first_monday date; v_period text := to_char(p_today, 'YYYY-MM');
  v_last timestamptz; v_people jsonb;
begin
  if v_phase = 'raising' then return jsonb_build_object('due', false, 'reason', 'raising', 'period', v_period); end if;
  select jsonb_object_agg(replace(key, 'month.', ''), value), max(updated_at) into v_facts, v_facts_at
    from app_settings where user_id = p_user and key in ('month.progress', 'month.ask', 'month.next') and btrim(value) <> '';
  if v_facts is null then return jsonb_build_object('due', false, 'reason', 'no facts', 'period', v_period); end if;
  v_first_monday := date_trunc('month', p_today)::date + ((8 - extract(isodow from date_trunc('month', p_today)))::int % 7);
  if p_today < v_first_monday then return jsonb_build_object('due', false, 'reason', 'not yet this month', 'period', v_period); end if;
  if exists (select 1 from outreach_messages where user_id = p_user and kind = 'update' and period = v_period) then
    return jsonb_build_object('due', false, 'reason', 'already drafted', 'period', v_period);
  end if;
  select max(created_at) into v_last from outreach_messages where user_id = p_user and kind = 'update';
  if v_last is not null and v_facts_at <= v_last then
    return jsonb_build_object('due', false, 'reason', 'facts not updated', 'period', v_period);
  end if;
  v_people := rr_ready_people(p_user, 'update', v_period);
  if jsonb_array_length(v_people) = 0 then return jsonb_build_object('due', false, 'reason', 'no one ready', 'period', v_period); end if;
  return jsonb_build_object('due', true, 'reason', 'due', 'period', v_period, 'facts', v_facts, 'people', v_people,
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb));
end $$;

-- Launch ask (Raising phase): ready people who haven't had it, and a single follow-up 7 days after a sent ask with no reply.
create or replace function rr_launch_todo(p_user text default rr_owner())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
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
         and not exists (select 1 from outreach_messages f where f.outreach_id = o.id and f.kind = 'launch_followup')), '[]'::jsonb)
    else '[]'::jsonb end);
end $$;

revoke all on function rr_ready(radar_items), rr_message_save(uuid, text, text, text, text, text), rr_gmail_todo(text),
  rr_gmail_record(text, text, text, text), rr_gmail_watch(text), rr_gmail_observe(text, text, timestamptz, text),
  rr_ready_people(text, text, text), rr_update_todo(date, text), rr_launch_todo(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'radar_routine') then
    grant execute on function rr_message_save(uuid, text, text, text, text, text), rr_gmail_todo(text),
      rr_gmail_record(text, text, text, text), rr_gmail_watch(text), rr_gmail_observe(text, text, timestamptz, text),
      rr_update_todo(date, text), rr_launch_todo(text)
    to radar_routine;
  end if;
end $$;
