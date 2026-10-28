-- Warm paths across the team: every member's LinkedIn connections and own (non-shared) General contacts at the firm,
-- labelled with whose they are. Drafts go out from the owner's Gmail, so only the owner's paths are the sender's.
create or replace function rr_team(p_workspace text) returns table (user_id text, who text, sender boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, split_part(btrim(u.name), ' ', 1), u.id = p_workspace
    from "user" u
   where u.id = p_workspace or u.id in (select m.user_id from members m where m.workspace_id = p_workspace)
$$;
revoke all on function rr_team(text) from public;

create or replace function rr_warm_paths(i radar_items) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(w order by w->>'name', w->>'who'), '[]'::jsonb) from (
    select jsonb_build_object('name', n.full_name, 'via', t.who || '''s LinkedIn connection', 'who', t.who, 'owner_is_sender', t.sender) as w
      from network n join rr_team(i.user_id) t on t.user_id = n.user_id
     where n.company_key = any (rr_firm_keys(i.details->>'firm'))
    union all
    select jsonb_build_object('name', c.name, 'via', t.who || '''s contact', 'who', t.who, 'owner_is_sender', t.sender)
      from contacts c join rr_team(i.user_id) t on t.user_id = c.user_id join companies co on co.id = c.company_id
     where c.section = 'general' and not c.shared and c.archived_at is null
       and rr_company_key(co.name) = any (rr_firm_keys(i.details->>'firm'))
  ) x
$$;
