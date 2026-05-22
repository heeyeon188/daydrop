create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  city text,
  timezone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null,
  created_by uuid references auth.users(id) on delete cascade,
  status text check (status in ('pending', 'active')) default 'pending',
  relationship_start_date date,
  created_at timestamptz default now(),
  connected_at timestamptz
);

create table if not exists public.couple_members (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references public.couples(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text check (role in ('owner', 'partner')) not null,
  city text,
  timezone text,
  created_at timestamptz default now(),
  unique(user_id),
  unique(couple_id, user_id)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  prompt_ko text not null,
  prompt_en text,
  mission_type text default 'photo',
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists public.daily_drops (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references public.couples(id) on delete cascade,
  mission_id uuid references public.missions(id),
  drop_date date not null,
  day_count int,
  created_at timestamptz default now(),
  unique(couple_id, drop_date)
);

create table if not exists public.drop_submissions (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid references public.daily_drops(id) on delete cascade,
  couple_id uuid references public.couples(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  image_url text not null,
  storage_path text not null,
  note text,
  submitted_at timestamptz default now(),
  unique(drop_id, user_id)
);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  expo_push_token text unique not null,
  platform text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists couple_members_couple_id_idx on public.couple_members(couple_id);
create index if not exists daily_drops_couple_date_idx on public.daily_drops(couple_id, drop_date desc);
create index if not exists drop_submissions_drop_id_idx on public.drop_submissions(drop_id);
create index if not exists drop_submissions_couple_id_idx on public.drop_submissions(couple_id);
create index if not exists push_tokens_user_id_idx on public.push_tokens(user_id);

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.missions enable row level security;
alter table public.daily_drops enable row level security;
alter table public.drop_submissions enable row level security;
alter table public.push_tokens enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists push_tokens_set_updated_at on public.push_tokens;
create trigger push_tokens_set_updated_at
before update on public.push_tokens
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, city, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'Seoul',
    'Asia/Seoul'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_couple_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.couple_members cm
    where cm.couple_id = p_couple_id
      and cm.user_id = auth.uid()
  );
$$;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "couples_select_members" on public.couples;
create policy "couples_select_members" on public.couples
for select using (public.is_couple_member(id));

drop policy if exists "couple_members_select_same_couple" on public.couple_members;
create policy "couple_members_select_same_couple" on public.couple_members
for select using (
  user_id = auth.uid()
  or public.is_couple_member(couple_id)
);

drop policy if exists "missions_select_active" on public.missions;
create policy "missions_select_active" on public.missions
for select using (active = true);

drop policy if exists "daily_drops_select_members" on public.daily_drops;
create policy "daily_drops_select_members" on public.daily_drops
for select using (public.is_couple_member(couple_id));

drop policy if exists "drop_submissions_select_members" on public.drop_submissions;
create policy "drop_submissions_select_members" on public.drop_submissions
for select using (public.is_couple_member(couple_id));

drop policy if exists "drop_submissions_insert_member_self" on public.drop_submissions;
create policy "drop_submissions_insert_member_self" on public.drop_submissions
for insert with check (
  user_id = auth.uid()
  and public.is_couple_member(couple_id)
  and exists (
    select 1
    from public.daily_drops dd
    where dd.id = drop_id
      and dd.couple_id = drop_submissions.couple_id
  )
);

drop policy if exists "push_tokens_select_couple_members" on public.push_tokens;
create policy "push_tokens_select_couple_members" on public.push_tokens
for select using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.couple_members mine
    join public.couple_members theirs on theirs.couple_id = mine.couple_id
    where mine.user_id = auth.uid()
      and theirs.user_id = push_tokens.user_id
  )
);

drop policy if exists "push_tokens_insert_own" on public.push_tokens;
create policy "push_tokens_insert_own" on public.push_tokens
for insert with check (user_id = auth.uid());

drop policy if exists "push_tokens_update_own" on public.push_tokens;
create policy "push_tokens_update_own" on public.push_tokens
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

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
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if exists (select 1 from public.couple_members where user_id = v_user_id) then
    raise exception 'already_in_couple';
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.couples where invite_code = v_code);
  end loop;

  insert into public.couples (invite_code, created_by, relationship_start_date)
  values (v_code, v_user_id, p_relationship_start_date)
  returning id into v_couple_id;

  insert into public.couple_members (couple_id, user_id, role, city, timezone)
  values (v_couple_id, v_user_id, 'owner', 'Seoul', 'Asia/Seoul');

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
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if exists (select 1 from public.couple_members where user_id = v_user_id) then
    raise exception 'already_in_couple';
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

  insert into public.couple_members (couple_id, user_id, role, city, timezone)
  values (v_couple.id, v_user_id, 'partner', 'New York', 'America/New_York');

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

  select *
  into v_member
  from public.couple_members
  where user_id = v_user_id
  limit 1;

  if v_member.id is null then
    raise exception 'couple_not_found';
  end if;

  select *
  into v_couple
  from public.couples
  where id = v_member.couple_id
    and status = 'active';

  if v_couple.id is null then
    raise exception 'couple_not_active';
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
  do update set couple_id = excluded.couple_id
  returning * into v_drop;

  select *
  into v_mission
  from public.missions
  where id = v_drop.mission_id;

  return jsonb_build_object(
    'daily_drop', to_jsonb(v_drop),
    'mission', to_jsonb(v_mission),
    'couple', to_jsonb(v_couple),
    'members', (
      select coalesce(jsonb_agg(to_jsonb(cm) order by cm.created_at), '[]'::jsonb)
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

grant execute on function public.create_couple_invite(date) to authenticated;
grant execute on function public.join_couple_by_invite_code(text) to authenticated;
grant execute on function public.get_or_create_today_drop() to authenticated;

insert into public.missions (prompt_ko, prompt_en, sort_order)
values
  ('지금 네가 보고 있는 하늘을 보내주세요.', 'Send the sky you are looking at right now.', 10),
  ('퇴근길 하늘 어땠어?', 'What did the sky look like on your way home?', 20),
  ('오늘의 작은 행복은?', 'What was your small joy today?', 30),
  ('오늘 하늘의 색은?', 'What color was today''s sky?', 40),
  ('지금 네 앞의 빛을 보여줘.', 'Show the light in front of you right now.', 50)
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('daydrop-photos', 'daydrop-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "daydrop_photos_select_members" on storage.objects;
create policy "daydrop_photos_select_members" on storage.objects
for select using (
  bucket_id = 'daydrop-photos'
  and split_part(name, '/', 1) = 'couples'
  and public.is_couple_member(split_part(name, '/', 2)::uuid)
);

drop policy if exists "daydrop_photos_insert_members" on storage.objects;
create policy "daydrop_photos_insert_members" on storage.objects
for insert with check (
  bucket_id = 'daydrop-photos'
  and split_part(name, '/', 1) = 'couples'
  and public.is_couple_member(split_part(name, '/', 2)::uuid)
  and name like ('couples/' || split_part(name, '/', 2) || '/drops/%/' || auth.uid()::text || '-%.jpg')
);

drop policy if exists "daydrop_photos_delete_own" on storage.objects;
create policy "daydrop_photos_delete_own" on storage.objects
for delete using (
  bucket_id = 'daydrop-photos'
  and split_part(name, '/', 1) = 'couples'
  and public.is_couple_member(split_part(name, '/', 2)::uuid)
  and name like ('couples/' || split_part(name, '/', 2) || '/drops/%/' || auth.uid()::text || '-%.jpg')
);
