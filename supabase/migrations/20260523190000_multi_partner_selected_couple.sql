alter table public.profiles
add column if not exists selected_couple_id uuid references public.couples(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.couple_members'::regclass
      and conname = 'couple_members_user_id_key'
  ) then
    alter table public.couple_members drop constraint couple_members_user_id_key;
  end if;
end $$;

create index if not exists couple_members_user_id_idx on public.couple_members(user_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.couple_members'::regclass
      and conname = 'couple_members_couple_id_user_id_key'
  ) then
    alter table public.couple_members
    add constraint couple_members_couple_id_user_id_key unique (couple_id, user_id);
  end if;
end $$;

create or replace function public.get_selected_couple_member(p_user_id uuid)
returns public.couple_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_member public.couple_members%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = p_user_id;

  if v_profile.selected_couple_id is not null then
    select * into v_member
    from public.couple_members
    where user_id = p_user_id
      and couple_id = v_profile.selected_couple_id
    limit 1;
  end if;

  if v_member.id is null then
    select cm.* into v_member
    from public.couple_members cm
    join public.couples c on c.id = cm.couple_id
    where cm.user_id = p_user_id
    order by case when c.status = 'active' then 0 else 1 end, cm.created_at desc
    limit 1;
  end if;

  return v_member;
end;
$$;

create or replace function public.count_user_partner_slots(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.couple_members cm
  join public.couples c on c.id = cm.couple_id
  where cm.user_id = p_user_id
    and c.status in ('active', 'pending');
$$;

create or replace function public.create_couple_invite(p_relationship_start_date date default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_couple_id uuid;
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if public.count_user_partner_slots(v_user_id) >= 4 then
    raise exception 'partner_limit_reached';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.couples where invite_code = v_code);
  end loop;

  insert into public.couples (invite_code, created_by, relationship_start_date)
  values (v_code, v_user_id, p_relationship_start_date)
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

    insert into public.couples (invite_code, created_by, status)
    values (v_code, v_user_id, 'pending')
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

  select count(*) into v_mission_count
  from public.missions
  where active = true;

  if v_mission_count = 0 then
    raise exception 'no_active_missions';
  end if;

  v_offset := abs(('x' || substr(md5(v_couple.id::text || v_today::text), 1, 8))::bit(32)::int) % v_mission_count;

  select *
  into v_mission
  from public.missions
  where active = true
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

create or replace function public.get_my_today_drop_photo_to_delete()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_member public.couple_members%rowtype;
  v_drop public.daily_drops%rowtype;
  v_submission public.drop_submissions%rowtype;
  v_expected_prefix text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_member from public.get_selected_couple_member(v_user_id);

  if v_member.id is null then
    raise exception 'couple_not_found';
  end if;

  select *
  into v_drop
  from public.daily_drops
  where couple_id = v_member.couple_id
    and drop_date = current_date
  limit 1;

  if v_drop.id is null then
    raise exception 'today_drop_not_found';
  end if;

  select *
  into v_submission
  from public.drop_submissions
  where drop_id = v_drop.id
    and couple_id = v_member.couple_id
    and user_id = v_user_id
  limit 1;

  if v_submission.id is null then
    raise exception 'today_photo_not_found';
  end if;

  v_expected_prefix := 'couples/' || v_member.couple_id::text || '/drops/' || v_drop.id::text || '/' || v_user_id::text || '-';

  if v_submission.storage_path not like (v_expected_prefix || '%.jpg') then
    raise exception 'invalid_storage_path';
  end if;

  return jsonb_build_object(
    'drop_id', v_drop.id,
    'storage_path', v_submission.storage_path
  );
end;
$$;

create or replace function public.delete_my_today_drop_photo_row(target_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_member public.couple_members%rowtype;
  v_drop public.daily_drops%rowtype;
  v_submission public.drop_submissions%rowtype;
  v_expected_prefix text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(target_storage_path, '') = '' then
    raise exception 'missing_storage_path';
  end if;

  select * into v_member from public.get_selected_couple_member(v_user_id);

  if v_member.id is null then
    raise exception 'couple_not_found';
  end if;

  select *
  into v_drop
  from public.daily_drops
  where couple_id = v_member.couple_id
    and drop_date = current_date
  limit 1;

  if v_drop.id is null then
    raise exception 'today_drop_not_found';
  end if;

  select *
  into v_submission
  from public.drop_submissions
  where drop_id = v_drop.id
    and couple_id = v_member.couple_id
    and user_id = v_user_id
  limit 1;

  if v_submission.id is null then
    raise exception 'today_photo_not_found';
  end if;

  v_expected_prefix := 'couples/' || v_member.couple_id::text || '/drops/' || v_drop.id::text || '/' || v_user_id::text || '-';

  if v_submission.storage_path not like (v_expected_prefix || '%.jpg') then
    raise exception 'invalid_storage_path';
  end if;

  if v_submission.storage_path <> target_storage_path then
    raise exception 'storage_path_mismatch';
  end if;

  delete from public.drop_submissions
  where id = v_submission.id;

  return jsonb_build_object(
    'deleted', true,
    'drop_id', v_drop.id,
    'storage_path', v_submission.storage_path
  );
end;
$$;

grant execute on function public.get_selected_couple_member(uuid) to authenticated;
grant execute on function public.count_user_partner_slots(uuid) to authenticated;
grant execute on function public.create_couple_invite(date) to authenticated;
grant execute on function public.join_couple_by_invite_code(text) to authenticated;
grant execute on function public.get_or_create_today_drop() to authenticated;
grant execute on function public.get_my_today_drop_photo_to_delete() to authenticated;
grant execute on function public.delete_my_today_drop_photo_row(text) to authenticated;
