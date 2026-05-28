alter table public.missions
add column if not exists theme_key text;

create index if not exists missions_audience_theme_active_idx
on public.missions(audience, theme_key, active, sort_order, created_at, id);

create table if not exists public.daily_drop_mission_usages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  partner_type text not null check (partner_type in ('couple', 'friend')),
  cycle_index int not null default 0 check (cycle_index >= 0),
  mission_id uuid not null references public.missions(id) on delete cascade,
  theme_key text,
  drop_date date not null,
  created_at timestamptz default now(),
  unique(couple_id, partner_type, cycle_index, mission_id),
  unique(couple_id, drop_date)
);

create index if not exists daily_drop_mission_usages_couple_type_cycle_idx
on public.daily_drop_mission_usages(couple_id, partner_type, cycle_index);

create index if not exists daily_drop_mission_usages_mission_idx
on public.daily_drop_mission_usages(mission_id);

alter table public.daily_drop_mission_usages enable row level security;

drop policy if exists "daily_drop_mission_usages_select_members" on public.daily_drop_mission_usages;
create policy "daily_drop_mission_usages_select_members" on public.daily_drop_mission_usages
for select using (public.is_couple_member(couple_id));

insert into public.daily_drop_mission_usages (
  couple_id,
  partner_type,
  cycle_index,
  mission_id,
  theme_key,
  drop_date,
  created_at
)
select distinct on (dd.couple_id, dd.mission_id)
  dd.couple_id,
  case
    when c.partner_type in ('couple', 'friend') then c.partner_type
    else 'couple'
  end,
  0,
  dd.mission_id,
  m.theme_key,
  dd.drop_date,
  dd.created_at
