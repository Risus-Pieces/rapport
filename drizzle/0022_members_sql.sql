-- Mo's login: the owner row (the routines run as the workspace owner), shared Sooz people in General.

-- The workspace owner: the first real (non-test) user. Exactly one owner row exists.
insert into members (user_id, workspace_id, role)
select id, id, 'owner' from "user" where email not like '%@example.test' order by created_at, id limit 1
on conflict do nothing;

-- The routines run as the workspace owner (no longer "the only user": Mo is a second one).
create or replace function rr_owner() returns text language plpgsql stable
security definer set search_path = public, pg_temp as $$
declare v text; n int;
begin
  select user_id into v from members where role = 'owner';
  if v is not null then return v; end if;
  select count(*), min(id) into n, v from "user" where email not like '%@example.test';
  if n <> 1 then raise exception 'expected one workspace owner, found %', n; end if;
  return v;
end $$;

-- Sooz people in General (found by the research, or with Sooz outreach) are shared with the workspace.
create or replace function rr_mark_shared_contacts(p_user text default rr_owner()) returns integer
language sql security definer set search_path = public, pg_temp as $$
  with marked as (
    update contacts c set shared = true
     where c.user_id = p_user and c.section = 'general' and not c.shared
       and (exists (select 1 from radar_items i where i.contact_id = c.id and i.feed = 'sooz' and coalesce(i.task_id, '') <> 'crm')
            or exists (select 1 from outreach o where o.contact_id = c.id))
    returning 1)
  select count(*)::int from marked
$$;
revoke all on function rr_mark_shared_contacts(text) from public;

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
     and (v_section <> 'general' or c.shared)
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
      insert into contacts (user_id, section, name, email, linkedin_url, tags, title, priority, details, relationship, relationship_at, shared)
      values (p_user, v_section::section, i.title, v_email, v_linkedin, coalesce(i.tags[1:20], '{}'),
              nullif(concat_ws(' · ', nullif(d->>'role', ''), nullif(d->>'firm', '')), ''), null,
              case when v_section = 'investors' then rr_compact(jsonb_build_object('background', i.summary)) || jsonb_build_object('radar', v_radar)
                   else jsonb_build_object('radar', v_radar) end,
              'to_reach_out', now(), v_section = 'general')
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
            and (c.section <> 'general' or c.shared)
          where i.id = p_item)
$$;

do $$ declare u text; begin
  for u in select id from "user" loop perform rr_mark_shared_contacts(u); end loop;
end $$;
