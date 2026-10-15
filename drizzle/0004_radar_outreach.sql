-- Radar outreach + digest functions (ports of Query's oq_outreach_* and oq_digest_email).
-- Outreach rows are draft and cadence state; the relationship itself lives in contacts, deals,
-- activities and tasks, which rr_outreach_record writes for approved people.

create or replace function rr_company_key(t text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(t, '')),
           '\m(inc|llc|l\.l\.c|ltd|co|corp|corporation|company|the|lp|llp|plc)\M\.?', '', 'g'),
           '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Company keys for each firm in a field like "The Angel Group; Supernatural Ventures" (first firm first).
create or replace function rr_firm_keys(t text) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by ord), '{}') from (
    select rr_company_key(x.s) as k, min(x.ord) as ord
      from unnest(regexp_split_to_array(coalesce(t, ''), '\s*[;|]\s*')) with ordinality as x(s, ord)
     group by 1
  ) q where k is not null and length(k) >= 3
$$;

create or replace function rr_is_approved(i radar_items) returns boolean language sql immutable as $$
  select i.status = 'approved' and i.contact_id is not null
$$;

-- Outreach rows for approved people (any score) and strong unapproved people (pre-drafting).
create or replace function rr_outreach_queue(p_min_score int default 75, p_user text default rr_owner())
returns int language sql security definer set search_path = public, pg_temp as $$
  with ins as (
    insert into outreach (user_id, radar_item_id, contact_id, deal_id, purpose)
    select i.user_id, i.id, i.contact_id, i.deal_id, rr_default_purpose(i.kind) from radar_items i
     where i.user_id = p_user and i.feed = 'sooz' and rr_is_person(i.kind) and i.status <> 'dismissed'
       and (rr_is_approved(i) or i.score >= p_min_score)
       and not exists (select 1 from outreach o where o.radar_item_id = i.id)
    on conflict do nothing
    returning 1
  )
  select count(*)::int from ins
$$;

-- People that still need enrichment or drafts, with everything a drafter needs. One person per firm:
-- a firm with a live thread is skipped, and within a batch only its best person is handed out.
create or replace function rr_outreach_todo(p_limit int default 8, p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pitch', coalesce((select jsonb_object_agg(key, value) from app_settings where user_id = p_user and key like 'pitch.%'), '{}'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'radar_item_id', i.id, 'kind', i.kind, 'purpose', o.purpose, 'approved', rr_is_approved(i),
               'contact_id', i.contact_id, 'name', i.title, 'url', i.url, 'summary', i.summary,
               'why_relevant', i.why_relevant, 'score', i.score, 'tags', i.tags, 'details', i.details,
               'location', i.location, 'email', o.email, 'linkedin_url', o.linkedin_url, 'warm_path', o.warm_path,
               'network_matches', (
                 select coalesce(jsonb_agg(jsonb_build_object('name', n.full_name, 'company', n.company, 'position', n.position)), '[]'::jsonb)
                   from network n
                  where n.user_id = p_user and n.company_key = any (rr_firm_keys(i.details->>'firm'))
               )
             ) order by pick.approved desc, pick.score desc, i.id)
        from (select * from (
                select distinct on (coalesce((rr_firm_keys(i2.details->>'firm'))[1], 'item:' || i2.id::text))
                       o2.radar_item_id, i2.score, rr_is_approved(i2) as approved
                  from outreach o2 join radar_items i2 on i2.id = o2.radar_item_id
                 where o2.user_id = p_user and o2.stage = 'prospect' and i2.status <> 'dismissed'
                   and not exists (
                     select 1 from outreach o3 join radar_items i3 on i3.id = o3.radar_item_id
                      where o3.user_id = p_user and o3.stage in ('drafted', 'sent', 'replied', 'closed')
                        and rr_firm_keys(i3.details->>'firm') && rr_firm_keys(i2.details->>'firm'))
                 order by coalesce((rr_firm_keys(i2.details->>'firm'))[1], 'item:' || i2.id::text),
                          rr_is_approved(i2) desc, i2.score desc, i2.id
              ) best order by best.approved desc, best.score desc limit p_limit) pick
        join radar_items i on i.id = pick.radar_item_id
        join outreach o on o.radar_item_id = pick.radar_item_id
    ), '[]'::jsonb)
  )
