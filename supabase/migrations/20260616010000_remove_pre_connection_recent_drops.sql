create or replace function public.reset_today_drop_on_partner_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.partner_type in ('couple', 'friend')
    and (
      old.partner_type is distinct from new.partner_type
      or (old.status = 'pending' and new.status = 'active')
    )
  then
    delete from public.daily_drops dd
    where dd.couple_id = new.id
      and (
        (
          old.status = 'pending'
          and new.status = 'active'
          and new.connected_at is not null
          and dd.created_at < new.connected_at
        )
        or dd.mission_id is null
        or exists (
          select 1
          from public.missions m
          where m.id = dd.mission_id
            and coalesce(m.audience, 'common') not in ('common', new.partner_type)
        )
      );
  end if;

  return new;
end;
$$;

delete from public.daily_drops dd
using public.couples c
where c.id = dd.couple_id
  and c.status = 'active'
  and c.partner_type in ('couple', 'friend')
  and c.connected_at is not null
  and (
    dd.created_at < c.connected_at
    or dd.mission_id is null
    or exists (
      select 1
      from public.missions m
      where m.id = dd.mission_id
        and coalesce(m.audience, 'common') not in ('common', c.partner_type)
    )
  );
