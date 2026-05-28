create or replace function public.prevent_duplicate_active_couple_pair(p_couple_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_member_count int;
begin
  select status into v_status
  from public.couples
  where id = p_couple_id;

  if v_status <> 'active' then
    return;
  end if;

  select count(distinct user_id)::int into v_member_count
  from public.couple_members
  where couple_id = p_couple_id;

  if v_member_count < 2 then
    return;
  end if;

  if exists (
    select 1
    from public.couples other_couple
    where other_couple.id <> p_couple_id
      and other_couple.status = 'active'
      and (
        select count(distinct other_member.user_id)
        from public.couple_members other_member
        where other_member.couple_id = other_couple.id
      ) = v_member_count
      and not exists (
        select 1
        from public.couple_members target_member
        where target_member.couple_id = p_couple_id
          and not exists (
            select 1
            from public.couple_members other_member
            where other_member.couple_id = other_couple.id
              and other_member.user_id = target_member.user_id
          )
      )
      and not exists (
        select 1
        from public.couple_members other_member
        where other_member.couple_id = other_couple.id
          and not exists (
            select 1
            from public.couple_members target_member
            where target_member.couple_id = p_couple_id
              and target_member.user_id = other_member.user_id
          )
      )
  ) then
    raise exception 'already_connected_partner';
  end if;
end;
$$;

create or replace function public.prevent_duplicate_active_couple_pair_from_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prevent_duplicate_active_couple_pair(new.couple_id);
  return new;
end;
$$;

create or replace function public.prevent_duplicate_active_couple_pair_from_couple()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prevent_duplicate_active_couple_pair(new.id);
  return new;
end;
$$;

drop trigger if exists couple_members_prevent_duplicate_active_pair on public.couple_members;
create trigger couple_members_prevent_duplicate_active_pair
after insert or update of couple_id, user_id on public.couple_members
for each row execute function public.prevent_duplicate_active_couple_pair_from_member();

drop trigger if exists couples_prevent_duplicate_active_pair on public.couples;
create trigger couples_prevent_duplicate_active_pair
after insert or update of status on public.couples
for each row execute function public.prevent_duplicate_active_couple_pair_from_couple();

create or replace function public.join_couple_by_invite_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
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
  for update;

  if v_couple.id is null then
    raise exception 'invalid_invite_code';
  end if;

  if v_couple.partner_type is null then
    raise exception 'missing_partner_type';
  end if;

  select coalesce(
    v_couple.created_by,
    (
      select cm.user_id
      from public.couple_members cm
      where cm.couple_id = v_couple.id
        and cm.role = 'owner'
      order by cm.created_at asc
      limit 1
    )
  )
  into v_owner_id;

  if v_owner_id is null then
    raise exception 'couple_owner_not_found';
  end if;

  if v_owner_id = v_user_id then
    raise exception 'self_invite_code';
  end if;

  if exists (
    select 1
    from public.couple_members
    where couple_id = v_couple.id
      and user_id = v_user_id
  ) then
    raise exception 'already_in_couple';
  end if;

  perform 1
  from public.profiles
  where id in (v_user_id, v_owner_id)
  order by id
  for update;

  if exists (
    select 1
    from public.couples existing_couple
    where existing_couple.status = 'active'
      and exists (
        select 1
        from public.couple_members mine
        where mine.couple_id = existing_couple.id
          and mine.user_id = v_user_id
      )
      and exists (
        select 1
        from public.couple_members owner_member
        where owner_member.couple_id = existing_couple.id
          and owner_member.user_id = v_owner_id
      )
  ) then
    raise exception 'already_connected_partner';
  end if;

  if public.count_user_partner_slots(v_user_id) >= 4 then
    raise exception 'partner_limit_reached';
  end if;

  if public.count_user_partner_slots(v_owner_id) >= 4 then
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
  where id = v_couple.id
    and status = 'pending';

  update public.profiles
  set selected_couple_id = v_couple.id
  where id = v_user_id;

  return v_couple.id;
end;
$$;

grant execute on function public.prevent_duplicate_active_couple_pair(uuid) to authenticated;
grant execute on function public.join_couple_by_invite_code(text) to authenticated;