$$;

-- Save enrichment and drafts for one person. Frozen once sent. For an approved person, a found
-- email or LinkedIn URL also fills the contact's empty field.
create or replace function rr_outreach_save(p_item uuid, p jsonb, p_user text default rr_owner())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o outreach; i radar_items;
  v_email text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_li text := nullif(btrim(coalesce(p->>'linkedin_url', '')), '');
  v_body text := nullif(btrim(coalesce(p->>'body', '')), '');
begin
  select * into o from outreach where radar_item_id = p_item and user_id = p_user for update;
  if not found then raise exception 'item % is not in the outreach pipeline', p_item; end if;
  if o.stage not in ('prospect', 'drafted') then
    return jsonb_build_object('ok', false, 'reason', 'stage is ' || o.stage || '; drafts are frozen once sent');
  end if;
  if v_email is not null and v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' then v_email := null; end if;
  if v_li is not null and v_li !~* '^https://([a-z]{2,3}\.)?linkedin\.com/in/[^/?#\s]+/?$' then v_li := null; end if;

  update outreach set
    email         = coalesce(v_email, email),
    email_source  = case when v_email is not null then left(coalesce(nullif(p->>'email_source', ''), 'routine'), 40) else email_source end,
    linkedin_url  = coalesce(v_li, linkedin_url),
    warm_path     = coalesce(left(nullif(btrim(p->>'warm_path'), ''), 500), warm_path),
    subject       = coalesce(left(nullif(btrim(p->>'subject'), ''), 160), subject),
    body          = coalesce(left(v_body, 3000), body),
    linkedin_note = coalesce(left(nullif(btrim(p->>'linkedin_note'), ''), 300), linkedin_note),
    intro_request = coalesce(left(nullif(btrim(p->>'intro_request'), ''), 2000), intro_request),
    followup_1    = coalesce(left(nullif(btrim(p->>'followup_1'), ''), 1500), followup_1),
    followup_2    = coalesce(left(nullif(btrim(p->>'followup_2'), ''), 1500), followup_2),
    drafted_by    = case when v_body is not null then 'claude' else drafted_by end,
    drafted_at    = case when v_body is not null then now() else drafted_at end,
    stage         = case when v_body is not null or o.body is not null then 'drafted' else stage end,
    updated_at    = now()
  where id = o.id;

  select * into i from radar_items where id = p_item;
  if rr_is_approved(i) and (v_email is not null or v_li is not null) then
    update contacts set email = coalesce(email, v_email), linkedin_url = coalesce(linkedin_url, v_li), updated_at = now()
     where id = i.contact_id and user_id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'email_saved', v_email is not null, 'linkedin_saved', v_li is not null,
                            'draft_saved', v_body is not null);
end $$;

create or replace function rr_log_email(p_user text, i radar_items, p_summary text, p_at timestamptz)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into activities (user_id, type, occurred_at, summary, contact_id, company_id, deal_id)
  values (p_user, 'email', p_at, p_summary, i.contact_id,
          (select company_id from deals where id = i.deal_id and user_id = p_user), i.deal_id)
$$;

create or replace function rr_close_followups(p_user text, i radar_items, p_at timestamptz)
returns void language sql security definer set search_path = public, pg_temp as $$
  update tasks set done_at = p_at, updated_at = now()
   where user_id = p_user and contact_id = i.contact_id and done_at is null
     and title = 'Follow up with ' || (select name from contacts where id = i.contact_id)
$$;

-- The one place outreach events change the CRM: activity, follow-up task and first stage move.
-- Used by the app's buttons and (through rr_outreach_observe) by the Gmail-watching routine.
create or replace function rr_outreach_record(p_item uuid, p_event text, p_at timestamptz, p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o outreach; i radar_items; v_at timestamptz := coalesce(p_at, now()); v_name text; v_touches int;
begin
  select * into o from outreach where radar_item_id = p_item and user_id = p_user for update;
  if not found then return 'not found'; end if;
  select * into i from radar_items where id = p_item;
  if not rr_is_approved(i) then return 'not approved'; end if;
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

-- Threads to check in Gmail: approved people only (unapproved pre-drafts have no send button).
create or replace function rr_outreach_watch(p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('radar_item_id', i.id, 'name', i.title, 'email', o.email,
                                               'stage', o.stage, 'subject', o.subject, 'sent_at', o.sent_at)), '[]'::jsonb)
    from outreach o join radar_items i on i.id = o.radar_item_id
   where o.user_id = p_user and rr_is_approved(i) and o.email is not null and o.stage in ('drafted', 'sent')
