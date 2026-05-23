alter table public.profiles
  add column if not exists display_name text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists timezone text,
  add column if not exists preferred_language text default 'ko',
  add column if not exists profile_completed boolean default false,
  add column if not exists updated_at timestamptz default now();

alter table public.profiles
  drop constraint if exists profiles_preferred_language_check;

alter table public.profiles
  add constraint profiles_preferred_language_check check (preferred_language in ('ko', 'en'));

alter table public.couple_members
  add column if not exists display_name text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists timezone text;

drop policy if exists "couple_members_update_self_profile_fields" on public.couple_members;
create policy "couple_members_update_self_profile_fields" on public.couple_members
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, preferred_language, profile_completed)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', null),
    'ko',
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.complete_profile(
  p_display_name text,
  p_country text,
  p_city text,
  p_timezone text,
  p_preferred_language text default 'ko'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'display_name_required';
  end if;

  if coalesce(trim(p_country), '') = '' then
    raise exception 'country_required';
  end if;

  if coalesce(trim(p_city), '') = '' then
    raise exception 'city_required';
  end if;

  if coalesce(trim(p_timezone), '') = '' then
    raise exception 'timezone_required';
  end if;

  insert into public.profiles (
    id,
    display_name,
    country,
    city,
    timezone,
    preferred_language,
    profile_completed,
    updated_at
  )
  values (
    v_user_id,
    trim(p_display_name),
    trim(p_country),
    trim(p_city),
    trim(p_timezone),
    case when p_preferred_language = 'en' then 'en' else 'ko' end,
    true,
    now()
  )
  on conflict (id) do update
  set display_name = excluded.display_name,
      country = excluded.country,
      city = excluded.city,
      timezone = excluded.timezone,
      preferred_language = excluded.preferred_language,
      profile_completed = true,
      updated_at = now()
  returning * into v_profile;

  update public.couple_members
  set display_name = v_profile.display_name,
      country = v_profile.country,
      city = v_profile.city,
      timezone = v_profile.timezone
  where user_id = v_user_id;

  return v_profile;
end;
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

  if exists (select 1 from public.couple_members where user_id = v_user_id) then
    raise exception 'already_in_couple';
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

  if exists (select 1 from public.couple_members where user_id = v_user_id) then
    raise exception 'already_in_couple';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;

  select *
  into v_couple
  from public.couples
  where invite_code = upper(trim(p_invite_code))
    and status = 'pending'
  limit 1;

  if v_couple.id is null then
    raise exception 'invalid_invite_code';
  end if;

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
  v_today date := current_date;
  v_mission_count int;
  v_offset int;
  v_day_count int;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_member from public.couple_members where user_id = v_user_id limit 1;

  if v_member.id is null then
    raise exception 'couple_not_found';
  end if;

  select * into v_couple from public.couples where id = v_member.couple_id and status = 'active';

  if v_couple.id is null then
    raise exception 'couple_not_active';
  end if;

  select count(*) into v_mission_count from public.missions where active = true;

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

grant execute on function public.complete_profile(text, text, text, text, text) to authenticated;
grant execute on function public.create_couple_invite(date) to authenticated;
grant execute on function public.join_couple_by_invite_code(text) to authenticated;
grant execute on function public.get_or_create_today_drop() to authenticated;
