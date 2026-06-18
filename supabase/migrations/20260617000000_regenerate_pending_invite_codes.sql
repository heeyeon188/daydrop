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

  if public.count_user_partner_slots(v_user_id) >= 4 then
    raise exception 'partner_limit_reached';
  end if;

  select cm.* into v_existing_member
  from public.couple_members cm
  join public.couples c on c.id = cm.couple_id
  where cm.user_id = v_user_id
    and c.status = 'pending'
    and c.created_by = v_user_id
  order by cm.created_at desc
  limit 1
  for update of c;

  if v_existing_member.id is not null then
    loop
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      exit when not exists (select 1 from public.couples where invite_code = v_code);
    end loop;

    update public.couples
    set invite_code = v_code,
        relationship_start_date = coalesce(p_relationship_start_date, relationship_start_date),
        partner_type = v_partner_type
    where id = v_existing_member.couple_id
      and status = 'pending'
      and created_by = v_user_id
    returning * into v_existing_couple;

    if v_existing_couple.id is null then
      raise exception 'invalid_invite_code';
    end if;

    return v_existing_couple.invite_code;
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

grant execute on function public.create_couple_invite(date, text) to authenticated;