$$;

-- What the routine saw in Gmail: 'sent' or 'replied'.
create or replace function rr_outreach_observe(p_item uuid, p_event text, p_at timestamptz, p_user text default rr_owner())
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_event not in ('sent', 'replied') then return 'ignored'; end if;
  return rr_outreach_record(p_item, p_event, p_at, p_user);
end $$;

create or replace function rr_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

create or replace function rr_item_meta(i radar_items) returns text language sql immutable as $$
  select case when rr_is_person(i.kind)
    then concat_ws(' · ', nullif(i.details->>'role', ''), nullif(i.details->>'firm', ''),
                   case when coalesce(i.details->>'rice_connection', '') <> '' then 'Rice: ' || (i.details->>'rice_connection') end,
                   nullif(i.details->>'check_size', ''))
    else concat_ws(' · ', i.event_date::text, case when i.deadline is not null then 'apply by ' || i.deadline::text end, nullif(i.location, ''))
  end
$$;

-- Fully rendered, HTML-escaped digest. The routine forwards subject/html/text, then calls rr_mark_digested(ids).
create or replace function rr_digest_email(p_min_score int default 55, p_base_url text default null, p_user text default rr_owner())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := current_date;
  fresh radar_items[]; upcoming radar_items[]; i radar_items;
  shown uuid[]; ids uuid[] := '{}';
  h_up text := ''; h_ppl text := ''; h_oth text := ''; h_per text := ''; h_car text := '';
  t_up text := ''; t_ppl text := ''; t_oth text := ''; t_per text := ''; t_car text := '';
  n_up int := 0; n_ppl int := 0; n_oth int := 0; n_per int := 0; n_car int := 0; n_fresh int := 0;
  li text; tx text; subj text; html text; txt text; radar_url text;
  o_ready int := 0; o_wait int := 0; o_due int := 0; o_replies int := 0; o_html text := ''; o_txt text := '';
