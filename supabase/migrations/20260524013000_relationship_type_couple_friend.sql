alter table public.couples
add column if not exists partner_type text;

alter table public.missions
add column if not exists audience text default 'common';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.couples'::regclass
      and conname = 'couples_partner_type_check'
  ) then
    alter table public.couples drop constraint couples_partner_type_check;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.missions'::regclass
      and conname = 'missions_audience_check'
  ) then
    alter table public.missions drop constraint missions_audience_check;
  end if;
end $$;

update public.couples
set partner_type = 'couple'
where status = 'active'
  and (partner_type is null or partner_type = 'lover');

update public.couples
set partner_type = 'couple'
where partner_type = 'lover';

-- TODO: Add a settings screen action so users can change the relationship type after connection.
update public.missions
set audience = case
  when audience = 'lover' then 'couple'
  when audience in ('common', 'couple', 'friend') then audience
  else 'common'
end;

alter table public.couples
alter column partner_type set default null;

alter table public.couples
add constraint couples_partner_type_check
check (partner_type is null or partner_type in ('couple', 'friend'));

alter table public.missions
add constraint missions_audience_check
check (audience in ('common', 'couple', 'friend'));

drop function if exists public.create_couple_invite(date);
drop function if exists public.create_couple_invite(date, text);

create or replace function public.create_couple_invite(
  p_relationship_start_date date default null,
  p_partner_type text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_couple_id uuid;
  v_existing_couple public.couples%rowtype;
  v_existing_member public.couple_members%rowtype;
  v_profile public.profiles%rowtype;
  v_partner_type text := lower(trim(coalesce(p_partner_type, '')));
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if v_partner_type = 'lover' then
    v_partner_type := 'couple';
  end if;

  if v_partner_type not in ('couple', 'friend') then
    raise exception 'invalid_partner_type';
  end if;

  select cm.* into v_existing_member
  from public.couple_members cm
  join public.couples c on c.id = cm.couple_id
  where cm.user_id = v_user_id
    and c.status = 'pending'
    and c.created_by = v_user_id
  order by cm.created_at desc
  limit 1;

  if v_existing_member.id is not null then
    update public.couples
    set relationship_start_date = coalesce(p_relationship_start_date, relationship_start_date),
        partner_type = v_partner_type
    where id = v_existing_member.couple_id
    returning * into v_existing_couple;

    return v_existing_couple.invite_code;
  end if;

  if public.count_user_partner_slots(v_user_id) >= 4 then
    raise exception 'partner_limit_reached';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.couples where invite_code = v_code);
  end loop;

  insert into public.couples (invite_code, created_by, relationship_start_date, partner_type)
  values (v_code, v_user_id, p_relationship_start_date, v_partner_type)
  returning id into v_couple_id;

  insert into public.couple_members (couple_id, user_id, role, display_name, country, city, timezone)
  values (
    v_couple_id,
    v_user_id,
    'owner',
    v_profile.display_name,
    v_profile.country,
    v_profile.city,
    v_profile.timezone
  );

  update public.profiles
  set selected_couple_id = v_couple_id
  where id = v_user_id;

  return v_code;
end;
$$;

create or replace function public.join_couple_by_invite_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_couple public.couples%rowtype;
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_couple
  from public.couples
  where invite_code = upper(trim(p_invite_code))
    and status = 'pending'
  limit 1;

  if v_couple.id is null then
    raise exception 'invalid_invite_code';
  end if;

  if v_couple.partner_type is null then
    raise exception 'missing_partner_type';
  end if;

  if exists (
    select 1
    from public.couple_members
    where couple_id = v_couple.id
      and user_id = v_user_id
  ) then
    raise exception 'already_in_couple';
  end if;

  if public.count_user_partner_slots(v_user_id) >= 4 then
    raise exception 'partner_limit_reached';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;

  insert into public.couple_members (couple_id, user_id, role, display_name, country, city, timezone)
  values (
    v_couple.id,
    v_user_id,
    'partner',
    v_profile.display_name,
    v_profile.country,
    v_profile.city,
    v_profile.timezone
  );

  update public.couples
  set status = 'active',
      connected_at = now()
  where id = v_couple.id;

  update public.profiles
  set selected_couple_id = v_couple.id
  where id = v_user_id;

  return v_couple.id;
end;
$$;

