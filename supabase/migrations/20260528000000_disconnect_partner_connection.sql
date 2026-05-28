do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.couples'::regclass
      and conname = 'couples_status_check'
  ) then
    alter table public.couples drop constraint couples_status_check;
  end if;
end $$;

alter table public.couples
add constraint couples_status_check
check (status in ('pending', 'active', 'disconnected'));

alter table public.couples
add column if not exists disconnected_at timestamptz,
add column if not exists disconnected_by uuid references auth.users(id) on delete set null;

create index if not exists couples_disconnected_at_idx
on public.couples(disconnected_at desc)
where status = 'disconnected';

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
    select cm.* into v_member
    from public.couple_members cm
    join public.couples c on c.id = cm.couple_id
    where cm.user_id = p_user_id
      and cm.couple_id = v_profile.selected_couple_id
      and c.status in ('active', 'pending')
    limit 1;
  end if;

  if v_member.id is null then
    select cm.* into v_member
    from public.couple_members cm
    join public.couples c on c.id = cm.couple_id
    where cm.user_id = p_user_id
      and c.status in ('active', 'pending')
    order by case when c.status = 'active' then 0 else 1 end, cm.created_at desc
    limit 1;
  end if;

  return v_member;
end;
$$;

create or replace function public.is_active_couple_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.couple_members cm
    join public.couples c on c.id = cm.couple_id
    where cm.couple_id = p_couple_id
      and cm.user_id = auth.uid()
      and c.status = 'active'
  );
$$;

create or replace function public.disconnect_partner_connection(p_couple_id uuid)
returns jsonb
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

  select c.* into v_couple
  from public.couples c
  join public.couple_members cm on cm.couple_id = c.id
  where c.id = p_couple_id
    and cm.user_id = v_user_id
  for update;

  if v_couple.id is null then
    raise exception 'couple_not_found';
  end if;

  if v_couple.status <> 'active' then
    raise exception 'couple_not_active';
  end if;

  update public.couples
  set status = 'disconnected',
      disconnected_at = now(),
      disconnected_by = v_user_id
  where id = p_couple_id
  returning * into v_couple;

  update public.profiles p
  set selected_couple_id = null
  where p.selected_couple_id = p_couple_id
    and exists (
      select 1
      from public.couple_members cm
      where cm.couple_id = p_couple_id
        and cm.user_id = p.id
    );

  return jsonb_build_object(
    'disconnected', true,
    'couple_id', v_couple.id
  );
end;
$$;

drop policy if exists "drop_submissions_insert_member_self" on public.drop_submissions;
drop policy if exists "drop_submissions_insert_active_member_self" on public.drop_submissions;
create policy "drop_submissions_insert_active_member_self" on public.drop_submissions
for insert with check (
  user_id = auth.uid()
  and public.is_active_couple_member(couple_id)
  and exists (
    select 1
    from public.daily_drops dd
    where dd.id = drop_id
      and dd.couple_id = drop_submissions.couple_id
  )
);

drop policy if exists "daydrop_photos_insert_members" on storage.objects;
drop policy if exists "daydrop_photos_insert_active_members" on storage.objects;
create policy "daydrop_photos_insert_active_members" on storage.objects
for insert with check (
  bucket_id = 'daydrop-photos'
  and split_part(name, '/', 1) = 'couples'
  and public.is_active_couple_member(split_part(name, '/', 2)::uuid)
  and name like ('couples/' || split_part(name, '/', 2) || '/drops/%/' || auth.uid()::text || '-%.jpg')
);

grant execute on function public.get_selected_couple_member(uuid) to authenticated;
grant execute on function public.is_active_couple_member(uuid) to authenticated;
grant execute on function public.disconnect_partner_connection(uuid) to authenticated;
