-- Raise mode: SQL the weekly outreach and daily Gmail routines call (see docs/superpowers/specs/2026-10-19-raise-mode-design.md).

-- Hand-added CRM investors join the raise workflow: each gets an approved radar item (task 'crm') and an
-- outreach row, so shortlists, drafts and Gmail tracking work the same for them. Anyone whose deal is past
-- Target, or who already has an email logged, counts as contacted: no first-touch draft for them.
create or replace function rr_sync_crm_investors(p_user text default rr_owner())
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; v_item uuid; v_deal deals; v_contacted boolean; n int := 0;
begin
  for c in
    select ct.*, co.name as company_name from contacts ct left join companies co on co.id = ct.company_id
     where ct.user_id = p_user and ct.section = 'investors' and ct.archived_at is null
       and not exists (select 1 from radar_items r where r.user_id = p_user and r.contact_id = ct.id)
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
    v_contacted := (v_deal.id is not null and v_deal.stage <> 'target')
      or exists (select 1 from activities a where a.user_id = p_user and a.contact_id = c.id and a.type = 'email');
    insert into outreach (user_id, radar_item_id, contact_id, deal_id, purpose, email, linkedin_url, stage, touches)
    values (p_user, v_item, c.id, v_deal.id, 'invest', c.email, c.linkedin_url,
            case when v_contacted then 'sent' else 'prospect' end, case when v_contacted then 1 else 0 end)
    on conflict (radar_item_id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function rr_sync_crm_investors(text) from public;
