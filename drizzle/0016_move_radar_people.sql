-- The Radar's people move into the CRM as To reach out (the owner's triage is kept: dismissed people stay dismissed).
-- Idempotent: moved items are 'approved', so a second run finds nothing.
create or replace function rr_move_radar_people(p_user text default rr_owner()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; n int := 0;
begin
  for v_id in
    select id from radar_items
     where user_id = p_user and feed = 'sooz' and rr_is_person(kind) and status in ('new', 'seen', 'saved')
     order by first_seen, id
  loop
    begin
      perform rr_approve_item(v_id, p_user);
      n := n + 1;
    exception when others then
      raise warning 'rr_move_radar_people: % not moved: %', v_id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function rr_move_radar_people(text) from public;

do $$ declare u text; n int; begin
  for u in select id from "user" loop
    n := rr_move_radar_people(u);
    raise notice 'moved % Radar people into the CRM for %', n, u;
  end loop;
end $$;
