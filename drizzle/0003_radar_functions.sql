-- Radar: SQL functions the weekly research routine calls (ports of Query's oq_*).
-- Routines connect as the restricted role radar_routine, which can only EXECUTE these functions;
-- they are SECURITY DEFINER with a pinned search_path so they can read and write the tables.
-- Every function scopes by owner: p_user defaults to rr_owner(), the single Rapport user.

create extension if not exists unaccent;

create or replace function rr_owner() returns text language plpgsql stable
security definer set search_path = public, pg_temp as $$
declare n int; v text;
begin
  select count(*), min(id) into n, v from "user";
  if n <> 1 then raise exception 'expected exactly one owner, found %', n; end if;
  return v;
end $$;

create or replace function rr_slug(t text) returns text language sql stable
set search_path = public, pg_temp as $$
  select btrim(regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', '-', 'g'), '-')
$$;

create or replace function rr_norm_url(u text) returns text language plpgsql immutable
set search_path = public, pg_temp as $$
declare m text[]; host text; path text; qs text;
begin
  m := regexp_match(btrim(coalesce(u, '')), '^https?://([^/?#]+)([^?#]*)(?:\?([^#]*))?', 'i');
  if m is null then return null; end if;
  host := lower(regexp_replace(regexp_replace(m[1], '^.*@', ''), ':[0-9]*$', ''));
  host := regexp_replace(host, '^www\.', '');
  if host = '' then return null; end if;
  path := regexp_replace(m[2], '/+$', '');
  select string_agg(p, '&' order by split_part(p, '=', 1), p) into qs
    from unnest(string_to_array(coalesce(m[3], ''), '&')) as p
   where p <> '' and split_part(p, '=', 1) !~* '^(utm_|fbclid|gclid|mc_|ref$|ref_|source$)';
  return host || path || case when qs is not null then '?' || qs else '' end;
end $$;

create or replace function rr_date(s text) returns date language plpgsql immutable
set search_path = public, pg_temp as $$
begin
  if s is null or s !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return s::date;
exception when others then
  return null;
end $$;

-- Mirrors PERSON_KINDS and defaultPurpose() in src/lib/radar/types.ts.
create or replace function rr_is_person(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('angel', 'celebrity', 'nextgen', 'creator', 'buyer', 'media')
$$;

create or replace function rr_default_purpose(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'celebrity' then 'ambassador' when 'creator' then 'ambassador'
                     when 'buyer' then 'buyer' when 'media' then 'press' else 'invest' end
$$;

-- Mirrors dedupeKey() in src/lib/radar/dedupe.ts (and Query's keys, so moved rows keep theirs).
create or replace function rr_dedupe_key(p_feed text, p_kind text, p_title text, p_url text, p_date date, p_firm text)
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare norm text := rr_norm_url(p_url); firm text;
begin
  if p_feed = 'sooz' and p_kind = 'angel' then
    return 'angel:' || rr_slug(p_title) || case when coalesce(p_firm, '') <> '' then ':' || rr_slug(p_firm) else '' end;
  elsif p_feed = 'sooz' and rr_is_person(p_kind) then
    firm := rr_slug((regexp_split_to_array(coalesce(p_firm, ''), '[;|]'))[1]);
    return p_kind || ':' || rr_slug(p_title) || case when firm <> '' then ':' || firm else '' end;
  elsif norm is not null then
    return p_feed || ':url:' || norm;
  end if;
  return p_feed || ':' || p_kind || ':' || rr_slug(p_title) || ':' || coalesce(p_date::text, '');
end $$;

-- Validate + upsert a batch of findings; returns a JSON summary. Never touches status, notes or
-- approval links of existing rows.
create or replace function rr_ingest(p_feed text, p_task text, p_kinds text[], p_upcoming boolean, p_findings jsonb,
                                     p_user text default rr_owner())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; d jsonb;
  v_kind text; v_title text; v_url text; v_score int; v_event date; v_deadline date; v_firm text;
  v_tags text[]; v_details jsonb; v_key text; v_ins boolean; v_run uuid;
  n_valid int := 0; n_ins int := 0; n_upd int := 0; rejected jsonb := '[]'::jsonb;
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
      returning (xmax = 0) into v_ins;

      n_valid := n_valid + 1;
      if v_ins then n_ins := n_ins + 1; else n_upd := n_upd + 1; end if;
    exception when others then
      rejected := rejected || jsonb_build_array(jsonb_build_object('title', left(f->>'title', 80), 'reason', sqlerrm));
    end;
  end loop;

  update radar_runs set finished_at = now(), found = n_valid, inserted = n_ins where id = v_run;
  return jsonb_build_object('run_id', v_run, 'received', jsonb_array_length(p_findings), 'valid', n_valid,
                            'inserted', n_ins, 'updated', n_upd, 'rejected', rejected);
end $$;

-- Titles already found for a feed, newest first, so research hunts for new things.
create or replace function rr_known_titles(p_feed text, p_user text default rr_owner())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(title), '[]'::jsonb) from (
    select title from radar_items where user_id = p_user and feed = p_feed order by first_seen desc limit 150
  ) t
$$;

revoke all on function rr_owner(), rr_ingest(text, text, text[], boolean, jsonb, text), rr_known_titles(text, text) from public;
