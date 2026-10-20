-- Relationships: where each person stands (To reach out / Know them / Ghosted / On hold / Dismissed).
-- Deals carry it in Investors and Restaurants, contacts carry it everywhere (General has no deals).

-- Has anyone actually been in touch with this contact, company or deal?
create or replace function rr_touched(p_contact uuid, p_company uuid, p_deal uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
           select 1 from activities a
            where a.type in ('call', 'email', 'meeting', 'tasting')
              and ((p_contact is not null and a.contact_id = p_contact)
                or (p_company is not null and a.company_id = p_company)
                or (p_deal is not null and a.deal_id = p_deal)))
      or exists (
           select 1 from outreach o
            where o.stage not in ('prospect', 'drafted')
              and ((p_contact is not null and o.contact_id = p_contact) or (p_deal is not null and o.deal_id = p_deal)))
$$;
revoke all on function rr_touched(uuid, uuid, uuid) from public;

-- Sets every record's relationship from what already happened. Safe to re-run.
create or replace function rr_backfill_relationships(p_user text default rr_owner()) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Deals: an open deal still at its first stage that nobody has touched is someone to reach out to.
  update deals d
     set relationship = case
           when d.status = 'open'
            and d.stage = case d.section when 'investors' then 'target' when 'restaurants' then 'lead' end
            and not rr_touched(d.contact_id, d.company_id, d.id) then 'to_reach_out'
           else 'known' end,
         relationship_at = now()
   where d.user_id = p_user and d.section in ('investors', 'restaurants');

  -- Contacts: archived = On hold; otherwise follow their deals; Radar finds nobody touched are To reach out.
  update contacts c
     set relationship = case
           when c.archived_at is not null then 'on_hold'
           when exists (select 1 from deals d where d.user_id = p_user and d.section <> 'general'
                          and (d.contact_id = c.id or (c.company_id is not null and d.company_id = c.company_id)))
             then case
                    when exists (select 1 from deals d where d.user_id = p_user and d.section <> 'general'
                                   and (d.contact_id = c.id or (c.company_id is not null and d.company_id = c.company_id))
                                   and d.relationship = 'known')
                      or rr_touched(c.id, null, null) then 'known'
                    else 'to_reach_out' end
           when exists (select 1 from radar_items i where i.user_id = p_user and i.contact_id = c.id and coalesce(i.task_id, '') <> 'crm')
            and not rr_touched(c.id, c.company_id, null) then 'to_reach_out'
           else 'known' end,
         relationship_at = now()
   where c.user_id = p_user;

  -- Reminders never start by themselves: Radar-added General people you have never met lose the 'high' they were given.
  update contacts c set priority = null
   where c.user_id = p_user and c.section = 'general' and c.relationship = 'to_reach_out' and c.priority = 'high';
end $$;
revoke all on function rr_backfill_relationships(text) from public;

-- Being in touch (a send, a reply, a logged call/email/meeting/tasting, a deal moved on) means you know them.
-- Only To reach out and Ghosted records change; On hold and Dismissed stay where the owner put them.
create or replace function rr_mark_known(p_contact uuid, p_company uuid, p_deal uuid, p_user text default rr_owner())
returns void language sql security definer set search_path = public, pg_temp as $$
  update contacts set relationship = 'known', relationship_at = now()
   where user_id = p_user and id = p_contact and relationship in ('to_reach_out', 'ghosted');
  update deals set relationship = 'known', relationship_at = now()
   where user_id = p_user and section <> 'general' and relationship in ('to_reach_out', 'ghosted')
     and (id = p_deal or (p_contact is not null and contact_id = p_contact) or (p_company is not null and company_id = p_company));
$$;
revoke all on function rr_mark_known(uuid, uuid, uuid, text) from public;

do $$ declare u text; begin
  for u in select id from "user" loop perform rr_backfill_relationships(u); end loop;
end $$;