begin
  radar_url := case when p_base_url is not null then rtrim(p_base_url, '/') || '/radar' end;
  select coalesce(array_agg(x order by x.feed, x.score desc, x.first_seen desc), '{}') into fresh
    from radar_items x where x.user_id = p_user and x.digested_at is null and x.status = 'new' and x.score >= p_min_score;
  select coalesce(array_agg(x order by coalesce(x.event_date, x.deadline), x.score desc), '{}') into upcoming
    from radar_items x where x.user_id = p_user and x.status in ('new', 'seen', 'saved')
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
    li := format('<li style="margin:0 0 14px"><a href="%s" style="color:#1a56db;text-decoration:none"><b>%s</b></a> <span style="color:#888;font-size:12px">· %s · fit %s</span><div style="color:#555">%s</div><div>%s</div><div style="color:#555"><i>%s</i></div>%s</li>',
      rr_esc(i.url), rr_esc(i.title), rr_esc(i.kind), i.score, rr_esc(rr_item_meta(i)), rr_esc(i.summary), rr_esc(i.why_relevant),
      case when rr_is_person(i.kind) and coalesce(i.details->>'contact_path', '') <> '' then '<div style="color:#555">Path: ' || rr_esc(i.details->>'contact_path') || '</div>' else '' end);
    tx := format('- %s [%s, fit %s] — %s%s%s', i.title, i.kind, i.score, rr_item_meta(i), E'\n  ' || i.summary, E'\n  ' || i.url);
    if i.feed = 'personal' then h_per := h_per || li; t_per := t_per || tx || E'\n'; n_per := n_per + 1;
    elsif i.feed = 'career' then h_car := h_car || li; t_car := t_car || tx || E'\n'; n_car := n_car + 1;
    elsif rr_is_person(i.kind) then h_ppl := h_ppl || li; t_ppl := t_ppl || tx || E'\n'; n_ppl := n_ppl + 1;
    else h_oth := h_oth || li; t_oth := t_oth || tx || E'\n'; n_oth := n_oth + 1; end if;
  end loop;

  select count(*) filter (where o.stage = 'drafted' and rr_is_approved(r)),
         count(*) filter (where o.stage = 'drafted' and not rr_is_approved(r) and r.status <> 'dismissed'),
         count(*) filter (where o.stage = 'sent' and o.next_followup_at <= today and o.touches < 3),
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
      || case when radar_url is not null then ' · <a href="' || rr_esc(radar_url) || '">Open Radar</a>' else '' end || '</p>';
    o_txt := E'\nOUTREACH\n' || o_txt || E'\n';
  end if;

  subj := format('Rapport radar: %s new find%s%s (%s)', n_fresh, case when n_fresh = 1 then '' else 's' end,
                 case when n_up > 0 then ', ' || n_up || ' coming up' else '' end, today);
  html := '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111;line-height:1.45">'
    || '<h1 style="font-size:20px;margin:0 0 4px">Rapport radar</h1><div style="color:#666">' || today
    || case when radar_url is not null then ' · <a href="' || rr_esc(radar_url) || '">Open Radar</a>' else '' end || '</div>'
    || case when n_up > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Coming up in the next 14 days (' || n_up || ')</h2><ul style="padding-left:18px;margin:0">' || h_up || '</ul>' else '' end
    || case when n_ppl > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — new people (' || n_ppl || ')</h2><ul style="padding-left:18px;margin:0">' || h_ppl || '</ul>' else '' end
    || case when n_oth > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Sooz — events, funding &amp; resources (' || n_oth || ')</h2><ul style="padding-left:18px;margin:0">' || h_oth || '</ul>' else '' end
    || case when n_per > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Personal (' || n_per || ')</h2><ul style="padding-left:18px;margin:0">' || h_per || '</ul>' else '' end
    || case when n_car > 0 then '<h2 style="font-size:16px;margin:24px 0 8px">Career (' || n_car || ')</h2><ul style="padding-left:18px;margin:0">' || h_car || '</ul>' else '' end
    || o_html
    || '</body></html>';
  txt := 'RAPPORT RADAR — ' || today || E'\n'
    || case when radar_url is not null then 'Radar: ' || radar_url || E'\n' else '' end
    || case when n_up > 0 then E'\nCOMING UP IN THE NEXT 14 DAYS (' || n_up || E')\n' || t_up else '' end
    || case when n_ppl > 0 then E'\nSOOZ — NEW PEOPLE (' || n_ppl || E')\n' || t_ppl else '' end
    || case when n_oth > 0 then E'\nSOOZ — EVENTS, FUNDING & RESOURCES (' || n_oth || E')\n' || t_oth else '' end
    || case when n_per > 0 then E'\nPERSONAL (' || n_per || E')\n' || t_per else '' end
    || case when n_car > 0 then E'\nCAREER (' || n_car || E')\n' || t_car else '' end
    || o_txt;

  return jsonb_build_object('count', n_fresh, 'upcoming', n_up, 'subject', subj, 'html', html, 'text', txt, 'ids', to_jsonb(ids),
                            'outreach', jsonb_build_object('drafts_ready', o_ready, 'drafts_waiting', o_wait, 'followups_due', o_due,
                                                           'new_replies', o_replies, 'actions', o_ready + o_wait + o_due + o_replies));
end $$;

create or replace function rr_mark_digested(p_ids uuid[], p_user text default rr_owner())
returns int language sql security definer set search_path = public, pg_temp as $$
  with u as (update radar_items set digested_at = now() where user_id = p_user and id = any (p_ids) returning 1)
  select count(*)::int from u
$$;

revoke all on function
  rr_outreach_queue(int, text), rr_outreach_todo(int, text), rr_outreach_save(uuid, jsonb, text),
  rr_log_email(text, radar_items, text, timestamptz), rr_close_followups(text, radar_items, timestamptz),
  rr_outreach_record(uuid, text, timestamptz, text), rr_outreach_watch(text),
  rr_outreach_observe(uuid, text, timestamptz, text), rr_digest_email(int, text, text), rr_mark_digested(uuid[], text)
from public;