from public.daily_drops dd
join public.couples c on c.id = dd.couple_id
left join public.missions m on m.id = dd.mission_id
where dd.mission_id is not null
order by dd.couple_id, dd.mission_id, dd.drop_date asc
on conflict do nothing;

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
  v_theme_sequence text[];
  v_theme_count int;
  v_theme_start int;
  v_theme_offset int;
  v_selected_theme_key text;
  v_cycle_index int := 0;
  v_total_themed_count int := 0;
  v_used_count int := 0;
  v_candidate_count int := 0;
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
    where id = v_member.couple_id
    for update;
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

  select *
  into v_drop
  from public.daily_drops
  where couple_id = v_couple.id
    and drop_date = v_today
  limit 1;

  if v_drop.id is not null then
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
  end if;

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

  v_theme_sequence := case
    when v_partner_audience = 'friend' then array[
      'friend_reality',
      'common_face_checkin',
      'friend_survival_items',
      'common_background_place',
      'friend_status_mood',
      'common_save_share',
      'friend_live_update',
      'common_emotional_record',
      'friend_face_selfie',
      'common_fun_dopamine',
      'friend_glowup_lazy',
      'common_current_scene'
    ]
    else array[
      'couple_affection_heart',
      'common_background_place',
      'couple_selfie_face',
      'common_current_scene',
      'couple_together_moment',
      'common_emotional_record',
      'couple_pose_mirror',
      'common_save_share',
      'couple_miss_checkin',
      'common_fun_dopamine',
      'couple_charm_crush',
      'common_face_checkin'
    ]
  end;

  v_theme_count := array_length(v_theme_sequence, 1);
  v_theme_start := mod(v_today - date '2026-01-01', v_theme_count) + 1;

  select count(*) into v_total_themed_count
  from public.missions
  where active = true
    and theme_key = any(v_theme_sequence)
    and (
      coalesce(audience, 'common') = 'common'
      or coalesce(audience, 'common') = v_partner_audience
    );

  if v_total_themed_count > 0 then
    select coalesce(max(cycle_index), 0) into v_cycle_index
    from public.daily_drop_mission_usages
    where couple_id = v_couple.id
      and partner_type = v_partner_audience;

    select count(distinct u.mission_id) into v_used_count
    from public.daily_drop_mission_usages u
    join public.missions m on m.id = u.mission_id
    where u.couple_id = v_couple.id
      and u.partner_type = v_partner_audience
      and u.cycle_index = v_cycle_index
      and m.active = true
      and m.theme_key = any(v_theme_sequence)
      and (
        coalesce(m.audience, 'common') = 'common'
        or coalesce(m.audience, 'common') = v_partner_audience
      );

    if v_used_count >= v_total_themed_count then
      v_cycle_index := v_cycle_index + 1;
    end if;

    for v_theme_offset in 0..(v_theme_count - 1) loop
      v_selected_theme_key := v_theme_sequence[mod(v_theme_start - 1 + v_theme_offset, v_theme_count) + 1];

      select count(*) into v_candidate_count
      from public.missions m
      where m.active = true
        and m.theme_key = v_selected_theme_key
        and (
          coalesce(m.audience, 'common') = 'common'
          or coalesce(m.audience, 'common') = v_partner_audience
        )
        and not exists (
          select 1
          from public.daily_drop_mission_usages u
          where u.couple_id = v_couple.id
            and u.partner_type = v_partner_audience
            and u.cycle_index = v_cycle_index
            and u.mission_id = m.id
        );

      if v_candidate_count > 0 then
        v_offset := (('x' || substr(md5(v_couple.id::text || v_today::text || v_selected_theme_key || v_cycle_index::text), 1, 15))::bit(60)::bigint % v_candidate_count)::int;

        select * into v_mission
        from public.missions m
        where m.active = true
          and m.theme_key = v_selected_theme_key
          and (
            coalesce(m.audience, 'common') = 'common'
            or coalesce(m.audience, 'common') = v_partner_audience
          )
          and not exists (
            select 1
            from public.daily_drop_mission_usages u
            where u.couple_id = v_couple.id
              and u.partner_type = v_partner_audience
              and u.cycle_index = v_cycle_index
              and u.mission_id = m.id
          )
        order by m.sort_order asc, m.created_at asc, m.id asc
        offset v_offset
        limit 1;

        exit when v_mission.id is not null;
      end if;
    end loop;

    if v_mission.id is null then
      v_cycle_index := v_cycle_index + 1;

      for v_theme_offset in 0..(v_theme_count - 1) loop
        v_selected_theme_key := v_theme_sequence[mod(v_theme_start - 1 + v_theme_offset, v_theme_count) + 1];

        select count(*) into v_candidate_count
        from public.missions m
        where m.active = true
          and m.theme_key = v_selected_theme_key
          and (
            coalesce(m.audience, 'common') = 'common'
            or coalesce(m.audience, 'common') = v_partner_audience
          );

        if v_candidate_count > 0 then
          v_offset := (('x' || substr(md5(v_couple.id::text || v_today::text || v_selected_theme_key || v_cycle_index::text), 1, 15))::bit(60)::bigint % v_candidate_count)::int;

          select * into v_mission
          from public.missions m
          where m.active = true
            and m.theme_key = v_selected_theme_key
            and (
              coalesce(m.audience, 'common') = 'common'
              or coalesce(m.audience, 'common') = v_partner_audience
            )
          order by m.sort_order asc, m.created_at asc, m.id asc
          offset v_offset
          limit 1;

          exit when v_mission.id is not null;
        end if;
      end loop;
    end if;
  end if;

  if v_mission.id is null then
    v_offset := (('x' || substr(md5(v_couple.id::text || v_today::text), 1, 15))::bit(60)::bigint % v_mission_count)::int;

    select *
    into v_mission
    from public.missions
    where active = true
      and (
        coalesce(audience, 'common') = 'common'
        or coalesce(audience, 'common') = v_partner_audience
      )
    order by sort_order asc, created_at asc, id asc
    offset v_offset
    limit 1;

    v_cycle_index := null;
    v_selected_theme_key := null;
  end if;

  if v_couple.relationship_start_date is null then
    v_day_count := null;
  else
    v_day_count := greatest((v_today - v_couple.relationship_start_date) + 1, 1);
  end if;

  insert into public.daily_drops (couple_id, mission_id, drop_date, day_count)
  values (v_couple.id, v_mission.id, v_today, v_day_count)
  on conflict (couple_id, drop_date) do nothing
  returning * into v_drop;

  if v_drop.id is null then
    select *
    into v_drop
    from public.daily_drops
    where couple_id = v_couple.id
      and drop_date = v_today
    limit 1;
  elsif v_cycle_index is not null then
    insert into public.daily_drop_mission_usages (
      couple_id,
      partner_type,
      cycle_index,
      mission_id,
      theme_key,
      drop_date
    )
    values (
      v_couple.id,
      v_partner_audience,
      v_cycle_index,
      v_mission.id,
      v_selected_theme_key,
      v_today
    )
    on conflict do nothing;
  end if;

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

grant execute on function public.get_or_create_today_drop() to authenticated;