create or replace function public.get_or_create_today_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_member public.couple_members%rowtype;
  v_couple public.couples%rowtype;
  v_mission public.missions%rowtype;
  v_drop public.daily_drops%rowtype;
  v_profile public.profiles%rowtype;
  v_today date := current_date;
  v_mission_count int;
  v_offset int;
  v_day_count int;
  v_code text;
  v_partner_audience text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_member from public.get_selected_couple_member(v_user_id);

  if v_member.id is null then
    select * into v_profile from public.profiles where id = v_user_id;

    loop
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      exit when not exists (select 1 from public.couples where invite_code = v_code);
    end loop;

    insert into public.couples (invite_code, created_by, status, partner_type)
    values (v_code, v_user_id, 'pending', null)
    returning * into v_couple;

    insert into public.couple_members (couple_id, user_id, role, display_name, country, city, timezone)
    values (
      v_couple.id,
      v_user_id,
      'owner',
      v_profile.display_name,
      v_profile.country,
      v_profile.city,
      v_profile.timezone
    )
    returning * into v_member;

    update public.profiles
    set selected_couple_id = v_couple.id
    where id = v_user_id;
  else
    select * into v_couple
    from public.couples
    where id = v_member.couple_id;
  end if;

  if v_couple.id is null then
    raise exception 'couple_not_found';
  end if;

  if v_couple.status = 'active' and v_couple.partner_type is null then
    update public.couples
    set partner_type = 'couple'
    where id = v_couple.id
    returning * into v_couple;
  end if;

  v_partner_audience := case
    when v_couple.partner_type in ('couple', 'friend') then v_couple.partner_type
    else 'couple'
  end;

  select count(*) into v_mission_count
  from public.missions
  where active = true
    and (
      coalesce(audience, 'common') = 'common'
      or coalesce(audience, 'common') = v_partner_audience
    );

  if v_mission_count = 0 then
    raise exception 'no_active_missions';
  end if;

  v_offset := abs(('x' || substr(md5(v_couple.id::text || v_today::text), 1, 8))::bit(32)::int) % v_mission_count;

  select *
  into v_mission
  from public.missions
  where active = true
    and (
      coalesce(audience, 'common') = 'common'
      or coalesce(audience, 'common') = v_partner_audience
    )
  order by sort_order asc, created_at asc
  offset v_offset
  limit 1;

  if v_couple.relationship_start_date is null then
    v_day_count := null;
  else
    v_day_count := greatest((v_today - v_couple.relationship_start_date) + 1, 1);
  end if;

  insert into public.daily_drops (couple_id, mission_id, drop_date, day_count)
  values (v_couple.id, v_mission.id, v_today, v_day_count)
  on conflict (couple_id, drop_date)
  do update set day_count = excluded.day_count
  returning * into v_drop;

  select * into v_mission from public.missions where id = v_drop.mission_id;

  if v_mission.id is null
    or not (
      coalesce(v_mission.audience, 'common') = 'common'
      or coalesce(v_mission.audience, 'common') = v_partner_audience
    ) then
    update public.daily_drops
    set mission_id = (
      select id
      from public.missions
      where active = true
        and (
          coalesce(audience, 'common') = 'common'
          or coalesce(audience, 'common') = v_partner_audience
        )
      order by sort_order asc, created_at asc
      offset v_offset
      limit 1
    )
    where id = v_drop.id
    returning * into v_drop;

    select * into v_mission from public.missions where id = v_drop.mission_id;
  end if;

  return jsonb_build_object(
    'daily_drop', to_jsonb(v_drop),
    'mission', to_jsonb(v_mission),
    'couple', to_jsonb(v_couple),
    'members', (
      select coalesce(jsonb_agg(to_jsonb(cm) order by case when cm.user_id = v_user_id then 1 else 0 end, cm.created_at), '[]'::jsonb)
      from public.couple_members cm
      where cm.couple_id = v_couple.id
    ),
    'submissions', (
      select coalesce(jsonb_agg(to_jsonb(ds) order by ds.submitted_at), '[]'::jsonb)
      from public.drop_submissions ds
      where ds.drop_id = v_drop.id
    )
  );
end;
$$;

grant execute on function public.create_couple_invite(date, text) to authenticated;
grant execute on function public.join_couple_by_invite_code(text) to authenticated;
grant execute on function public.get_or_create_today_drop() to authenticated;
